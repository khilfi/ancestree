"""Several families on one computer (0.4.0): each completely apart, one open at a time.

AncesTree's own folder holds `families.json`: the families on this computer, each one's name and
folder, and which is open. Every family's folder holds the same three:

    family/    its data folder: photos, stories, settings, the Trash, its family folder's part
    neo4j/     its own database: its settings, its store, its password
    backups/   its backups

The family there before 0.4.0 stays where it was, as the first: its folder is AncesTree's own
folder. Each family added since has one of its own, families/<id>/. Neo4j and its Java, in
neo4j/runtime/ of AncesTree's own folder, serve every family and hold none.

The engine opens one family, and is given that family's folders alone: one family's database
can't show another's people, as no filter keeps them apart that could be missed. Switching is
the engine starting again on the other family's folders.

A family removed goes to removed/, with its three folders, for 30 days, and can be put back;
then it's deleted, as people are from the Trash.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

FILE = "families.json"
FIRST = "."  # the first family's folder: AncesTree's own, where it always was
REMOVED = "removed"
KEEP_REMOVED = timedelta(days=30)
ID = re.compile(r"[0-9a-f]{16}")
NAME_LENGTH = 60
# A family's database files in its neo4j/ folder: Neo4j's program and Java, in the first
# family's, aren't its own.
DATABASE = ("conf", "store", "password")


class FamiliesError(Exception):
    """What can't be done with the families here, in plain words, with a code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Family:
    id: str
    name: str
    folder: str  # relative to AncesTree's own folder
    added: str
    # What the family last said of itself while open: its part in a family folder ("keeper",
    # "member", or "" for none) and when it was last in step with it.
    role: str = ""
    in_step: str = ""
    # A backup to restore when it next opens, by name in its backups/: a family added from it.
    restore: str = ""
    removed: str = ""  # when it was removed, if it's in removed/


@dataclass(frozen=True)
class Places:
    """A family's three folders."""

    data: Path
    neo4j: Path
    backups: Path


def clean_name(name: str) -> str:
    """A family's name as it's kept: on one line, without spaces around it."""
    cleaned = " ".join(name.split())[:NAME_LENGTH]
    if not cleaned:
        raise FamiliesError("no_name", "A family needs a name.")
    return cleaned


@dataclass
class Families:
    """The families on this computer, kept in `families.json` in AncesTree's own folder."""

    root: Path
    open_id: str = ""
    families: list[Family] = field(default_factory=list)
    removed: list[Family] = field(default_factory=list)

    @classmethod
    def load(cls, root: Path, first_name: str = "My family") -> Families:
        """The families here; the first time, the family already here, as the first."""
        path = root / FILE
        if not path.is_file():
            first = Family(secrets.token_hex(8), clean_name(first_name), FIRST, _now())
            families = cls(root, first.id, [first])
            families.save()
            return families
        saved = json.loads(path.read_text(encoding="utf-8"))
        families = cls(
            root,
            saved["open"],
            [Family(**family) for family in saved["families"]],
            [Family(**family) for family in saved.get("removed", [])],
        )
        if families.find(families.open_id) is None:
            families.open_id = families.families[0].id  # chosen, then removed by hand
        return families

    def save(self) -> None:
        """Written whole: under a temporary name, then renamed, so a power cut never leaves
        half of it."""
        self.root.mkdir(parents=True, exist_ok=True)
        saved = {
            "format": 1,
            "open": self.open_id,
            "families": [asdict(family) for family in self.families],
            "removed": [asdict(family) for family in self.removed],
        }
        partial = self.root / f"{FILE}.part"
        partial.write_text(json.dumps(saved, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(partial, self.root / FILE)

    # Finding

    def find(self, family_id: str) -> Family | None:
        return next((family for family in self.families if family.id == family_id), None)

    def get(self, family_id: str) -> Family:
        family = self.find(family_id)
        if family is None:
            raise FamiliesError("no_such_family", "There's no such family on this computer.")
        return family

    @property
    def open(self) -> Family:
        return self.get(self.open_id)

    def places(self, family: Family) -> Places:
        folder = self.root / family.folder
        return Places(folder / "family", folder / "neo4j", folder / "backups")

    # Changing

    def add(self, name: str, family_id: str | None = None) -> Family:
        """A new family, empty, in a folder of its own; `family_id`: the id it had elsewhere,
        when it comes from a backup."""
        if family_id is not None and (self.find(family_id) or self._removed(family_id)):
            raise FamiliesError(
                "family_here",
                "That family is on this computer already. Open it, and restore the backup there.",
            )
        family_id = family_id or secrets.token_hex(8)
        family = Family(family_id, clean_name(name), f"families/{family_id}", _now())
        for place in (self.places(family).data, self.places(family).backups):
            place.mkdir(parents=True, exist_ok=True)
        self.families.append(family)
        self.save()
        return family

    def rename(self, family_id: str, name: str) -> Family:
        family = self.get(family_id)
        family.name = clean_name(name)
        self.save()
        return family

    def choose(self, family_id: str) -> Family:
        """The family to open at the next start."""
        family = self.get(family_id)
        self.open_id = family.id
        self.save()
        return family

    def note(self, family_id: str, **what: str) -> None:
        """What a family says of itself while open: its part, when it was last in step, that
        its backup is restored."""
        family = self.find(family_id)
        if family is None:
            return
        changed = False
        for key, value in what.items():
            if getattr(family, key) != value:
                setattr(family, key, value)
                changed = True
        if changed:
            self.save()

    def remove(self, family_id: str) -> Family:
        """A family out of the way: in removed/, with its three folders, for 30 days. Not the
        open one, whose database runs."""
        family = self.get(family_id)
        if family.id == self.open_id:
            raise FamiliesError(
                "family_open", "The family that's open can't be removed: open another first."
            )
        stamp = datetime.now().astimezone().strftime("%Y-%m-%dT%H-%M-%S")
        aside = self.root / REMOVED / f"{family.id}-{stamp}"
        aside.mkdir(parents=True)
        if family.folder == FIRST:
            # Its folders sit beside Neo4j's program and Java, which stay.
            places = self.places(family)
            for place, name in ((places.data, "family"), (places.backups, "backups")):
                if place.exists():
                    place.rename(aside / name)
            (aside / "neo4j").mkdir()
            for name in DATABASE:
                if (places.neo4j / name).exists():
                    (places.neo4j / name).rename(aside / "neo4j" / name)
        else:
            source = self.root / family.folder
            if source.exists():
                for item in source.iterdir():
                    item.rename(aside / item.name)
                source.rmdir()
        self.families.remove(family)
        family.folder = aside.relative_to(self.root).as_posix()
        family.removed = _now()
        self.removed.append(family)
        self.save()
        return family

    def _removed(self, family_id: str) -> Family | None:
        return next((family for family in self.removed if family.id == family_id), None)

    def put_back(self, family_id: str) -> Family:
        """A removed family back among the others, in a folder of its own."""
        family = self._removed(family_id)
        if family is None:
            raise FamiliesError("no_such_family", "There's no such family in AncesTree's bin.")
        target = self.root / "families" / family.id
        if target.exists():
            raise FamiliesError("family_here", "That family's folder is in use already.")
        target.parent.mkdir(parents=True, exist_ok=True)
        (self.root / family.folder).rename(target)
        self.removed.remove(family)
        family.folder = target.relative_to(self.root).as_posix()
        family.removed = ""
        self.families.append(family)
        self.save()
        return family

    def tidy(self, now: datetime | None = None) -> list[str]:
        """Families removed over 30 days ago, deleted; the names of those that went."""
        now = now or datetime.now(UTC)
        gone: list[str] = []
        for family in list(self.removed):
            if now - datetime.fromisoformat(family.removed) < KEEP_REMOVED:
                continue
            shutil.rmtree(self.root / family.folder, ignore_errors=True)
            self.removed.remove(family)
            gone.append(family.name)
        if gone:
            self.save()
        return gone

    def listed(self) -> dict[str, Any]:
        """The families, as the app shows them."""
        return {
            "open": self.open_id,
            "families": [_shown(family, self.open_id) for family in self.families],
            "removed": [
                {"id": family.id, "name": family.name, "removed": family.removed}
                for family in self.removed
            ],
        }


def _shown(family: Family, open_id: str) -> dict[str, Any]:
    return {
        "id": family.id,
        "name": family.name,
        "open": family.id == open_id,
        "role": family.role,
        "in_step": family.in_step or None,
        "added": family.added,
    }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
