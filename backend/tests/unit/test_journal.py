"""Who changed someone, and when: the journal in each person's folder, as the Undo
history tells it. Names are the fictional family's."""

from __future__ import annotations

import json
from pathlib import Path

from ancestree.services.history import LinkImage, PersonImage, Step
from ancestree.services.journal import journal_of, record
from ancestree.storage import journal as storage

HASSAN = "00000000-0000-4000-8000-000000000001"
SITI = "00000000-0000-4000-8000-000000000002"
UNKNOWN = "00000000-0000-4000-8000-000000000003"


def a_step(label: str, **parts: object) -> Step:
    step = Step(label=label)
    for name, value in parts.items():
        setattr(step, name, value)
    return step


def test_each_person_a_step_changed_gets_a_line(tmp_path: Path) -> None:
    hassan = {"id": HASSAN, "full_name": "Hassan bin Ismail"}
    link = {"id": "l1", "type": "PARENT_OF", "source": HASSAN, "target": SITI, "props": {}}
    step = a_step(
        "Link Hassan and Siti",
        people={HASSAN: PersonImage(hassan, {**hassan, "nickname": "Pak Hassan"})},
        links={"l1": LinkImage(None, link)},
    )
    record(tmp_path, step, "Home PC", "done")
    [line] = journal_of(tmp_path, HASSAN)
    assert (line.what, line.by, line.from_computer) == ("Link Hassan and Siti", "Home PC", None)
    assert [entry.what for entry in journal_of(tmp_path, SITI)] == ["Link Hassan and Siti"]

    record(tmp_path, step, "Home PC", "undone")
    assert [entry.what for entry in journal_of(tmp_path, HASSAN)] == [
        "Undid: Link Hassan and Siti",
        "Link Hassan and Siti",
    ]


def test_changes_brought_in_say_where_they_came_from(tmp_path: Path) -> None:
    siti = {"id": SITI, "full_name": "Siti binti Hassan"}
    step = a_step(
        "Changes from Mak Long's laptop",
        people={SITI: PersonImage(siti, {**siti, "occupation": "Teacher"})},
        sent_by={"computer": "Mak Long's laptop", "email": "r@example.com", "sent": "2026-10-02"},
    )
    record(tmp_path, step, "Home PC", "done")
    [line] = journal_of(tmp_path, SITI)
    assert (line.by, line.from_computer, line.from_email) == (
        "Home PC",
        "Mak Long's laptop",
        "r@example.com",
    )
    assert line.sent_at is not None


def test_no_line_for_whoever_went_to_the_trash_nor_an_unknown_parent(tmp_path: Path) -> None:
    unknown = {"id": UNKNOWN, "full_name": "Unknown parent", "placeholder": True}
    step = a_step(
        "Move Hassan bin Ismail to the Trash",
        trash=("out", HASSAN),
        people={UNKNOWN: PersonImage(unknown, {**unknown, "birth_year": 1900})},
    )
    record(tmp_path, step, "", "done")
    assert not (tmp_path / "people" / HASSAN).exists()  # their folder went with them
    assert not (tmp_path / "people" / UNKNOWN).exists()
    record(tmp_path, step, "", "undone")  # back from the Trash
    assert [line.what for line in journal_of(tmp_path, HASSAN)] == [
        "Undid: Move Hassan bin Ismail to the Trash"
    ]


def test_only_the_newest_are_kept_and_a_damaged_journal_is_none(tmp_path: Path) -> None:
    for number in range(storage.KEPT + 5):
        storage.add_change(
            tmp_path, HASSAN, {"at": "2026-10-02T01:00:00+08:00", "what": f"{number}"}
        )
    lines = journal_of(tmp_path, HASSAN)
    assert len(lines) == storage.KEPT
    assert lines[0].what == f"{storage.KEPT + 4}"  # the newest first
    path = tmp_path / "people" / SITI / storage.JOURNAL
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"changes": [{"what": "no time"}, "not a change"]}), "utf-8")
    assert journal_of(tmp_path, SITI) == []
