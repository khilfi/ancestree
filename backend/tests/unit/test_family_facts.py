"""Family facts, worked out from rows like the tree's."""

import time
from datetime import date
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from ancestree.seed.generated import generated_family
from ancestree.services.facts import facts_from_rows, given_name
from tests.kinship_fixtures import KINDS

TODAY = date(2026, 9, 27)


def _id(key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"facts:{key}"))


def _person(
    key: str,
    full_name: str,
    gender: str = "unknown",
    *,
    born: tuple[int, ...] | None = None,
    died: tuple[int, ...] | None = None,
    about: bool = False,
    state: str | None = None,
    nickname: str | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": _id(key),
        "full_name": full_name,
        "nickname": nickname,
        "gender": gender,
        "birth_order": None,
        "placeholder": False,
        "photo_version": None,
        "living": None,
        "birth_state": state,
        "birth_town": None,
        "birth_country": "Malaysia",
        "birth_year": None,
        "death_year": None,
    }
    for prefix, parts in (("birth", born), ("death", died)):
        for name, value in zip(("year", "month", "day"), parts or (), strict=False):
            row[f"{prefix}_{name}"] = value
    if about:
        row["birth_qualifier"] = "about"
    return row


def _parent(parent: str, *children: str) -> list[dict[str, Any]]:
    return [
        {
            "id": _id(f"{parent}>{child}"),
            "type": "parent",
            "source": _id(parent),
            "target": _id(child),
            "kind": "biological",
            "status": None,
        }
        for child in children
    ]


def _married(a: str, b: str) -> dict[str, Any]:
    return {
        "id": _id(f"{a}={b}"),
        "type": "spouse",
        "source": _id(a),
        "target": _id(b),
        "kind": None,
        "status": "married",
    }


def _family() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A made-up family: Tok Ismail & Nenek Fatimah; their sons Hassan and Rahman; Hassan and
    Mariam's four children; Rahman's daughter Siti, who married her cousin Karim; Aminah's
    daughter Iman. Loner isn't linked to anyone yet."""
    people = [
        _person("tok", "Ismail bin Ahmad", "male", born=(1905,), about=True, nickname="Tok Ismail"),
        _person("nenek", "Fatimah binti Yusof", "female", born=(1910,), died=(2004, 9, 12)),
        _person("hassan", "Hassan bin Ismail", "male", born=(1938, 3, 14), died=(2011, 10, 3)),
        _person("mariam", "Mariam binti Daud", "female", born=(1940,), state="Selangor"),
        _person("rahman", "Rahman bin Ismail", "male", born=(1941,), state="Selangor"),
        _person("aminah", "Aminah binti Hassan", "female", born=(1962, 9, 2), state="Kelantan"),
        _person("karim", "Haji Karim bin Hassan", "male", born=(1965,)),
        _person("nor", "Siti Nor binti Hassan", "female", born=(1968,)),
        _person("zul", "Zul bin Hassan"),
        _person("siti", "Siti Hajar binti Rahman", "female", born=(1970,), state="Selangor"),
        _person("iman", "Iman binti Salleh", "female", born=(2024, 1, 5)),
        _person("loner", "Loner", "male"),
    ]
    links = [
        _married("tok", "nenek"),
        *_parent("tok", "hassan", "rahman"),
        *_parent("nenek", "hassan", "rahman"),
        _married("hassan", "mariam"),
        *_parent("hassan", "aminah", "karim", "nor", "zul"),
        *_parent("mariam", "aminah", "karim", "nor", "zul"),
        *_parent("rahman", "siti"),
        _married("karim", "siti"),
        *_parent("aminah", "iman"),
    ]
    return people, links


def _facts() -> Any:
    people, links = _family()
    return facts_from_rows(people, links, {"biological": True}, KINDS, None, TODAY)


def test_the_counts_the_toolbar_used_to_show() -> None:
    counts = _facts().counts

    assert (counts.people, counts.links, counts.couples) == (12, 17, 3)
    assert (counts.unknown_parents, counts.families, counts.unlinked) == (0, 1, 1)


def test_oldest_youngest_and_the_lives_between() -> None:
    facts = _facts()

    assert (facts.oldest.person.name, facts.oldest.date) == ("Tok Ismail", "about 1905")
    assert (facts.youngest.person.name, facts.youngest.date) == ("Iman", "5 January 2024")
    assert (facts.span_years, facts.span_about) == (118, True)
    assert facts.longest_life.person.name == "Fatimah"
    assert (facts.longest_life.years, facts.longest_life.about) == (94, True)
    assert (facts.average_life, facts.lives_known) == (84, 2)  # 94 and 73
    assert (facts.oldest_living.person.name, facts.oldest_living.years) == ("Mariam", 86)


def test_families_descendants_and_cousins() -> None:
    facts = _facts()

    assert [p.name for p in facts.biggest_family.parents] == ["Hassan", "Mariam"]
    assert facts.biggest_family.children == 4
    most = facts.most_descendants
    assert [p.name for p in most.people] == ["Tok Ismail", "Fatimah"]
    assert (most.count, most.generations) == (8, 3)
    [cousins] = facts.cousins_married
    assert (cousins.a.name, cousins.b.name) == ("Haji Karim", "Siti Hajar")
    assert cousins.term == "first cousin"
    farthest = facts.farthest_by_blood
    assert (farthest.a.name, farthest.b.name) == ("Siti Hajar", "Iman")
    assert farthest.term == "first cousin once removed"
    assert facts.longest_chain.links >= 4


def test_generations_add_up_to_everyone_linked() -> None:
    generations = _facts().generations

    assert [g.generation for g in generations] == [1, 2, 3, 4]
    assert sum(g.people for g in generations) == 11  # everyone but Loner


def test_names_places_decades_and_this_month() -> None:
    facts = _facts()

    assert [(n.name, len(n.people)) for n in facts.names] == [("Siti", 2)]
    assert [(p.name, len(p.people)) for p in facts.birthplaces] == [
        ("Selangor", 3),
        ("Kelantan", 1),
    ]
    assert [d.decade for d in facts.decades][:2] == [1900, 1910]
    assert facts.decades[-1].decade == 2020
    assert facts.month == "September"
    assert [(a.person.name, a.kind, a.day, a.years) for a in facts.this_month] == [
        ("Aminah", "birthday", 2, 64),
        ("Fatimah", "death", 12, 22),
    ]


def test_what_is_still_to_fill_in() -> None:
    missing = _facts().to_fill_in

    assert [p.name for p in missing.no_gender] == ["Zul"]
    assert [p.name for p in missing.no_birth_year] == ["Loner", "Zul"]
    [group] = missing.no_birth_order  # Zul has no date, so Hassan's children aren't in order
    assert [p.name for p in group.parents] == ["Hassan", "Mariam"]


def test_given_names_leave_out_titles_and_patronymics() -> None:
    assert given_name("Hajah Siti Aminah binti Hassan") == "Siti"
    assert given_name("Dato' Haji Karim bin Hassan") == "Karim"
    assert given_name("Wan Ahmad bin Wan Ali") == "Wan"
    assert given_name("bin Hassan") is None


def test_quick_for_two_thousand_people() -> None:
    people, links = generated_family(2000)
    started = time.perf_counter()
    facts = facts_from_rows(people, links, {"biological": True}, KINDS, None, TODAY)

    assert facts.counts.people == sum(1 for row in people if not row.get("placeholder"))
    assert time.perf_counter() - started < 4
