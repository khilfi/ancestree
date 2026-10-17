"""Backups kept for 3 months.

Every backup is kept for 92 days: the daily automatic ones, those made with Back up now, and the
safety ones made before an import or a restore. Older ones go to the system's bin, never
straight away for good, except the newest 3, whatever their age, so a family not opened for
months never loses every backup at once. A backup added from elsewhere counts its 3 months from
when it came, so an old one added to be restored isn't taken away at once (the user's word of
17 Oct 2026). The copies in another place are kept the same way.

What went last, and anything that couldn't go, is noted in the data folder (`binned.json`,
beside the backups' contents but never in them) for Settings → Backups to say.
"""

import json
import logging
import os
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timedelta
from pathlib import Path

from ancestree.domain.exports import BackupsBinned
from ancestree.services import elsewhere
from ancestree.services.context import Context
from ancestree.storage.system_bin import bin_name, to_bin

KEEP_FOR = timedelta(days=92)  # 3 months
KEEP_NEWEST = 3
NOTE = "binned.json"

# A backup, as made here or added, and its copy elsewhere, locked or not: its name says when
# it was made.
_BACKUP = re.compile(
    r"ancestree-backup-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)(?:-automatic)?(?:-\d+)?(?:\.zip|\.locked)"
)

log = logging.getLogger("uvicorn.error")


def dated(folder: Path) -> list[tuple[datetime, Path]]:
    """The backups in `folder`, oldest first, each with when its 3 months count from: when it
    was made, or, if it came later (added from elsewhere, or copied there), when it came."""
    found: list[tuple[datetime, Path]] = []
    for path in folder.glob("ancestree-backup-*") if folder.is_dir() else []:
        if not (match := _BACKUP.fullmatch(path.name)):
            continue
        made = datetime.strptime(match[1], "%Y-%m-%dT%H-%M-%S").astimezone()
        try:
            came = datetime.fromtimestamp(path.stat().st_mtime).astimezone()
        except OSError:
            continue
        found.append((max(made, came), path))
    return sorted(found)


def due(found: list[tuple[datetime, Path]], now: datetime) -> list[Path]:
    """Those over 3 months old, all but the newest 3."""
    older = sorted(found, reverse=True)[KEEP_NEWEST:]
    return [path for since, path in older if now - since > KEEP_FOR]


@dataclass
class Tidied:
    binned: list[str] = field(default_factory=list)  # gone to the bin
    stayed: list[str] = field(default_factory=list)  # due, but couldn't go
    why: str = ""  # why the first of those couldn't


def tidy(folder: Path, now: datetime, binning: Callable[[Path], object] = to_bin) -> Tidied:
    """Send the backups in `folder` that are due to the system's bin; those that can't go stay."""
    done = Tidied()
    for path in due(dated(folder), now):
        try:
            binning(path)
            done.binned.append(path.name)
        except OSError as error:  # BinError among them
            done.stayed.append(path.name)
            done.why = done.why or str(error)
    return done


@dataclass
class Note:
    at: str = ""  # when backups last went to the bin
    backups: int = 0
    copies: int = 0
    bin: str = ""
    stayed: int = 0  # due at the last look, but still there
    why: str = ""


def _note_path(ctx: Context) -> Path:
    return ctx.data_dir / NOTE


def _read(ctx: Context) -> Note:
    try:
        return Note(**json.loads(_note_path(ctx).read_text(encoding="utf-8")))
    except OSError, ValueError, TypeError:
        return Note()


def keep_three_months(
    ctx: Context, now: datetime | None = None, binning: Callable[[Path], object] = to_bin
) -> Note:
    """Tidy the backups, and their copies in another place if it's there; what's noted."""
    now = now or datetime.now().astimezone()
    backups = tidy(ctx.backups, now, binning)
    copies = Tidied()
    choice = elsewhere.chosen(ctx)
    if choice is not None:
        there = elsewhere.family_folder(ctx, Path(choice.folder))
        if there.is_dir():
            copies = tidy(there, now, binning)
    before = _read(ctx)
    note = replace(before)
    if backups.binned or copies.binned:
        note = Note(
            at=now.isoformat(timespec="seconds"),
            backups=len(backups.binned),
            copies=len(copies.binned),
            bin=bin_name(),
        )
        log.info(
            "To the %s, older than 3 months: %s",
            note.bin,
            ", ".join(backups.binned + copies.binned),
        )
    note.stayed = len(backups.stayed) + len(copies.stayed)
    note.why = backups.why or copies.why
    if note != before or not _note_path(ctx).exists():
        if note.stayed:
            log.warning("Backups older than 3 months stay: %s", note.why)
        if note != Note():
            _write(ctx, note)
    return note


def _write(ctx: Context, note: Note) -> None:
    path = _note_path(ctx)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_text(json.dumps(asdict(note), indent=1), encoding="utf-8")
    os.replace(partial, path)


def binned(ctx: Context) -> BackupsBinned | None:
    """What went to the bin last, and what couldn't go, for Settings → Backups."""
    note = _read(ctx)
    if not note.at and not note.stayed:
        return None
    return BackupsBinned(
        at=datetime.fromisoformat(note.at) if note.at else None,
        backups=note.backups,
        copies=note.copies,
        bin=note.bin or bin_name(),
        stayed=note.stayed,
        why=note.why,
    )
