"""A generated, fictional family of any size, to try the tree canvas at scale.

It exists only in memory: nothing is stored. The same size always gives the same family.
"""

import random
from collections import deque
from typing import Any
from uuid import UUID, uuid5

_NAMESPACE = UUID("4f6b1c2e-9d3a-4e8b-a1f0-2c7d5e9b3a61")
_MEN = ["Ahmad", "Ali", "Amir", "Daud", "Hamdan", "Hassan", "Idris", "Ismail", "Jamil", "Kamal"]
_MEN += ["Musa", "Omar", "Rahman", "Yusof", "Zaki", "Bakar", "Salleh", "Rosli", "Fauzi", "Azman"]
_WOMEN = ["Aisyah", "Aminah", "Fatimah", "Hana", "Halimah", "Khadijah", "Mariam", "Nora"]
_WOMEN += ["Normah", "Ramlah", "Rokiah", "Salmah", "Siti", "Wati", "Zainab", "Aida", "Laila"]


def generated_family(size: int, seed: int = 7) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Rows shaped like the database's: a founding couple and their descendants, most of
    whom marry; a few spouses bring their parents and siblings along (clusters)."""
    rng = random.Random(seed)  # noqa: S311 - inventing a family, not keeping secrets
    people: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    first_names: dict[str, str] = {}

    def add(gender: str, born: int, father: str | None) -> str:
        number = len(people)
        first = rng.choice(_MEN if gender == "male" else _WOMEN)
        first_names[str(uuid5(_NAMESPACE, f"person:{number}"))] = first
        name = f"{first} {'bin' if gender == 'male' else 'binti'} {father}" if father else first
        people.append(
            {
                "id": str(uuid5(_NAMESPACE, f"person:{number}")),
                "full_name": f"{name} ({number})",
                "nickname": None,
                "gender": gender,
                "birth_year": born,
                "birth_month": rng.randint(1, 12),
                "birth_day": rng.randint(1, 28),
                "death_year": born + rng.randint(50, 90) if born < 1945 else None,
                "birth_order": None,
                "placeholder": False,
                "photo_version": None,
                "x": None,
                "y": None,
            }
        )
        return str(people[-1]["id"])

    def link(kind: str, source: str, target: str) -> None:
        links.append(
            {
                "id": str(uuid5(_NAMESPACE, f"{kind}:{source}>{target}")),
                "type": kind,
                "source": source,
                "target": target,
                "kind": "biological" if kind == "parent" else None,
                "status": "married" if kind == "spouse" else None,
            }
        )

    couples: deque[tuple[str, str, int]] = deque()
    while len(people) < size:
        if not couples:  # a line died out: another family starts, as unrelated ones do
            founder, founder_wife = add("male", 1840, None), add("female", 1845, None)
            link("spouse", founder, founder_wife)
            couples.append((founder, founder_wife, 1840))
        father, mother, year = couples.popleft()
        surname = first_names[father]
        for _ in range(rng.randint(2, 6)):
            born = year + rng.randint(20, 42)
            if len(people) >= size or born > 2025:
                break
            gender = rng.choice(("male", "female"))
            child = add(gender, born, surname)
            link("parent", father, child)
            link("parent", mother, child)
            if born > 2005 or rng.random() > 0.8 or len(people) >= size:
                continue
            spouse = add("female" if gender == "male" else "male", born + rng.randint(-6, 6), None)
            link("spouse", child, spouse)
            if rng.random() < 0.12 and len(people) + 5 < size:
                # The spouse's own family comes along: a cluster off the rings.
                in_law, in_law_wife = add("male", born - 30, None), add("female", born - 28, None)
                link("spouse", in_law, in_law_wife)
                for sibling in [spouse] + [
                    add(rng.choice(("male", "female")), born + rng.randint(-8, 8), None)
                    for _ in range(rng.randint(1, 3))
                ]:
                    link("parent", in_law, sibling)
                    link("parent", in_law_wife, sibling)
            husband, wife = (child, spouse) if gender == "male" else (spouse, child)
            couples.append((husband, wife, born))
    return people, links
