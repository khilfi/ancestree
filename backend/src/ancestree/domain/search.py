"""Finding people by name: one rule for the app and for a view-only copy.

The copy can't ask the database, so it searches in the browser (frontend/src/viewer/search.ts).
Both follow this rule, and both are tested on the same searches
(frontend/src/viewer/search-cases.json), so a copy finds what the app finds, in the same order.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Any

_WORD = re.compile(r"[^\W_]+")  # letters and digits, as the copy's /[\p{L}\p{N}]+/


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _flat(text: str) -> str:
    return " ".join(text.lower().split())


def find_people(
    people: Sequence[Mapping[str, Any]], text: str, limit: int
) -> list[Mapping[str, Any]]:
    """Everyone whose name or nickname has a word starting with each word typed: "sit rah"
    finds Siti binti Rahman. Names or nicknames that start with what was typed come first,
    then A to Z. With nothing typed, everyone, A to Z. Unknown parents are never found."""
    wanted = words(text)
    typed = _flat(text)
    found: list[tuple[int, str, str, Mapping[str, Any]]] = []
    for person in people:
        if person.get("placeholder"):
            continue
        name = str(person["full_name"])
        nickname = str(person.get("nickname") or "")
        names = words(name) + words(nickname)
        if not all(any(word.startswith(part) for word in names) for part in wanted):
            continue
        first = bool(wanted) and (
            _flat(name).startswith(typed) or (bool(nickname) and _flat(nickname).startswith(typed))
        )
        found.append((0 if first else 1, name.lower(), str(person["id"]), person))
    found.sort(key=lambda item: item[:3])
    return [item[3] for item in found[:limit]]
