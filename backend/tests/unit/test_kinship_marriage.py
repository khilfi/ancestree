"""In-laws, step-family and other kinds of parent, both genders,
both ways round; then chains, and relations that a closer tie would hide."""

from collections.abc import Callable

import pytest

from ancestree.domain.relationship import SpouseStatus
from tests.kinship_fixtures import Builder

# Each builds a family where B is A's relation of one shape; A and B's genders are given.
type Build = Callable[[str, str], Builder]


def spouses(a: str, b: str) -> Builder:  # =
    family = Builder()
    family.people(f"A:{a} B:{b}")
    family.marry("A", "B")
    return family


def spouse_parent(a: str, b: str) -> Builder:  # =u
    family = Builder()
    family.people(f"A:{a} W:f B:{b}")
    family.marry("A", "W")
    family.child("B", "W")
    return family


def child_spouse(a: str, b: str) -> Builder:  # d=
    family = Builder()
    family.people(f"A:{a} C:m B:{b}")
    family.child("A", "C")
    family.marry("C", "B")
    return family


def spouse_sibling(a: str, b: str) -> Builder:  # =ud
    family = Builder()
    family.people(f"A:{a} W:f P:m B:{b}")
    family.marry("A", "W")
    family.child("P", "W", "B")
    return family


def sibling_spouse(a: str, b: str) -> Builder:  # ud=
    family = Builder()
    family.people(f"A:{a} P:m S:? B:{b}")
    family.child("P", "A", "S")
    family.marry("S", "B")
    return family


def spouse_sibling_spouse(a: str, b: str) -> Builder:  # =ud=
    family = Builder()
    family.people(f"A:{a} W:f P:m S:f B:{b}")
    family.marry("A", "W")
    family.child("P", "W", "S")
    family.marry("S", "B")
    return family


def child_spouse_parent(a: str, b: str) -> Builder:  # d=u
    family = Builder()
    family.people(f"A:{a} C:m D:f B:{b}")
    family.child("A", "C")
    family.marry("C", "D")
    family.child("B", "D")
    return family


def parent_spouse(a: str, b: str) -> Builder:  # u=
    family = Builder()
    family.people(f"A:{a} F:m M:f B:{b}")
    family.parents(("F", "M"), "A")
    family.marry("F", "M")
    family.marry("F", "B")
    return family


def spouse_child(a: str, b: str) -> Builder:  # =d
    family = Builder()
    family.people(f"A:{a} W:f X:m B:{b}")
    family.marry("A", "W")
    family.parents(("W", "X"), "B")
    return family


def step_sibling(a: str, b: str) -> Builder:  # u=d
    family = Builder()
    family.people(f"A:{a} F:m M:f W:f X:m B:{b}")
    family.parents(("F", "M"), "A")
    family.parents(("W", "X"), "B")
    family.marry("F", "W")
    return family


def uncle_by_marriage(a: str, b: str) -> Builder:  # uud=
    family = Builder()
    family.people(f"A:{a} P:m G:m U:m B:{b}")
    family.child("G", "P", "U")
    family.child("P", "A")
    family.marry("U", "B")
    return family


def grandchild_spouse(a: str, b: str) -> Builder:  # dd=
    family = Builder()
    family.people(f"A:{a} C:m G:f B:{b}")
    family.child("A", "C")
    family.child("C", "G")
    family.marry("G", "B")
    return family


def adoptive_parent(a: str, b: str) -> Builder:
    family = Builder()
    family.people(f"A:{a} B:{b}")
    family.child("B", "A", kind="adoptive")
    return family


def foster_child(a: str, b: str) -> Builder:
    family = Builder()
    family.people(f"A:{a} B:{b}")
    family.child("A", "B", kind="foster")
    return family


def guardian(a: str, b: str) -> Builder:
    family = Builder()
    family.people(f"A:{a} B:{b}")
    family.child("B", "A", kind="guardian")
    return family


def adoptive_sibling(a: str, b: str) -> Builder:
    family = Builder()
    family.people(f"A:{a} P:m B:{b}")
    family.child("P", "A")
    family.child("P", "B", kind="adoptive")
    return family


def by_gender(male: str, female: str) -> dict[str, str]:
    return {"m": male, "f": female}


# Build; then what B is to A, by B's gender; then what A is to B, by A's gender.
ROWS: dict[str, tuple[Build, dict[str, str], dict[str, str]]] = {
    "=": (spouses, by_gender("husband", "wife"), by_gender("husband", "wife")),
    "=u": (
        spouse_parent,
        by_gender("father-in-law", "mother-in-law"),
        by_gender("son-in-law", "daughter-in-law"),
    ),
    "d=": (
        child_spouse,
        by_gender("son-in-law", "daughter-in-law"),
        by_gender("father-in-law", "mother-in-law"),
    ),
    "=ud": (
        spouse_sibling,
        by_gender("brother-in-law", "sister-in-law"),
        by_gender("brother-in-law", "sister-in-law"),
    ),
    "ud=": (
        sibling_spouse,
        by_gender("brother-in-law", "sister-in-law"),
        by_gender("brother-in-law", "sister-in-law"),
    ),
    # English has no single word for it (Malay does): it's said as a chain, both ways.
    "=ud=": (
        spouse_sibling_spouse,
        by_gender("wife's sister's husband", "wife's sister's wife"),
        by_gender("wife's sister's husband", "wife's sister's wife"),
    ),
    "d=u": (
        child_spouse_parent,
        by_gender("co-parent-in-law", "co-parent-in-law"),
        by_gender("co-parent-in-law", "co-parent-in-law"),
    ),
    "u=": (
        parent_spouse,
        by_gender("stepfather", "stepmother"),
        by_gender("stepson", "stepdaughter"),
    ),
    "=d": (
        spouse_child,
        by_gender("stepson", "stepdaughter"),
        by_gender("stepfather", "stepmother"),
    ),
    "u=d": (
        step_sibling,
        by_gender("stepbrother", "stepsister"),
        by_gender("stepbrother", "stepsister"),
    ),
    "uud=": (
        uncle_by_marriage,
        by_gender("uncle by marriage", "aunt by marriage"),
        by_gender("husband's nephew", "husband's niece"),  # no single English word
    ),
    "dd=": (
        grandchild_spouse,
        by_gender("grandson-in-law", "granddaughter-in-law"),
        by_gender("wife's paternal grandfather", "wife's paternal grandmother"),
    ),
    "adoptive": (
        adoptive_parent,
        by_gender("adoptive father", "adoptive mother"),
        by_gender("adopted son", "adopted daughter"),
    ),
    "foster": (
        foster_child,
        by_gender("foster son", "foster daughter"),
        by_gender("foster father", "foster mother"),
    ),
    "guardian": (guardian, by_gender("guardian", "guardian"), by_gender("ward", "ward")),
    "adoptive sibling": (
        adoptive_sibling,
        by_gender("adoptive brother", "adoptive sister"),
        by_gender("adoptive brother", "adoptive sister"),
    ),
}


@pytest.mark.parametrize("row", sorted(ROWS))
@pytest.mark.parametrize("gender_a", ["m", "f"])
@pytest.mark.parametrize("gender_b", ["m", "f"])
def test_the_table_both_ways_round(row: str, gender_a: str, gender_b: str) -> None:
    build, forward, reverse = ROWS[row]

    relation = build(gender_a, gender_b).relate("A", "B")[0]

    assert relation.forward.term == forward[gender_b]
    assert relation.reverse.term == reverse[gender_a]
    assert (relation.path[0], relation.path[-1]) == ("A", "B")


def test_each_relation_says_what_type_it_is() -> None:
    assert spouses("m", "f").relate("A", "B")[0].type == "marriage"
    assert spouse_parent("m", "f").relate("A", "B")[0].type == "in_law"
    assert spouse_sibling_spouse("m", "m").relate("A", "B")[0].type == "in_law"
    assert parent_spouse("m", "f").relate("A", "B")[0].type == "step"
    assert adoptive_parent("m", "f").relate("A", "B")[0].type == "kind"
    assert adoptive_sibling("m", "f").relate("A", "B")[0].type == "kind"


def test_in_laws_and_step_family_say_through_whom() -> None:
    assert spouse_sibling("m", "m").relate("A", "B")[0].forward.detail == "his wife's brother"
    assert sibling_spouse("f", "m").relate("A", "B")[0].forward.detail == "her sibling's husband"
    assert parent_spouse("m", "f").relate("A", "B")[0].forward.detail == "his father's wife"
    # Where the term is already the chain, there's nothing to add.
    assert spouse_sibling_spouse("m", "m").relate("A", "B")[0].forward.detail is None


def test_a_divorce_makes_a_former_relation() -> None:
    family = Builder()
    family.people("Karim:m Suraya:f Mak:f")
    family.child("Mak", "Suraya")
    family.marry("Karim", "Suraya", SpouseStatus.DIVORCED)

    assert family.says("Karim", "Suraya") == "Suraya is Karim's former wife"
    assert family.says("Karim", "Mak") == "Mak is Karim's former mother-in-law"


def test_anything_else_is_said_as_a_chain_from_the_nearest_pieces() -> None:
    family = Builder()
    family.people("Ali:m Rosli:m Mak:f Halimah:f Gran:f Kamal:m")
    family.parents(("Rosli", "Mak"), "Ali")
    family.marry("Rosli", "Halimah")
    family.child("Gran", "Halimah", "Kamal")

    relation = family.relate("Ali", "Kamal")[0]

    assert relation.type == "chain"
    assert relation.forward.sentence == "Kamal is Ali's stepmother's brother"
    assert relation.reverse.sentence == "Ali is Kamal's sister's stepson"
    assert relation.path == ("Ali", "Rosli", "Halimah", "Gran", "Kamal")
    assert relation.generations == 1  # his stepmother's generation


def test_a_cousin_who_married_your_brother_is_also_your_sister_in_law() -> None:
    family = Builder()
    family.people("Tok:m Nek:f Pak:m Mak:f Ali:m Abang:m Sepupu:f")
    family.parents(("Tok", "Nek"), "Pak", "Mak")
    family.child("Pak", "Ali", "Abang")
    family.child("Mak", "Sepupu")
    family.marry("Abang", "Sepupu")

    sentences = [r.forward.sentence for r in family.relate("Ali", "Sepupu")]

    assert sentences == ["Sepupu is Ali's first cousin", "Sepupu is Ali's sister-in-law"]


def test_a_grandmother_who_adopted_you_is_both() -> None:
    family = Builder()
    family.people("Nek:f Mak:f Ali:m")
    family.child("Nek", "Mak")
    family.child("Mak", "Ali")
    family.child("Nek", "Ali", kind="adoptive")

    sentences = [r.forward.sentence for r in family.relate("Ali", "Nek")]

    assert sentences == ["Nek is Ali's maternal grandmother", "Nek is Ali's adoptive mother"]


def test_your_mother_married_to_your_father_is_not_your_stepmother() -> None:
    family = parent_spouse("m", "f")

    assert [r.forward.sentence for r in family.relate("A", "M")] == ["M is A's mother"]


def test_with_no_recorded_link_there_is_no_answer() -> None:
    family = Builder()
    family.people("Ali:m Kamal:m")

    assert family.relate("Ali", "Kamal") == []
    assert family.relate("Ali", "Ali") == []
