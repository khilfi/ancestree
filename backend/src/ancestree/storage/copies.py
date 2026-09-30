"""Copies to edit on disk.

DATA_DIR/copies/<id>/ keeps what each copy to edit started from, so that when it comes back
(M21) the app compares it with what the copy started from, never with what the file claims:
about.json says whom it was made for, when, and what they may do in it; start.json.gz holds the
family as the copy carries it, and the life stories. A password is never kept.

Once changes from it have been brought in, brought.json.gz holds the family as that file had
it, and how its people are known in the tree: a later file from the same copy is compared with
that, so only what's new since shows.
"""

import gzip
import json
from pathlib import Path
from typing import Any
from uuid import UUID

from ancestree.storage.files import atomic_write, write_json

ABOUT = "about.json"
START = "start.json.gz"
BROUGHT = "brought.json.gz"


def copy_dir(data_dir: Path, copy_id: str) -> Path:
    # Going through UUID guarantees the name can't point outside copies/.
    return data_dir / "copies" / str(UUID(copy_id))


def _packed(value: dict[str, Any]) -> bytes:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return gzip.compress(text.encode("utf-8"), mtime=0)


def keep_copy(data_dir: Path, copy_id: str, about: dict[str, Any], start: dict[str, Any]) -> None:
    folder = copy_dir(data_dir, copy_id)
    atomic_write(folder / START, _packed(start))
    write_json(folder / ABOUT, about)  # last: a folder without it holds no copy


def read_copy(data_dir: Path, copy_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """A copy to edit's record and what it started from. KeyError when there's no such copy."""
    try:
        folder = copy_dir(data_dir, copy_id)
    except ValueError as error:
        raise KeyError(copy_id) from error
    if not (folder / ABOUT).is_file():
        raise KeyError(copy_id)
    about: dict[str, Any] = json.loads((folder / ABOUT).read_text(encoding="utf-8"))
    start: dict[str, Any] = json.loads(gzip.decompress((folder / START).read_bytes()))
    return about, start


def read_brought(data_dir: Path, copy_id: str) -> dict[str, Any] | None:
    """What changes from this copy last brought in, or None if none have been."""
    path = copy_dir(data_dir, copy_id) / BROUGHT
    if not path.is_file():
        return None
    brought: dict[str, Any] = json.loads(gzip.decompress(path.read_bytes()))
    return brought


def keep_brought(data_dir: Path, copy_id: str, brought: dict[str, Any] | None) -> None:
    """What was brought in from this copy: compared with the next file from it. None forgets
    it, so the next is compared with what the copy started from, as when an import of it is
    taken back."""
    path = copy_dir(data_dir, copy_id) / BROUGHT
    if brought is None:
        path.unlink(missing_ok=True)
    else:
        atomic_write(path, _packed(brought))
