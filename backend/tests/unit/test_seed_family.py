"""The test family must keep the hard cases it was built to show."""

from collections import defaultdict

import pytest

from ancestree.domain.relationship import BIOLOGICAL, SpouseStatus
from ancestree.seed.family import SeedFamily, load_seed_family


@pytest.fixture(scope="module")
def family() -> SeedFamily:
    return load_seed_family()


def _parents(family: SeedFamily, kind: str = BIOLOGICAL) -> dict[str, set[str]]:
    parents: dict[str, set[str]] = defaultdict(set)
    for unit in family.families:
        if unit.kind == kind:
            for child in unit.children:
                parents[child].update(unit.parents)
    return parents


def test_every_person_link_and_id_is_consistent(family: SeedFamily) -> None:
    people = family.people_as_domain()
    links = family.parent_links() + family.spouse_links()

    assert len({p.id for p in people}) == len(people) == 41
    assert len({link.id for link in links}) == len(links) == 52 + 14


def test_zul_is_alis_uncle_although_both_were_born_in_1980(family: SeedFamily) -> None:
    people = {p.key: p for p in family.people}
    parents = _parents(family)

    assert people["zul"].birth is not None
    assert people["ali"].birth is not None
    assert people["zul"].birth.year == people["ali"].birth.year == 1980
    assert parents["zul"] == parents["aminah"]  # Zul is Aminah's brother...
    assert "aminah" in parents["ali"]  # ...and Aminah is Ali's mother.


def test_twins_share_a_birthday_and_have_an_explicit_birth_order(family: SeedFamily) -> None:
    people = {p.key: p for p in family.people}

    assert people["aida"].birth == people["aina"].birth
    assert (people["aida"].birth_order, people["aina"].birth_order) == (1, 2)


def test_family_covers_the_hard_structural_cases(family: SeedFamily) -> None:
    parents = _parents(family)
    placeholders = {p.key for p in family.people if p.placeholder}
    marriages: dict[str, list[SpouseStatus]] = defaultdict(list)
    for marriage in family.marriages:
        for spouse in marriage.spouses:
            marriages[spouse].append(marriage.status)

    # An unknown parent joins two sisters.
    assert placeholders == {"unknown_parent_of_mariam"}
    assert parents["mariam"] == parents["salmah"] == placeholders
    # Two concurrent wives; a divorce followed by a remarriage.
    assert marriages["rahman"] == [SpouseStatus.MARRIED, SpouseStatus.MARRIED]
    assert marriages["karim"] == [SpouseStatus.DIVORCED, SpouseStatus.MARRIED]
    # An adoption.
    assert _parents(family, kind="adoptive")["lina"] == {"yusof", "rokiah"}
    # A cousin marriage: Azman's and Nor's fathers are brothers.
    assert parents["yusof"] == parents["hassan"]
    assert "yusof" in parents["azman"]
    assert "hassan" in parents["nor"]
    assert ("azman", "nor") in {m.spouses for m in family.marriages}
