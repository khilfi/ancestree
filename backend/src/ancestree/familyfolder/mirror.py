"""This computer's copy of the family folder, kept in step with the folder in Google Drive.

The family folder's code (computers.py) reads and writes files in a folder here, as it did in
spike S6 through a folder a sync service kept. The mirror carries them between that folder and
Drive itself, so nothing else needs installing:

- pull: each file in Drive that's new here, or changed, comes down whole, checked against
  Drive's checksum. A file gone from Drive for a few minutes goes from here too, so the
  keeper's repair can put back one of its own;
- push: each file written here since comes up whole: a new one as a new file in Drive, and one
  of this computer's own that was written again (the keeper's repair) as new contents.

The folder here can gather files from more than one folder in Drive, the family folder and
relatives' own folders, each mirror carrying its own part of it (`carries`).

What it knows is kept in a manifest: each file's id in Drive, its checksum, whose it is, and
how its copy here looked, so unchanged files aren't read again. It's saved after every file,
so a connection lost midway never leaves a file sent twice.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from ancestree.familyfolder.drive import DriveError, DriveLike, md5

# A file missing from Drive's listing this long is taken as gone: a file just sent may take a
# moment to be listed.
GONE_AFTER = 300.0
# A file written this recently could be written again within the same tick of the clock, the
# same size, and look unchanged: it's read again next time instead (git's "racy" files).
RACY_NS = 2_000_000_000
# The largest file a folder in Drive may hold: a relative's whole family, sent for review, is
# the largest the family folder writes. Anything bigger isn't AncesTree's, and isn't fetched.
LARGEST = 300 * 1024 * 1024
# Each part of a path here, as AncesTree names its files: a file in Drive named otherwise is
# never brought down. Its name could otherwise lead outside this folder ("..", "/", "\\",
# a drive letter), and the folder in Drive may be a relative's, written by anyone.
PART = re.compile(r"[A-Za-z0-9_-](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?")
# Names Windows keeps for its devices, with any extension: "NUL.txt" is the device too.
DEVICES = re.compile(r"(?:CON|PRN|AUX|NUL|COM\d|LPT\d)(?:\..*)?", re.IGNORECASE)

log = logging.getLogger(__name__)


def safe_path(relative: str) -> bool:
    """Whether a path in the folder is one AncesTree could have written: parts of letters,
    digits, dots, dashes and underscores only, none of them "." or "..", and not too deep."""
    parts = relative.split("/")
    return 0 < len(parts) <= 4 and all(
        PART.fullmatch(part) and ".." not in part and not DEVICES.fullmatch(part) for part in parts
    )


@dataclass
class Known:
    id: str
    md5: str
    owner: str  # the Google account the file in Drive belongs to
    size: int = -1  # the copy here, when last seen, to tell whether it changed since
    mtime: int = -1
    missing: float = 0.0  # when it was first missing from Drive's listing, if it is


def _looks(stat: os.stat_result) -> tuple[int, int]:
    """How a file here looks, to tell later whether it changed: its size and modified time, or
    no time for one written just now."""
    racy = time.time_ns() - stat.st_mtime_ns < RACY_NS
    return stat.st_size, -1 if racy else stat.st_mtime_ns


class Mirror:
    def __init__(
        self,
        drive: DriveLike,
        root: str,
        local: Path,
        state: Path,
        me: str = "",
        carries: Callable[[str], bool] = lambda _: True,
    ) -> None:
        self.drive = drive
        self.me = me  # this computer's Google account: only its own files are ever changed
        self.carries = carries  # which of the files here, by path, are this mirror's to carry
        self.root = root
        self.local = local
        self.state = state
        self.passed_over: set[str] = set()  # files in Drive this mirror won't bring down
        self.files: dict[str, Known] = {}
        self.folders: dict[str, str] = {"": root}
        if state.is_file():
            saved = json.loads(state.read_text(encoding="utf-8"))
            self.files = {path: Known(**known) for path, known in saved["files"].items()}
            self.folders = saved["folders"] | {"": root}

    def _save(self) -> None:
        self.state.parent.mkdir(parents=True, exist_ok=True)
        partial = self.state.with_name(self.state.name + ".part")
        saved = {
            "files": {path: asdict(known) for path, known in sorted(self.files.items())},
            "folders": self.folders,
        }
        partial.write_text(json.dumps(saved, indent=1), encoding="utf-8")
        os.replace(partial, self.state)

    def owner(self, relative: str) -> str:
        """Whose Google account a file in the family folder belongs to; empty if unknown."""
        known = self.files.get(relative)
        return known.owner if known else ""

    def listed(self, relative: str) -> bool:
        """Whether a file was in Drive at the last pull: one gone from Drive since stays here
        a few minutes more, as Drive can be slow to list a file just sent."""
        known = self.files.get(relative)
        return known is not None and not known.missing

    def sent(self, relative: str) -> bool:
        """Whether a file here is in Drive just as it is here, as this copy last knew Drive."""
        known = self.files.get(relative)
        try:
            data = (self.local / relative).read_bytes()
        except OSError:
            return False
        return known is not None and known.md5 == md5(data)

    def _here(self, relative: str) -> Path:
        """Where a file of the folder is kept here: always inside this folder."""
        path = self.local / relative
        if not safe_path(relative) or not path.resolve().is_relative_to(self.local.resolve()):
            raise ValueError(f"Not a path in the family folder: {relative!r}")
        return path

    def bin(self, relative: str) -> None:
        """One of this account's files taken out of the folder for good: put in Drive's bin,
        where it stays a while, and gone from here."""
        known = self.files.get(relative)
        if known is not None:
            try:
                self.drive.trash(known.id)
            except DriveError as error:
                if error.status != 404:
                    raise
            del self.files[relative]
            self._save()
        self._here(relative).unlink(missing_ok=True)

    def _walk(self) -> dict[str, tuple[str, str | None, str]]:
        """Every file in the folder in Drive: its path here, with its id, checksum and owner.
        Two folders of one name are read as one. A folder this account can no longer reach is
        Drive's 404: listed, it would only seem empty."""
        self.drive.get(self.root)
        files: dict[str, tuple[str, str | None, str]] = {}
        folders: dict[str, str] = {"": self.root}
        pending = [("", self.root)]
        while pending:
            path, folder_id = pending.pop()
            for item in self.drive.children(folder_id):
                relative = f"{path}/{item.name}" if path else item.name
                if not safe_path(relative):
                    self._pass_over(relative, "its name isn't one AncesTree gives")
                elif item.folder:
                    folders.setdefault(relative, item.id)
                    pending.append((relative, item.id))
                elif relative in files or not self.carries(relative):
                    continue
                elif item.size is not None and item.size > LARGEST:
                    self._pass_over(relative, f"it's too large ({item.size} bytes)")
                else:
                    files[relative] = (item.id, item.md5, item.owner)
        self.folders = folders
        return files

    def _pass_over(self, relative: str, why: str) -> None:
        """A file in Drive that isn't brought down, said once in the log."""
        if relative not in self.passed_over:
            self.passed_over.add(relative)
            log.warning("A file in the family folder in Drive was passed over: %s", why)

    def _write_here(self, relative: str, data: bytes) -> os.stat_result:
        path = self._here(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(data)
        os.replace(partial, path)
        return path.stat()

    def pull(self) -> int:
        """Bring down what's new or changed in Drive; how many files came."""
        remote = self._walk()
        fetched = 0
        try:
            for relative, (file_id, checksum, owner) in sorted(remote.items()):
                known = self.files.get(relative)
                if known is not None and known.id == file_id and known.md5 == checksum:
                    known.owner, known.missing = owner, 0.0
                    continue
                data = self.drive.download(file_id)
                if len(data) > LARGEST:
                    self._pass_over(relative, f"it's too large ({len(data)} bytes)")
                    continue
                if checksum and md5(data) != checksum:
                    continue  # changed while it came down: next time
                stat = self._write_here(relative, data)
                self.files[relative] = Known(file_id, checksum or md5(data), owner, *_looks(stat))
                fetched += 1
            now = time.time()
            for relative, known in list(self.files.items()):
                if relative in remote:
                    continue
                if not known.missing:
                    known.missing = now
                elif now - known.missing >= GONE_AFTER:
                    if safe_path(relative):
                        self._here(relative).unlink(missing_ok=True)
                    del self.files[relative]
        finally:
            self._save()
        return fetched

    def _folder(self, relative: str) -> str:
        """The id of a folder in Drive, made there first if it isn't yet, with its parents."""
        if relative in self.folders:
            return self.folders[relative]
        parent, _, name = relative.rpartition("/")
        made = self.drive.create_folder(name, self._folder(parent))
        self.folders[relative] = made.id
        return made.id

    def push(self) -> int:
        """Send up what was written here since; how many files went."""
        sent = 0
        try:
            for path in sorted(self.local.rglob("*")):
                if not path.is_file() or path.name.endswith(".part"):
                    continue
                relative = path.relative_to(self.local).as_posix()
                if not self.carries(relative):
                    continue
                stat = path.stat()
                known = self.files.get(relative)
                if known is not None and (known.size, known.mtime) == (
                    stat.st_size,
                    stat.st_mtime_ns,
                ):
                    continue
                data = path.read_bytes()
                checksum = md5(data)
                if known is not None and known.md5 == checksum:
                    known.size, known.mtime = _looks(stat)
                    continue
                if known is not None and self.me and known.owner.casefold() != self.me.casefold():
                    continue  # someone else's file, changed here: never sent as ours
                if known is not None:
                    item = self.drive.replace(known.id, data)
                else:
                    folder, _, _ = relative.rpartition("/")
                    item = self.drive.upload(path.name, self._folder(folder), data)
                self.files[relative] = Known(
                    item.id, item.md5 or checksum, item.owner, *_looks(stat)
                )
                sent += 1
                self._save()
        finally:
            self._save()
        return sent
