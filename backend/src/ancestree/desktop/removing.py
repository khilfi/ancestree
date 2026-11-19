"""Removing AncesTree, with the backups safe.

Windows' uninstaller could always delete the families with the app, and their backups went
too, since they live in the same folder; nothing said so, and nothing warned the keeper. Its
page now says what goes in plain words, keeps the backups first, in Documents\\AncesTree
backups, unless that's unticked, and on the keeper's computer says what keeping the family
again needs (desktop/src-tauri/windows/hooks.nsh).

The uninstaller can't read the families' list, so AncesTree keeps a small note for it in its
own folder, `uninstall.ini`: each family's name, the folder its backups are in, the one they go
to in Documents, whether this computer keeps it, and when its backups were last copied to
another place, with the warning's sentences ready to show. The families in AncesTree's bin are
in it too, as they can still be put back: theirs go to a folder of their name and "(removed)".
It's written as Windows' own reading of such a note (GetPrivateProfileString) reads Unicode:
UTF-16, with its byte-order mark.

Settings → About's Remove AncesTree from this computer…, on every system, can first save the
backups to a folder anywhere, as the uninstaller keeps them. Then the shell takes over: on
Windows it starts the uninstaller; on the Mac and Linux, which have none, the engine moves
AncesTree's folder to the Bin (`to_bin`), from where it can be put back whole.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PureWindowsPath

from ancestree.desktop.downloads import free_name
from ancestree.desktop.families import FILE, Families, FamiliesError, Family
from ancestree.storage.system_bin import folder_to_bin

NOTE = "uninstall.ini"  # in AncesTree's own folder, for Windows' uninstaller
KEPT = "AncesTree backups"  # the folder the backups are kept in: in Documents, or wherever saved
BACKUPS = "ancestree-backup-*.zip"
# A backup copied to another place longer ago than this, or never, is said on the keeper's
# computer; the uninstaller counts it from the time it runs.
RECENT = timedelta(days=7)

# What Windows won't have in a folder's name, and the names it keeps for its devices.
_NOT_IN_A_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_DEVICES = {"con", "prn", "aux", "nul"} | {
    f"{kind}{n}" for kind in ("com", "lpt") for n in "123456789"
}


class RemovingError(Exception):
    """What can't be done to remove AncesTree, in plain words, with a code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def listed(names: list[str]) -> str:
    """Names in a sentence: "A", "A and B", "A, B and C"."""
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def keeps(names: list[str]) -> str:
    """The keeper's warning, for the families this computer keeps; "" for none."""
    if not names:
        return ""
    if len(names) == 1:
        return (
            f"This computer keeps {names[0]}. If you delete it, keeping the family again needs "
            "your recovery code, your Google project's client file and the keeper's Google "
            "account."
        )
    return (
        f"This computer keeps {listed(names)}. If you delete them, keeping each again needs "
        "its recovery code, its Google project's client file and its keeper's Google account."
    )


def not_copied(name: str, several: bool) -> str:
    """Said where none of a kept family's backups was copied to another place lately."""
    if several:
        return f"None of the backups of {name} has been copied to another place in the last 7 days."
    return "None of its backups has been copied to another place in the last 7 days."


def first(several: bool) -> str:
    """What the keeper's warning suggests first."""
    them = "them" if several else "it"
    return (
        f"First, you could hand {them} to another computer, with Hand the family to someone "
        "else… in AncesTree's Settings; or keep the backups, below."
    )


def folder_names(names: list[str]) -> list[str]:
    """A folder's name for each family's backups, from its name, as Windows allows one: nothing
    it refuses, no device's name, and no two the same, however capitalised."""
    taken: set[str] = set()
    found: list[str] = []
    for name in names:
        plain = _NOT_IN_A_NAME.sub("-", name).strip().rstrip(". ") or "A family"
        if plain.split(".")[0].strip().lower() in _DEVICES:
            plain = f"{plain} family"
        candidate, number = plain, 2
        while candidate.lower() in taken:
            candidate = f"{plain} ({number})"
            number += 1
        taken.add(candidate.lower())
        found.append(candidate)
    return found


@dataclass(frozen=True)
class Here:
    """A family on this computer, as removing AncesTree sees it."""

    family: Family
    backups: Path  # its backups' folder
    count: int  # how many backups it has there
    keeper: bool  # this computer keeps its family folder
    copied: datetime | None  # when its backups were last copied to another place, if ever
    folder: str  # its folder's name in AncesTree backups
    removed: bool = False  # in AncesTree's bin, for under 30 days: it can still be put back


def _read(path: Path) -> dict[str, object]:
    try:
        found = json.loads(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return {}
    return found if isinstance(found, dict) else {}


def _when(text: object) -> datetime | None:
    if not isinstance(text, str) or not text:
        return None
    try:
        when = datetime.fromisoformat(text)
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def families_here(families: Families) -> list[Here]:
    """Every family on this computer, then those in AncesTree's bin, which can still be put back
    and so keep their backups too, in a folder of their name and "(removed)" (the user's answer
    of 19 Nov 2026): where its backups are, whether this computer keeps it, from its family
    folder's own setup.json, and when its backups were last copied elsewhere: by Copies in
    another place, or saved to a folder here. One in the bin is never the one kept here: it's
    out of the list, and nothing of it keeps in step."""
    found: list[Here] = []
    every = [(family, False) for family in families.families]
    every += [(family, True) for family in families.removed]
    names = folder_names(
        [f"{family.name} (removed)" if removed else family.name for family, removed in every]
    )
    for (family, removed), folder in zip(every, names, strict=True):
        try:
            places = families.places(family)
        except FamiliesError:
            continue  # a folder outside AncesTree's own, whatever families.json says: never
        count = len(list(places.backups.glob(BACKUPS))) if places.backups.is_dir() else 0
        role = _read(places.data / "familyfolder" / "setup.json").get("role")
        elsewhere = _when(_read(places.data / "elsewhere.json").get("copied"))
        saved = _when(family.saved)
        copied = max((when for when in (elsewhere, saved) if when), default=None)
        keeper = role == "keeper" and not removed
        found.append(Here(family, places.backups, count, keeper, copied, folder, removed))
    return found


def note_text(here: list[Here]) -> str:
    """The note for Windows' uninstaller: how many families, the keeper's warning and what it
    suggests, then each family's name, backups, folder in Documents, whether it's in AncesTree's
    bin, whether it's kept here, when its backups were last copied elsewhere (seconds since 1970;
    0 for never), and what to say if that's over 7 days ago when the uninstaller runs."""
    kept = [each for each in here if each.keeper]
    several = len(kept) > 1
    lines = [
        "; AncesTree's note for its uninstaller: the families on this computer, written as",
        "; AncesTree runs. The uninstaller reads it; nothing else does.",
        "[AncesTree]",
        "format=1",
        f"families={len(here)}",
        f"warning={keeps([each.family.name for each in kept])}",
        f"first={first(several) if kept else ''}",
    ]
    for number, each in enumerate(here, start=1):
        lines += [
            f"[family{number}]",
            f"name={each.family.name}",
            f"backups={PureWindowsPath(each.family.folder, 'backups')}",
            f"folder={each.folder}",
            f"removed={int(each.removed)}",
            f"keeper={int(each.keeper)}",
            f"copied={int(each.copied.timestamp()) if each.copied else 0}",
            f"stale={not_copied(each.family.name, several) if each.keeper else ''}",
        ]
    return "\r\n".join(lines) + "\r\n"


def write_note(families: Families) -> bool:
    """The uninstaller's note, in AncesTree's own folder, written whole if it's changed; whether
    it was."""
    data = ("\ufeff" + note_text(families_here(families))).encode("utf-16-le")
    path = families.root / NOTE
    try:
        if path.read_bytes() == data:
            return False
    except OSError:
        pass
    partial = path.with_name(f"{NOTE}.part")
    partial.write_bytes(data)
    os.replace(partial, path)
    return True


@dataclass(frozen=True)
class Saved:
    folder: Path  # AncesTree backups, in the place chosen
    families: int  # how many families' backups are there
    backups: int  # how many backups in all
    copied: int  # how many were copied now: the rest were there already


def save_backups(families: Families, place: Path) -> Saved:
    """Every family's backups copied into `place`, each family's into a folder of its name in
    AncesTree backups, as the uninstaller keeps them in Documents: a USB stick, say. A backup
    there already isn't copied again; a file of its name that isn't it is never written over.
    Never into AncesTree's own folder, which goes with it."""
    if not place.is_absolute() or not place.is_dir():
        raise RemovingError(
            "no_such_folder",
            f"There's no folder {str(place)!r} on this computer: plug in the disk, or choose "
            "another.",
        )
    if place.resolve().is_relative_to(families.root.resolve()):
        raise RemovingError(
            "inside_ancestree",
            "That's in AncesTree's own folder, which goes with it: choose another place.",
        )
    target = place / KEPT
    counted = copied = with_backups = 0
    for each in families_here(families):
        backups = sorted(each.backups.glob(BACKUPS)) if each.backups.is_dir() else []
        if backups:
            with_backups += 1
        for backup in backups:
            counted += 1
            folder = target / each.folder
            there = folder / backup.name
            if there.is_file() and there.stat().st_size == backup.stat().st_size:
                continue
            folder.mkdir(parents=True, exist_ok=True)
            final = free_name(folder, backup.name)
            partial = final.with_name(f"{final.name}.partial")
            try:
                shutil.copyfile(backup, partial)
                os.replace(partial, final)
            finally:
                partial.unlink(missing_ok=True)
            copied += 1
    return Saved(target, with_backups, counted, copied)


def to_bin(root: Path, binning: Callable[[Path], str | None] = folder_to_bin) -> str | None:
    """AncesTree's own folder, every family's in it, to the Mac's Bin or Linux's Trash, from
    where it can be put back whole; where it went, when the system says. Only a folder that's
    AncesTree's, with its families' list in it; never on Windows, where the uninstaller does it."""
    if sys.platform == "win32":
        raise RemovingError("uninstaller", "On Windows, AncesTree's uninstaller removes it.")
    if not (root / FILE).is_file():
        raise RemovingError("not_ancestree", f"{root} isn't AncesTree's folder: nothing was moved.")
    return binning(root)
