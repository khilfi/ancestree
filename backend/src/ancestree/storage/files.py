"""Person folders, photos and the Trash on disk.

File names are always generated here, never taken from uploads, and every write is
atomic (temp file, then rename), so a crash can't leave half a file behind.
"""

import json
import os
import re
import shutil
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from ancestree.media.photos import AVATAR_SIZES, Crop, ProcessedPhoto

TRASH_DAYS = 30
_TRASH_ENTRY = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[0-9a-f-]{36}$")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        Path(temp_name).replace(path)
    except BaseException:
        Path(temp_name).unlink(missing_ok=True)
        raise


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def person_dir(data_dir: Path, person_id: UUID | str) -> Path:
    # Going through UUID guarantees the name can't point outside people/.
    return data_dir / "people" / str(UUID(str(person_id)))


def write_snapshot(data_dir: Path, person_id: UUID | str, snapshot: dict[str, Any]) -> None:
    """person.json: who this folder belongs to, readable without the app (never read back)."""
    write_json(person_dir(data_dir, person_id) / "person.json", snapshot)


def remove_bare_folders(data_dir: Path, person_ids: Iterable[str]) -> int:
    """Remove the folders of people taken out of the tree, if they hold only person.json, and
    their journal.

    person.json is only a copy of what the database held; a folder with anything else in
    it (a photo, a biography) is left alone.
    """
    removed = 0
    for person_id in person_ids:
        folder = person_dir(data_dir, person_id)
        if not folder.is_dir():
            continue
        files = [path for path in folder.rglob("*") if path.is_file()]
        if all(path.name in ("person.json", "journal.json") for path in files):
            shutil.rmtree(folder)
            removed += 1
    return removed


# --- Photos -------------------------------------------------------------------------------


def _profile(data_dir: Path, person_id: UUID | str) -> Path:
    return person_dir(data_dir, person_id) / "profile"


def _originals(profile: Path) -> list[Path]:
    return sorted(profile.glob("original.*")) if profile.is_dir() else []


def _keep_previous(profile: Path) -> str | None:
    """Move the current original and crop to previous/: a new photo never destroys the old one.
    Their stamp there, or None when there was no photo."""
    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S-%f")
    moved = False
    for path in [*_originals(profile), profile / "crop.json"]:
        if path.exists():
            target = profile / "previous" / f"{stamp}-{path.name}"
            target.parent.mkdir(parents=True, exist_ok=True)
            path.replace(target)
            moved = True
    for derived in [
        profile / "display.webp",
        *(profile / f"avatar-{s}.webp" for s in AVATAR_SIZES),
    ]:
        derived.unlink(missing_ok=True)  # generated from the original; nothing is lost
    return stamp if moved else None


def store_photo(
    data_dir: Path, person_id: UUID | str, original: bytes, photo: ProcessedPhoto
) -> str | None:
    """The new photo in place, the one before kept: its stamp in previous/, if there was one."""
    profile = _profile(data_dir, person_id)
    stamp = _keep_previous(profile)
    atomic_write(profile / f"original.{photo.extension}", original)
    store_rendering(data_dir, person_id, photo)
    return stamp


def store_rendering(data_dir: Path, person_id: UUID | str, photo: ProcessedPhoto) -> None:
    """Crop, avatars and the display copy; used after an upload and after a re-crop."""
    profile = _profile(data_dir, person_id)
    write_json(profile / "crop.json", photo.crop.model_dump())
    atomic_write(profile / "display.webp", photo.display)
    for size, data in photo.avatars.items():
        atomic_write(profile / f"avatar-{size}.webp", data)


def read_original(data_dir: Path, person_id: UUID | str) -> bytes | None:
    originals = _originals(_profile(data_dir, person_id))
    return originals[0].read_bytes() if originals else None


def read_crop(data_dir: Path, person_id: UUID | str) -> Crop | None:
    path = _profile(data_dir, person_id) / "crop.json"
    return Crop.model_validate_json(path.read_bytes()) if path.exists() else None


def remove_photo(data_dir: Path, person_id: UUID | str) -> str | None:
    return _keep_previous(_profile(data_dir, person_id))


def previous_photo(
    data_dir: Path, person_id: UUID | str, stamp: str
) -> tuple[bytes, Crop | None] | None:
    """A photo kept in previous/ by its stamp: its original and crop; None if it's gone."""
    previous = _profile(data_dir, person_id) / "previous"
    originals = sorted(previous.glob(f"{stamp}-original.*")) if previous.is_dir() else []
    if not originals:
        return None
    crop_file = previous / f"{stamp}-crop.json"
    crop = Crop.model_validate_json(crop_file.read_bytes()) if crop_file.exists() else None
    return originals[0].read_bytes(), crop


def photo_file(data_dir: Path, person_id: UUID | str, name: str) -> Path | None:
    path = _profile(data_dir, person_id) / name
    return path if path.is_file() else None


# --- Trash --------------------------------------------------------------------------------


@dataclass(frozen=True)
class TrashItem:
    entry: str
    tombstone: dict[str, Any]
    deleted_at: datetime


def _entry_dir(data_dir: Path, entry: str) -> Path:
    if not _TRASH_ENTRY.match(entry):
        raise KeyError(entry)
    return data_dir / "trash" / entry


def move_to_trash(data_dir: Path, person_id: str, tombstone: dict[str, Any]) -> str:
    """Put the tombstone and the person's folder in a new Trash entry; return its name."""
    now = datetime.now().astimezone()
    entry = f"{now:%Y-%m-%dT%H-%M-%S}_{UUID(person_id)}"
    entry_dir = _entry_dir(data_dir, entry)
    entry_dir.mkdir(parents=True)
    write_json(entry_dir / "tombstone.json", {**tombstone, "deleted_at": now.isoformat()})
    folder = person_dir(data_dir, person_id)
    if folder.exists():
        shutil.move(folder, entry_dir / "files")
    return entry


def take_out_of_trash(data_dir: Path, entry: str, person_id: str) -> None:
    """Move the files back into people/ and remove the entry."""
    entry_dir = _entry_dir(data_dir, entry)
    files = entry_dir / "files"
    if files.exists():
        target = person_dir(data_dir, person_id)
        if target.exists():
            raise FileExistsError(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(files, target)
    shutil.rmtree(entry_dir)


def read_trash_item(data_dir: Path, entry: str) -> TrashItem:
    entry_dir = _entry_dir(data_dir, entry)
    tombstone = json.loads((entry_dir / "tombstone.json").read_text(encoding="utf-8"))
    return TrashItem(entry, tombstone, datetime.fromisoformat(tombstone["deleted_at"]))


def list_trash(data_dir: Path) -> list[TrashItem]:
    root = data_dir / "trash"
    if not root.is_dir():
        return []
    items = [
        read_trash_item(data_dir, path.name)
        for path in root.iterdir()
        if _TRASH_ENTRY.match(path.name) and (path / "tombstone.json").exists()
    ]
    return sorted(items, key=lambda item: item.deleted_at, reverse=True)


def purge_trash(data_dir: Path, *, days: int = TRASH_DAYS) -> int:
    """Delete Trash entries older than `days`; return how many went."""
    cutoff = datetime.now().astimezone() - timedelta(days=days)
    expired = [item for item in list_trash(data_dir) if item.deleted_at < cutoff]
    for item in expired:
        shutil.rmtree(_entry_dir(data_dir, item.entry))
    return len(expired)
