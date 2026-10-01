"""Who changed someone, and when: each person's last changes, in
journal.json in their folder. So it travels with the family through the family folder, goes
into backups, and can be read without the app.

    {"format": 1, "changes": [{"at": ..., "what": "Edit Hassan bin Ismail", "by": "Home PC",
                               "from": {"computer": ..., "email": ..., "sent": ...}}, ...]}

"by" is the computer the change was made or brought in on; "from", for changes a relative's
computer sent through the family folder, is that computer, its owner's account and when it
sent them. The newest last.
"""

import json
from pathlib import Path
from typing import Any
from uuid import UUID

from ancestree.storage.files import person_dir, write_json

JOURNAL = "journal.json"
KEPT = 30  # the newest changes kept for each person


def read_journal(data_dir: Path, person_id: UUID | str) -> list[dict[str, Any]]:
    """Someone's last changes, the newest last; none if there's no journal, or it can't be read."""
    path = person_dir(data_dir, person_id) / JOURNAL
    try:
        found = json.loads(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return []
    changes = found.get("changes") if isinstance(found, dict) else None
    if not isinstance(changes, list):
        return []
    return [change for change in changes if isinstance(change, dict)]


def add_change(data_dir: Path, person_id: UUID | str, change: dict[str, Any]) -> None:
    """One more change to someone, the oldest let go beyond KEPT."""
    changes = [*read_journal(data_dir, person_id), change][-KEPT:]
    write_json(person_dir(data_dir, person_id) / JOURNAL, {"format": 1, "changes": changes})
