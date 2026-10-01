"""Who changed someone, and when.

The Undo history tells this of each change it records, and of each it undoes or redoes: each
person it changed gets a line in their journal (storage/journal.py), which travels with the
family. Only on the keeper's computer, or one with no family folder: a relative's computer
keeps no journal of its own, since its changes wait for the keeper, whose computer journals
them once brought in, with the computer they came from.
"""

from datetime import datetime
from pathlib import Path
from typing import Any

from ancestree.domain.views import JournalEntry
from ancestree.services.history import Step
from ancestree.storage.journal import add_change, read_journal

_DOING = {"done": "{}", "undone": "Undid: {}", "redone": "Redid: {}"}


def _gone(step: Step, how: str) -> set[str]:
    """Who the step, done or undone, took out of the tree or to the Trash: their folders are
    gone or going, so they get no line."""
    forward = how != "undone"
    gone = {
        pid
        for pid, image in step.people.items()
        if (image.after if forward else image.before) is None
    }
    if step.trash is not None and (step.trash[0] == "out") == forward:
        gone.add(step.trash[1])
    return gone | (set(step.removed) if forward else set())


def record(data_dir: Path, step: Step, by: str, how: str) -> None:
    """A line in the journal of each person the step changed, as it's done, undone or redone.
    `by`: this computer's name in the family ("" with no family folder). A journal that can't
    be written is let go: it never stops a change."""
    at = step.at if how == "done" else datetime.now().astimezone()
    change: dict[str, Any] = {
        "at": at.isoformat(timespec="seconds"),
        "what": _DOING[how].format(step.label or "A change"),
        "by": by,
    }
    if step.sent_by:
        change["from"] = step.sent_by
    for pid in sorted(step.whom() - _gone(step, how)):
        try:
            add_change(data_dir, pid, change)
        except OSError, ValueError:
            continue


def journal_of(data_dir: Path, person_id: str) -> list[JournalEntry]:
    """Someone's last changes, the newest first: those that can't be read left out."""
    entries: list[JournalEntry] = []
    for change in reversed(read_journal(data_dir, person_id)):
        found = change.get("from")
        sent: dict[str, Any] = found if isinstance(found, dict) else {}
        try:
            entries.append(
                JournalEntry(
                    at=change["at"],
                    what=change.get("what", ""),
                    by=change.get("by", ""),
                    from_computer=sent.get("computer"),
                    from_email=sent.get("email"),
                    sent_at=sent.get("sent"),
                )
            )
        except KeyError, ValueError:
            continue
    return entries
