"""Copies of the backups in a second place (0.4.0): a USB stick, another disk, or a folder a
cloud service keeps, so that losing the computer, or its disk, doesn't lose the backups too.

Each family chooses its own place, and each family's copies go in a folder of their own there,
named by the family's id, never its name: `AncesTree <family id>`. Every backup in the family's
backup folder is copied there, by hand or daily, with the same keeping rule: the last 30 daily
ones, and those made by hand for ever. A copy can be locked with a password (locked.py): this
computer keeps the key the password made, locked as the family folder's keys are, so the daily
copies lock by themselves, and the password itself is kept nowhere.

What the family chose is kept in its data folder, beside the backups' contents but never in
them: `elsewhere.json`, and the key in `elsewhere-key.bin`. When the place can't be reached (a
USB stick taken out), nothing fails: the copies wait, and catch up once it's back.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import string
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from ancestree.domain.exports import CopyPlace, Elsewhere
from ancestree.exchange.backup import KEEP_AUTOMATIC, is_automatic
from ancestree.exchange.locked import SUFFIX, Key, lock
from ancestree.familyfolder.protect import ProtectError, read_secret, write_secret
from ancestree.services.context import Context, RuleError

SETTINGS = "elsewhere.json"
KEY = "elsewhere-key.bin"

log = logging.getLogger("uvicorn.error")


@dataclass
class Chosen:
    folder: str  # the place, as chosen
    locked: bool
    copied: str = ""  # when a copy was last made there
    problem: str = ""  # why the last copy couldn't be made, if it couldn't


def _settings(ctx: Context) -> Path:
    return ctx.data_dir / SETTINGS


def chosen(ctx: Context) -> Chosen | None:
    try:
        saved = json.loads(_settings(ctx).read_text(encoding="utf-8"))
        return Chosen(**saved)
    except OSError, ValueError, TypeError:
        return None


def _save(ctx: Context, choice: Chosen) -> None:
    path = _settings(ctx)
    partial = path.with_name(path.name + ".part")
    partial.write_text(json.dumps(asdict(choice), indent=1), encoding="utf-8")
    os.replace(partial, path)


def family_folder(ctx: Context, place: Path) -> Path:
    """Where this family's copies go in the place: a folder of its own, by its id."""
    return place / (f"AncesTree {ctx.family.id}" if ctx.family else "AncesTree backups")


def choose(ctx: Context, folder: str, password: str | None) -> Chosen:
    """Copies of every backup from now on in `folder`, locked with `password` if there's one.
    The folder must exist; this family's own goes inside it."""
    place = Path(folder.strip()).expanduser()
    if not place.is_absolute() or not place.is_dir():
        raise RuleError(
            "no_such_folder",
            f"There's no folder {folder.strip()!r} on this computer: plug in the disk, or choose "
            "another.",
        )
    if place.resolve() in (ctx.backups.resolve(), ctx.data_dir.resolve()):
        raise RuleError("same_place", "That's where the backups are already: choose another place.")
    key_path = ctx.data_dir / KEY
    if password:
        if len(password) < 8:
            raise RuleError(
                "short_password", "A password for the copies needs 8 characters or more."
            )
        try:
            write_secret(key_path, Key.from_password(password).saved())
        except (ProtectError, OSError) as error:
            raise RuleError(
                "cant_be_locked", f"The copies' key couldn't be kept on this computer ({error})."
            ) from error
    else:
        key_path.unlink(missing_ok=True)
    choice = Chosen(str(place), locked=bool(password))
    _save(ctx, choice)
    return choice


def stop(ctx: Context) -> None:
    """No more copies elsewhere; those made stay where they are."""
    _settings(ctx).unlink(missing_ok=True)
    (ctx.data_dir / KEY).unlink(missing_ok=True)


def _key(ctx: Context) -> Key:
    stored = read_secret(ctx.data_dir / KEY)
    if stored is None:
        raise ProtectError("the copies' key isn't here")
    return Key.load(stored)


def _copy_name(backup: Path, locked: bool) -> str:
    return backup.stem + (SUFFIX if locked else ".zip")


def _is_backup_copy(name: str) -> bool:
    return name.startswith("ancestree-backup-") and name.endswith((".zip", SUFFIX))


def catch_up(ctx: Context) -> int:
    """Copy every backup not copied yet to the place chosen, and tidy the daily copies there;
    how many were copied. What's in the way is noted for Settings to say, never raised."""
    choice = chosen(ctx)
    if choice is None:
        return 0
    target = family_folder(ctx, Path(choice.folder))
    copied = 0
    try:
        if not Path(choice.folder).is_dir():
            raise FileNotFoundError(choice.folder)
        target.mkdir(exist_ok=True)
        key = _key(ctx) if choice.locked else None
        there = {path.name for path in target.iterdir()}
        backups = sorted(ctx.backups.glob("ancestree-backup-*.zip")) if ctx.backups.is_dir() else []
        for backup in backups:
            name = _copy_name(backup, key is not None)
            if name in there:
                continue
            if key is not None:
                lock(backup, target / name, key)
            else:
                partial = target / (name + ".partial")
                shutil.copyfile(backup, partial)
                partial.replace(target / name)
            copied += 1
        _tidy(target)
        choice.problem = ""
        if copied or not choice.copied:
            choice.copied = datetime.now(UTC).isoformat(timespec="seconds")
    except FileNotFoundError:
        choice.problem = f"{choice.folder} can't be reached: is its disk plugged in?"
    except ProtectError:
        choice.problem = (
            "The copies' key can't be opened on this computer: choose the place again, with "
            "the password."
        )
    except OSError as error:
        choice.problem = (
            f"The copies couldn't be made in {choice.folder} ({error.strerror or error})."
        )
    if choice.problem:
        log.warning("Backups weren't copied elsewhere: %s", choice.problem)
    _save(ctx, choice)
    return copied


def _tidy(target: Path) -> None:
    """The daily copies beyond the last 30 go, as the daily backups do; those of backups made
    by hand stay."""
    daily = sorted(
        path
        for path in target.iterdir()
        if _is_backup_copy(path.name) and is_automatic(path.stem + ".zip")
    )
    for path in daily[:-KEEP_AUTOMATIC] if len(daily) > KEEP_AUTOMATIC else []:
        path.unlink(missing_ok=True)


def status(ctx: Context) -> Elsewhere | None:
    """The place chosen, and how its copies stand, for Settings."""
    choice = chosen(ctx)
    if choice is None:
        return None
    target = family_folder(ctx, Path(choice.folder))
    try:
        copies = sorted(path.name for path in target.iterdir() if _is_backup_copy(path.name))
        reachable = True
    except OSError:
        copies, reachable = [], False
    made = {Path(name).stem for name in copies}
    backups = sorted(ctx.backups.glob("ancestree-backup-*.zip")) if ctx.backups.is_dir() else []
    waiting = [backup.name for backup in backups if backup.stem not in made]
    return Elsewhere(
        folder=choice.folder,
        inside=str(target),
        locked=choice.locked,
        reachable=reachable,
        copies=len(copies),
        waiting=len(waiting),
        copied=datetime.fromisoformat(choice.copied) if choice.copied else None,
        problem=choice.problem,
    )


def places() -> list[CopyPlace]:
    """Places on this computer that suit copies: removable disks and other drives, and the
    folders OneDrive, Dropbox and Google Drive's own app keep. Only those there now."""
    found: list[CopyPlace] = []
    home = Path.home()
    if sys.platform == "win32":
        system = os.environ.get("SYSTEMDRIVE", "C:").rstrip("\\").upper()
        drives = os.listdrives() if hasattr(os, "listdrives") else []
        for drive in drives or [f"{letter}:\\" for letter in string.ascii_uppercase]:
            name = drive.rstrip("\\").upper()
            if name == system:
                continue
            try:
                if Path(drive).is_dir():
                    found.append(CopyPlace(path=drive, kind="disk", name=f"Drive {name}"))
            except OSError:
                continue
        for variable, name in (("OneDrive", "OneDrive"), ("OneDriveConsumer", "OneDrive")):
            value = os.environ.get(variable)
            if value and Path(value).is_dir():
                found.append(CopyPlace(path=value, kind="cloud", name=name))
                break
    elif sys.platform == "darwin":
        volumes = Path("/Volumes")
        for volume in sorted(volumes.iterdir()) if volumes.is_dir() else []:
            if volume.is_dir() and not volume.is_symlink():
                found.append(CopyPlace(path=str(volume), kind="disk", name=volume.name))
        cloud = home / "Library" / "CloudStorage"
        for folder in sorted(cloud.iterdir()) if cloud.is_dir() else []:
            name = folder.name.split("-")[0]
            found.append(CopyPlace(path=str(folder), kind="cloud", name=name))
    else:
        for media in (Path("/media") / home.name, Path("/run/media") / home.name):
            for volume in sorted(media.iterdir()) if media.is_dir() else []:
                found.append(CopyPlace(path=str(volume), kind="disk", name=volume.name))
    for name in ("Dropbox", "Google Drive", "OneDrive"):
        folder = home / name
        if folder.is_dir() and not any(place.path == str(folder) for place in found):
            found.append(CopyPlace(path=str(folder), kind="cloud", name=name))
    return found
