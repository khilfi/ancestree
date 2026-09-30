"""A relationship answer takes under 300 ms, at 2,000 people.
The finder's share of that is measured here; loading from Neo4j in the integration tests."""

import random
import time

from ancestree.domain.person import Gender, PartialDate
from ancestree.kinship.family import Family, Marriage, Member, ParentLink
from ancestree.kinship.finder import relate
from ancestree.seed.generated import generated_family
from tests.kinship_fixtures import BOOKS, ENGLISH, KINDS


def test_answers_in_a_two_thousand_person_family_are_quick() -> None:
    rows, links = generated_family(2000)
    family = Family(
        [
            Member(
                row["id"],
                row["full_name"],
                Gender(row["gender"]),
                PartialDate(year=row["birth_year"], month=row["birth_month"], day=row["birth_day"]),
            )
            for row in rows
        ],
        [ParentLink(r["id"], r["source"], r["target"]) for r in links if r["type"] == "parent"],
        [Marriage(r["id"], r["source"], r["target"]) for r in links if r["type"] == "spouse"],
        KINDS,
    )
    rng = random.Random(3)  # noqa: S311 - picking people, not keeping secrets
    ids = [row["id"] for row in rows[:1500]]  # the first family is the big one
    pairs = [(rng.choice(ids), rng.choice(ids)) for _ in range(40)]

    started = time.perf_counter()
    answered = [relate(family, a, b, ENGLISH, BOOKS) for a, b in pairs]
    each = (time.perf_counter() - started) / len(pairs)

    assert sum(bool(relations) for relations in answered) >= 30
    assert each < 0.1, f"{each * 1000:.0f} ms per answer"
