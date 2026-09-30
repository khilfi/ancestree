import json
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid7

import pytest

from ancestree.storage.files import (
    atomic_write,
    list_trash,
    move_to_trash,
    person_dir,
    purge_trash,
    read_trash_item,
    remove_bare_folders,
    take_out_of_trash,
    write_snapshot,
)


def test_only_folders_holding_nothing_but_person_json_are_removed(tmp_path: Path) -> None:
    bare, with_photo, missing = str(uuid7()), str(uuid7()), str(uuid7())
    write_snapshot(tmp_path, bare, {"full_name": "Bare"})
    write_snapshot(tmp_path, with_photo, {"full_name": "Pictured"})
    atomic_write(person_dir(tmp_path, with_photo) / "profile" / "original.jpg", b"jpeg")

    removed = remove_bare_folders(tmp_path, [bare, with_photo, missing])

    assert removed == 1
    assert not person_dir(tmp_path, bare).exists()
    assert (person_dir(tmp_path, with_photo) / "profile" / "original.jpg").exists()


def test_atomic_write_replaces_the_whole_file_and_leaves_no_temp_files(tmp_path: Path) -> None:
    target = tmp_path / "people" / "x" / "person.json"
    atomic_write(target, b"first")
    atomic_write(target, b"second")

    assert target.read_bytes() == b"second"
    assert [p.name for p in target.parent.iterdir()] == ["person.json"]


def test_person_folders_are_named_by_id_only(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="badly formed"):
        person_dir(tmp_path, "../../Windows")


def test_trash_keeps_the_folder_and_tombstone_until_restored(tmp_path: Path) -> None:
    person_id = str(uuid7())
    story = person_dir(tmp_path, person_id) / "biography.md"
    story.parent.mkdir(parents=True)
    story.write_text("A life.", encoding="utf-8")

    entry = move_to_trash(tmp_path, person_id, {"person": {"id": person_id}, "links": []})

    assert not story.exists()
    assert [item.entry for item in list_trash(tmp_path)] == [entry]
    assert read_trash_item(tmp_path, entry).tombstone["person"]["id"] == person_id

    take_out_of_trash(tmp_path, entry, person_id)

    assert story.read_text(encoding="utf-8") == "A life."
    assert list_trash(tmp_path) == []


def test_trash_entries_names_are_checked(tmp_path: Path) -> None:
    with pytest.raises(KeyError):
        read_trash_item(tmp_path, "../people")


def test_entries_older_than_thirty_days_are_emptied(tmp_path: Path) -> None:
    fresh = move_to_trash(tmp_path, str(uuid7()), {"person": {}, "links": []})
    old = move_to_trash(tmp_path, str(uuid7()), {"person": {}, "links": []})
    tombstone = tmp_path / "trash" / old / "tombstone.json"
    stale = json.loads(tombstone.read_text(encoding="utf-8"))
    stale["deleted_at"] = (datetime.now().astimezone() - timedelta(days=31)).isoformat()
    tombstone.write_text(json.dumps(stale), encoding="utf-8")

    assert purge_trash(tmp_path) == 1
    assert [item.entry for item in list_trash(tmp_path)] == [fresh]
