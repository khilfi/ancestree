"""Lineage, never age, and the fictional test family's hard cases."""

import pytest

from ancestree.kinship.finder import Relation, relate
from tests.kinship_fixtures import BOOKS, ENGLISH, Builder, seed

FAMILY, IDS = seed()


def answers(a: str, b: str) -> list[Relation]:
    return relate(FAMILY, IDS[a], IDS[b], ENGLISH, BOOKS)


def said(a: str, b: str) -> list[str]:
    return [r.forward.sentence for r in answers(a, b)]


# --- Lineage over age ---------------------------------------------------------------------


def test_an_uncle_born_after_his_nephew_is_still_his_uncle() -> None:
    # Zul was born in September 1980, Ali that February.
    [relation] = answers("ali", "zul")

    assert relation.forward.sentence == "Zul is Ali's uncle"
    assert relation.forward.detail == (
        "his mother's younger brother; one generation above him, though born after him"
    )
    assert relation.reverse.sentence == "Ali is Zul's nephew"
    assert relation.generations == 1


def test_an_uncle_born_the_same_year_as_his_nephew_is_his_uncle() -> None:
    family = Builder()
    family.people("Tok:m Nek:f Mak:f")
    family.person("Zul", "m", born=1980)
    family.person("Ali", "m", born=1980)
    family.parents(("Tok", "Nek"), "Mak", "Zul")
    family.child("Mak", "Ali")

    [relation] = family.relate("Ali", "Zul")
    assert relation.forward.sentence == "Zul is Ali's uncle"
    assert relation.forward.detail == "his mother's brother"  # year-only dates can't tell


def test_a_great_aunt_younger_than_her_grandniece_is_her_great_aunt() -> None:
    family = Builder()
    family.people("Tok:m Nek:f Datuk:m Mak:f")
    family.person("Mek", "f", born=1990)  # the youngest of a large family
    family.person("Cu", "f", born=1985)
    family.parents(("Tok", "Nek"), "Datuk", "Mek")
    family.child("Datuk", "Mak")
    family.child("Mak", "Cu")

    [relation] = family.relate("Cu", "Mek")
    assert relation.forward.sentence == "Mek is Cu's great-aunt"
    assert relation.forward.detail == (
        "her grandfather's sister; two generations above her, though born after her"
    )
    assert relation.reverse.sentence == "Cu is Mek's grandniece"


def test_twins_take_the_birth_order_set_by_hand() -> None:
    assert said("aida", "aina") == ["Aina is Aida's younger sister"]
    assert said("aina", "aida") == ["Aida is Aina's elder sister"]


def test_siblings_with_year_only_dates_are_ordered_only_when_the_years_differ() -> None:
    family = Builder()
    family.people("Tok:m Nek:f")
    family.person("Along", "m", born=1950)
    family.person("Angah", "f", born=1952)
    family.person("Alang", "m", born=1952)
    family.parents(("Tok", "Nek"), "Along", "Angah", "Alang")

    assert family.says("Angah", "Along") == "Along is Angah's elder brother"
    assert family.says("Angah", "Alang") == "Alang is Angah's brother"


# --- The test family's hard cases -----------------------------------------------------------


def test_a_first_cousin_once_removed_as_on_the_result_card() -> None:
    # The example on the relationship card.
    [relation] = answers("ali", "siti")

    assert relation.forward.sentence == "Siti is Ali's first cousin once removed"
    assert relation.forward.detail == "his mother's first cousin; one generation above him"
    assert relation.reverse.sentence == "Ali is Siti's first cousin once removed"
    assert relation.reverse.detail == "her first cousin's son; one generation below her"
    assert [FAMILY.members[p].name for p in relation.shared_ancestors] == [
        "Tok Ismail",
        "Nenek Fatimah",
    ]
    assert [FAMILY.members[p].name for p in relation.path] == [
        "Ali",
        "Aminah",
        "Acan",
        "Tok Ismail",
        "Rahman",
        "Siti",
    ]


def test_half_siblings_through_a_second_wife_and_a_remarriage() -> None:
    assert said("siti", "hafiz") == ["Hafiz is Siti's younger half-brother"]
    assert said("iman", "danial") == ["Danial is Iman's elder half-brother"]


def test_an_adopted_daughter_is_an_adoptive_sister() -> None:
    [relation] = answers("azman", "lina")

    assert relation.type == "kind"
    assert relation.forward.sentence == "Lina is Azman's younger adoptive sister"


def test_cousins_who_married_are_husband_and_wife_first() -> None:
    assert said("azman", "nor") == ["Nor is Azman's wife", "Nor is Azman's first cousin"]


def test_the_child_of_cousins_is_related_to_his_father_twice() -> None:
    assert said("irfan", "azman") == [
        "Azman is Irfan's father",
        "Azman is Irfan's first cousin once removed",
    ]
    assert said("ali", "irfan") == ["Irfan is Ali's first cousin", "Irfan is Ali's second cousin"]


def test_sisters_through_an_unknown_parent() -> None:
    [relation] = answers("mariam", "salmah")

    assert relation.forward.sentence == "Salmah is Mariam's sister"
    assert relation.shared_ancestors == (IDS["unknown_parent_of_mariam"],)


@pytest.mark.parametrize(
    ("a", "b", "sentence"),
    [
        ("siti", "halimah", "Halimah is Siti's stepmother"),
        ("iman", "suraya", "Suraya is Iman's former stepmother"),
        ("hassan", "rosli", "Rosli is Acan's son-in-law"),
        ("aminah", "nadia", "Nadia is Aminah's daughter-in-law"),
        ("rosli", "zul", "Zul is Rosli's brother-in-law"),
        ("rokiah", "mariam", "Mariam is Rokiah's co-parent-in-law"),
        ("nadia", "zul", "Zul is Nadia's husband's uncle"),
        ("umar", "ismail", "Tok Ismail is Umar's paternal 2nd great-grandfather"),
        ("aisyah", "siti", "Siti is Aisyah's first cousin twice removed"),
    ],
)
def test_in_laws_step_family_and_distant_relatives(a: str, b: str, sentence: str) -> None:
    assert said(a, b)[0] == sentence


def test_people_with_no_recorded_link_have_no_answer() -> None:
    family = Builder()
    family.people("Ali:m Kamal:m")

    assert family.relate("Ali", "Kamal") == []
