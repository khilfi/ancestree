"""Several families on one computer (0.4.0): the list of them, and each family's folders apart."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from ancestree.desktop.families import FILE, Families, FamiliesError


def made_before_0_4_0(root: Path) -> None:
    """AncesTree's own folder as an earlier version left it: one family, and Neo4j's program."""
    for folder in ("family/people/p1", "backups", "neo4j/store/data", "neo4j/conf", "logs"):
        (root / folder).mkdir(parents=True)
    (root / "neo4j" / "password").write_text("made-up", encoding="utf-8")
    (root / "neo4j" / "runtime" / "neo4j-community").mkdir(parents=True)
    (root / "family" / "people" / "p1" / "person.json").write_text("{}", encoding="utf-8")
    (root / "backups" / "ancestree-backup-2026-10-01T09-00-00.zip").write_bytes(b"zip")


def test_the_family_already_here_stays_where_it_is_as_the_first(tmp_path: Path) -> None:
    made_before_0_4_0(tmp_path)
    families = Families.load(tmp_path, "Keluarga Contoh")
    first = families.open
    assert (first.name, first.folder) == ("Keluarga Contoh", ".")
    places = families.places(first)
    assert (places.data, places.neo4j, places.backups) == (
        tmp_path / "family",
        tmp_path / "neo4j",
        tmp_path / "backups",
    )
    assert (tmp_path / "family" / "people" / "p1" / "person.json").is_file()  # nothing moved
    again = Families.load(tmp_path, "Another name")  # the list is kept: the same family
    assert (again.open.id, again.open.name) == (first.id, "Keluarga Contoh")
    assert json.loads((tmp_path / FILE).read_text(encoding="utf-8"))["format"] == 1


def test_each_family_added_has_folders_of_its_own(tmp_path: Path) -> None:
    families = Families.load(tmp_path)
    added = families.add("  Keluarga   Ibu ")
    assert added.name == "Keluarga Ibu"
    assert added.folder == f"families/{added.id}"
    places = families.places(added)
    assert places.data.is_dir()
    assert places.backups.is_dir()
    assert places.neo4j == tmp_path / "families" / added.id / "neo4j"
    assert families.places(families.open) != places
    assert families.open.name == "My family"  # adding opens nothing

    families.choose(added.id)
    assert Families.load(tmp_path).open.id == added.id
    families.rename(added.id, "Mother's side")
    assert Families.load(tmp_path).open.name == "Mother's side"
    with pytest.raises(FamiliesError) as nameless:
        families.add("   ")
    assert nameless.value.code == "no_name"


def test_a_family_from_a_backup_keeps_its_id_and_comes_once(tmp_path: Path) -> None:
    families = Families.load(tmp_path)
    added = families.add("From a backup", family_id="3f9c0a1b2c3d4e5f")
    assert added.id == "3f9c0a1b2c3d4e5f"
    with pytest.raises(FamiliesError) as twice:
        families.add("Again", family_id="3f9c0a1b2c3d4e5f")
    assert twice.value.code == "family_here"


def test_the_open_family_cant_be_removed(tmp_path: Path) -> None:
    families = Families.load(tmp_path)
    with pytest.raises(FamiliesError) as refused:
        families.remove(families.open.id)
    assert refused.value.code == "family_open"


def test_a_family_removed_waits_in_the_bin_and_can_be_put_back(tmp_path: Path) -> None:
    families = Families.load(tmp_path)
    added = families.add("Keluarga Ibu")
    story = families.places(added).data / "people" / "p2" / "biography.md"
    story.parent.mkdir(parents=True)
    story.write_text("# A made-up story\n", encoding="utf-8")

    removed = families.remove(added.id)
    assert removed.folder.startswith("removed/")
    assert not (tmp_path / "families" / added.id).exists()
    assert (tmp_path / removed.folder / "family" / "people" / "p2" / "biography.md").is_file()
    listed = Families.load(tmp_path).listed()
    assert [family["name"] for family in listed["families"]] == ["My family"]
    assert [family["name"] for family in listed["removed"]] == ["Keluarga Ibu"]

    back = families.put_back(added.id)
    assert back.folder == f"families/{added.id}"
    assert (families.places(back).data / "people" / "p2" / "biography.md").is_file()
    assert Families.load(tmp_path).listed()["removed"] == []


def test_the_first_family_removed_leaves_neo4j_s_program_behind(tmp_path: Path) -> None:
    made_before_0_4_0(tmp_path)
    families = Families.load(tmp_path, "Keluarga Contoh")
    first = families.open
    other = families.add("Keluarga Ibu")
    families.choose(other.id)

    removed = families.remove(first.id)
    aside = tmp_path / removed.folder
    assert (aside / "family" / "people" / "p1" / "person.json").is_file()
    assert (aside / "backups" / "ancestree-backup-2026-10-01T09-00-00.zip").is_file()
    assert (aside / "neo4j" / "password").is_file()
    assert (aside / "neo4j" / "store" / "data").is_dir()
    assert (tmp_path / "neo4j" / "runtime" / "neo4j-community").is_dir()  # for every family
    assert not (tmp_path / "family").exists()

    back = families.put_back(first.id)  # into a folder of its own, like any other
    assert back.folder == f"families/{first.id}"
    assert (families.places(back).neo4j / "password").is_file()


def test_families_removed_over_30_days_ago_are_deleted(tmp_path: Path) -> None:
    families = Families.load(tmp_path)
    old = families.add("Long gone")
    recent = families.add("Just removed")
    families.remove(old.id)
    families.remove(recent.id)
    removed = {family.id: family for family in families.removed}
    removed[old.id].removed = (datetime.now(UTC) - timedelta(days=31)).isoformat()
    families.save()
    gone_folder = tmp_path / removed[old.id].folder

    assert families.tidy() == ["Long gone"]
    assert not gone_folder.exists()
    assert [family.name for family in Families.load(tmp_path).removed] == ["Just removed"]


def test_what_a_family_says_of_itself_is_kept(tmp_path: Path) -> None:
    families = Families.load(tmp_path)
    first = families.open
    families.note(first.id, role="keeper", in_step="2026-10-03T14:02:00+00:00")
    [shown] = Families.load(tmp_path).listed()["families"]
    assert (shown["open"], shown["role"], shown["in_step"]) == (
        True,
        "keeper",
        "2026-10-03T14:02:00+00:00",
    )
    families.note("not-here", role="member")  # a family no longer here: nothing to note


@pytest.mark.parametrize("family_id", ["../../Documents", "..", "0123456789ABCDEF", "x" * 16, ""])
def test_a_backup_naming_its_family_otherwise_gets_a_new_id(tmp_path: Path, family_id: str) -> None:
    """A family's id names its folder: one from a backup that isn't 16 hex digits was tampered
    with, and never becomes a folder's name."""
    families = Families.load(tmp_path / "ancestree", "Keluarga Contoh")
    added = families.add("From a backup", family_id=family_id)
    assert added.id != family_id
    assert added.folder == f"families/{added.id}"
    assert families.places(added).data.resolve().is_relative_to((tmp_path / "ancestree").resolve())
    assert not (tmp_path / "Documents").exists()


def test_a_family_whose_folder_lies_outside_is_never_used_or_deleted(tmp_path: Path) -> None:
    root = tmp_path / "ancestree"
    families = Families.load(root, "Keluarga Contoh")
    outside = tmp_path / "Documents"
    (outside / "keep.txt").parent.mkdir(parents=True)
    (outside / "keep.txt").write_text("mine", encoding="utf-8")
    saved = json.loads((root / FILE).read_text(encoding="utf-8"))
    stray = {**saved["families"][0], "id": "0123456789abcdef", "folder": "../Documents"}
    saved["removed"] = [{**stray, "removed": "2020-01-01T00:00:00+00:00"}]
    saved["families"].append({**stray, "id": "fedcba9876543210"})
    (root / FILE).write_text(json.dumps(saved), encoding="utf-8")
    families = Families.load(root)
    with pytest.raises(FamiliesError):
        families.places(families.get("fedcba9876543210"))
    families.tidy()
    assert (outside / "keep.txt").read_text(encoding="utf-8") == "mine"
