"""Blood relations: the term table in every combination of genders,
both ways round; then sides, half-siblings, elder and younger, and unknown genders."""

import pytest

from tests.kinship_fixtures import Builder

NEUTRAL = {"m": 0, "f": 1, "?": 2}

# B is A's ...: up = generations A climbs to the shared ancestor, down = from there to B.
# Written out by hand, independently of the dictionary, as a check on it.
TERMS: dict[tuple[int, int], tuple[str, str, str]] = {
    (1, 0): ("father", "mother", "parent"),
    (2, 0): ("paternal grandfather", "paternal grandmother", "paternal grandparent"),
    (3, 0): (
        "paternal great-grandfather",
        "paternal great-grandmother",
        "paternal great-grandparent",
    ),
    (4, 0): (
        "paternal 2nd great-grandfather",
        "paternal 2nd great-grandmother",
        "paternal 2nd great-grandparent",
    ),
    (0, 1): ("son", "daughter", "child"),
    (0, 2): ("grandson", "granddaughter", "grandchild"),
    (0, 3): ("great-grandson", "great-granddaughter", "great-grandchild"),
    (0, 4): ("2nd great-grandson", "2nd great-granddaughter", "2nd great-grandchild"),
    (1, 1): ("brother", "sister", "sibling"),
    (2, 1): ("uncle", "aunt", "parent's sibling"),
    (3, 1): ("great-uncle", "great-aunt", "grandparent's sibling"),
    (4, 1): ("2nd great-uncle", "2nd great-aunt", "great-grandparent's sibling"),
    (1, 2): ("nephew", "niece", "sibling's child"),
    (1, 3): ("grandnephew", "grandniece", "sibling's grandchild"),
    (1, 4): ("great-grandnephew", "great-grandniece", "sibling's great-grandchild"),
    (2, 2): ("first cousin",) * 3,
    (2, 3): ("first cousin once removed",) * 3,
    (3, 2): ("first cousin once removed",) * 3,
    (2, 4): ("first cousin twice removed",) * 3,
    (4, 2): ("first cousin twice removed",) * 3,
    (3, 3): ("second cousin",) * 3,
    (3, 4): ("second cousin once removed",) * 3,
    (4, 3): ("second cousin once removed",) * 3,
    (4, 4): ("third cousin",) * 3,
}


def related(up: int, down: int, gender_a: str, gender_b: str) -> Builder:
    """A and B whose nearest shared ancestors are `up` generations above A and `down` above
    B: a couple, Tok and Nek, unless one of the two is the ancestor. Everyone in between is
    a man, so a grandparent is on the father's side."""
    family = Builder()

    def line(start: tuple[str, ...], length: int, name: str, gender: str) -> None:
        above = start
        for step in range(1, length):
            family.person(f"{name}{step}", "m")
            family.parents(above, f"{name}{step}")
            above = (f"{name}{step}",)
        family.person(name, gender)
        family.parents(above, name)

    if up == 0:
        family.person("A", gender_a)
        line(("A",), down, "B", gender_b)
    elif down == 0:
        family.person("B", gender_b)
        line(("B",), up, "A", gender_a)
    else:
        family.people("Tok:m Nek:f")
        family.marry("Tok", "Nek")
        line(("Tok", "Nek"), up, "A", gender_a)
        line(("Tok", "Nek"), down, "B", gender_b)
    return family


@pytest.mark.parametrize(("up", "down"), sorted(TERMS))
@pytest.mark.parametrize("gender_a", ["m", "f", "?"])
@pytest.mark.parametrize("gender_b", ["m", "f", "?"])
def test_the_term_table_both_ways_round(up: int, down: int, gender_a: str, gender_b: str) -> None:
    [relation] = related(up, down, gender_a, gender_b).relate("A", "B")

    assert relation.type == "blood"
    assert relation.forward.term == TERMS[up, down][NEUTRAL[gender_b]]
    assert relation.reverse.term == TERMS[down, up][NEUTRAL[gender_a]]
    assert relation.generations == up - down
    assert relation.forward.sentence == f"B is A's {relation.forward.term}"


def test_cousins_any_distance_follow_the_general_rule() -> None:
    # Degree: one less than the smaller count; removed: the difference.
    assert related(7, 7, "m", "m").relate("A", "B")[0].forward.term == "sixth cousin"
    assert related(6, 9, "m", "m").relate("A", "B")[0].forward.term == (
        "fifth cousin three times removed"
    )
    assert related(13, 12, "m", "f").relate("A", "B")[0].forward.term == (
        "11th cousin once removed"
    )


def test_the_side_comes_from_the_first_step() -> None:
    family = Builder()
    family.people("Datuk:m Mak:f Ali:m")
    family.child("Datuk", "Mak")
    family.child("Mak", "Ali")

    assert family.says("Ali", "Datuk") == "Datuk is Ali's maternal grandfather"


def test_half_siblings_share_exactly_one_of_two_recorded_parents() -> None:
    family = Builder()
    family.people("Rahman:m Zainab:f Halimah:f Siti:f Hafiz:m Solo:f")
    family.parents(("Rahman", "Zainab"), "Siti")
    family.parents(("Rahman", "Halimah"), "Hafiz")
    family.child("Rahman", "Solo")  # her mother isn't recorded

    assert family.says("Siti", "Hafiz") == "Hafiz is Siti's half-brother"
    assert family.says("Hafiz", "Siti") == "Siti is Hafiz's half-sister"
    # With one parent unknown, "half" would be a guess.
    assert family.says("Siti", "Solo") == "Solo is Siti's sister"


def test_elder_and_younger_come_from_birth_dates() -> None:
    family = Builder()
    family.people("Tok:m Nek:f")
    family.person("Husin", "m", born=1920)
    family.person("Sidek", "m", born=1924)
    family.person("Minah", "f", born=1924)
    family.parents(("Tok", "Nek"), "Husin", "Sidek", "Minah")

    assert family.says("Sidek", "Husin") == "Husin is Sidek's elder brother"
    assert family.says("Husin", "Sidek") == "Sidek is Husin's younger brother"
    # Year-only dates in the same year can't tell who came first.
    assert family.says("Sidek", "Minah") == "Minah is Sidek's sister"


def test_a_birth_order_set_by_hand_decides_for_twins() -> None:
    family = Builder()
    family.people("Osman:m Khadijah:f")
    family.person("Aida", "f", born=(1970, 5, 5), order=1)
    family.person("Aina", "f", born=(1970, 5, 5), order=2)
    family.parents(("Osman", "Khadijah"), "Aida", "Aina")

    assert family.says("Aina", "Aida") == "Aida is Aina's elder sister"
    assert family.says("Aida", "Aina") == "Aina is Aida's younger sister"


def test_brothers_through_an_unknown_parent_are_still_brothers() -> None:
    family = Builder()
    family.person("?", unknown_parent=True)
    family.people("Umar:m Hana:f Kid:m")
    family.child("?", "Umar", "Hana")
    family.child("Umar", "Kid")

    [relation] = family.relate("Hana", "Kid")
    assert relation.forward.sentence == "Kid is Hana's nephew"
    assert relation.shared_ancestors == ("?",)
    assert relation.path == ("Hana", "?", "Umar", "Kid")


def test_unknown_genders_get_neutral_words() -> None:
    family = related(2, 1, "?", "?")

    [relation] = family.relate("A", "B")
    assert relation.forward.sentence == "B is A's parent's sibling"
    assert relation.forward.detail == "their father's sibling"
    assert relation.reverse.sentence == "A is B's sibling's child"


def test_the_path_climbs_to_the_shared_ancestor_and_comes_down() -> None:
    family = related(3, 2, "m", "f")

    [relation] = family.relate("A", "B")
    assert relation.path == ("A", "A2", "A1", "Tok", "B1", "B")
    assert relation.links == ("A2>A", "A1>A2", "Tok>A1", "Tok>B1", "B1>B")
    assert relation.shared_ancestors == ("Tok", "Nek")
    assert relation.forward.detail == "his father's first cousin; one generation above him"
    assert relation.reverse.detail == "her first cousin's son; one generation below her"
