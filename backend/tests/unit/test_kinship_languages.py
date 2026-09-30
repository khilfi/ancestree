"""Malay and Javanese answers: every table case has a word,
and the distinctions the two languages make come out right."""

from dataclasses import replace

import pytest

from ancestree.domain.relationship import SpouseStatus
from ancestree.kinship.dictionary import row_for
from ancestree.kinship.kin import Blood
from tests.kinship_fixtures import KINDS, MALAY, Builder
from tests.unit.test_kinship_blood import TERMS, related
from tests.unit.test_kinship_golden import the_note
from tests.unit.test_kinship_marriage import ROWS

LANGUAGES = ("ms", "jv")


# --- Every case has a word in every language ------------------------------------------------


@pytest.mark.parametrize(("up", "down"), sorted(TERMS))
@pytest.mark.parametrize("gender_a", ["m", "f", "?"])
@pytest.mark.parametrize("gender_b", ["m", "f", "?"])
def test_every_blood_case_has_a_word_in_every_language(
    up: int, down: int, gender_a: str, gender_b: str
) -> None:
    [relation] = related(up, down, gender_a, gender_b).relate("A", "B")

    for language in LANGUAGES:
        for said in (relation.forward.words[language], relation.reverse.words[language]):
            assert not said.english, (language, said.term)
            assert said.term


@pytest.mark.parametrize("row", sorted(ROWS))
@pytest.mark.parametrize("gender_a", ["m", "f"])
@pytest.mark.parametrize("gender_b", ["m", "f"])
def test_every_in_law_and_step_case_has_a_word_in_every_language(
    row: str, gender_a: str, gender_b: str
) -> None:
    build, _, _ = ROWS[row]
    relation = build(gender_a, gender_b).relate("A", "B")[0]

    for language in LANGUAGES:
        for said in (relation.forward.words[language], relation.reverse.words[language]):
            if row == "guardian":  # a kind with no Malay or Javanese words: English stands in
                assert said.term in {"guardian", "ward"}
            else:
                assert not said.english, (row, language, said.term)


# --- Blood ----------------------------------------------------------------------------------


def words(family: Builder, a: str, b: str) -> tuple[str, str]:
    return family.word(a, b, "ms"), family.word(a, b, "jv")


@pytest.mark.parametrize(
    ("up", "down", "gender", "malay", "javanese"),
    [
        (1, 0, "m", "ayah", "bapak"),
        (1, 0, "f", "emak", "ibu"),
        (1, 0, "?", "orang tua", "wong tuwa"),
        (2, 0, "f", "nenek sebelah ayah", "simbah putri saka bapak"),
        (3, 0, "m", "moyang sebelah ayah", "simbah buyut saka bapak"),
        (4, 0, "f", "buyut sebelah ayah", "simbah canggah saka bapak"),
        (5, 0, "m", "nenek moyang sebelah ayah", "simbah waréng saka bapak"),
        (0, 1, "m", "anak lelaki", "anak lanang"),
        (0, 1, "f", "anak perempuan", "anak wadon"),
        (0, 2, "f", "cucu", "putu"),
        (0, 3, "m", "cicit", "buyut"),
        (0, 4, "m", "piut", "canggah"),
        (0, 5, "f", "oneng-oneng", "waréng"),
        (0, 6, "m", "piut-miut", "udheg-udheg"),
        (0, 18, "m", "piut-miut", "trah tumerah"),
        (0, 19, "m", "piut-miut", "turun"),
        (3, 1, "m", "datuk saudara", "simbah"),
        (3, 1, "f", "nenek saudara", "simbah"),
        (1, 2, "f", "anak saudara", "keponakan"),
        (1, 3, "m", "cucu saudara", "putu keponakan"),
        (2, 2, "m", "sepupu", "misanan"),
        (3, 3, "f", "dua pupu", "mindhoan"),
        (4, 4, "m", "tiga pupu", "sedulur tunggal canggah"),
        (5, 5, "m", "saudara jauh", "sedulur tunggal waréng"),
        (8, 8, "m", "saudara jauh", "sedulur adoh"),
    ],
)
def test_blood_words(up: int, down: int, gender: str, malay: str, javanese: str) -> None:
    family = related(up, down, "m", gender)  # everyone in between is a man

    assert words(family, "A", "B") == (malay, javanese)


def siblings() -> Builder:
    """Tok and Nek's four children in birth order, and Mak's son Ali."""
    family = Builder()
    family.people("Tok:m Nek:f Ali:m")
    family.person("Along", "m", born=1950)
    family.person("Angah", "f", born=1952)
    family.person("Mak", "f", born=1955)
    family.person("Usu", "m", born=1960)
    family.parents(("Tok", "Nek"), "Along", "Angah", "Mak", "Usu")
    family.child("Mak", "Ali")
    return family


def test_brothers_and_sisters_by_age() -> None:
    family = siblings()

    assert words(family, "Mak", "Along") == ("abang", "kangmas")
    assert words(family, "Mak", "Angah") == ("kakak", "mbakyu")
    assert words(family, "Mak", "Usu") == ("adik lelaki", "adhi lanang")
    assert words(family, "Usu", "Mak") == ("kakak", "mbakyu")


def test_brothers_and_sisters_when_it_isnt_known_who_is_older() -> None:
    family = Builder()
    family.people("P:m A:f B:m")
    family.child("P", "A", "B")

    assert words(family, "A", "B") == ("saudara lelaki", "sedulur lanang")


def test_half_siblings_say_which_parent_they_share() -> None:
    family = Builder()
    family.people("F:m M:f W:f")
    family.person("A", "f", born=1980)
    family.person("B", "m", born=1975)
    family.person("C", "f", born=1990)
    family.parents(("F", "M"), "A")
    family.parents(("F", "W"), "B")
    family.person("X", "m")
    family.parents(("X", "M"), "C")

    assert words(family, "A", "B") == ("abang sebapa", "kangmas tunggal bapak")
    assert words(family, "A", "C") == ("adik perempuan seibu", "adhi wadon tunggal ibu")


def test_malay_uncles_and_aunts_by_their_own_place() -> None:
    family = siblings()

    assert family.word("Ali", "Along", "ms") == "pak long"
    assert family.word("Ali", "Angah", "ms") == "mak ngah"
    assert family.word("Ali", "Usu", "ms") == "pak su"  # the youngest, not the 4th


def test_javanese_uncles_and_aunts_by_whether_they_are_older_than_the_parent() -> None:
    family = siblings()

    assert family.word("Ali", "Along", "jv") == "pakdhé"
    assert family.word("Ali", "Angah", "jv") == "budhé"
    assert family.word("Ali", "Usu", "jv") == "paklik"


def test_when_the_order_isnt_known_malay_says_the_general_word_and_javanese_both() -> None:
    family = Builder()
    family.people("Tok:m Mak:f Usu:m Ali:m")
    family.child("Tok", "Mak", "Usu")
    family.child("Mak", "Ali")

    assert words(family, "Ali", "Usu") == ("pak cik", "pakdhé / paklik")


def test_a_brothers_great_grandchild_is_said_in_pieces_in_javanese() -> None:
    family = Builder()
    family.people("P:m S1:m S2:f B:m")
    family.person("A", "f", born=1960)
    family.person("S", "m", born=1950)
    family.child("P", "A", "S")
    family.child("S", "S1")
    family.child("S1", "S2")
    family.child("S2", "B")

    assert words(family, "A", "B") == ("cicit saudara", "buyuté kangmas")


def test_removed_cousins_are_said_in_pieces() -> None:
    # A parent's first cousin, a first cousin's son, a grandparent's first cousin.
    assert words(related(3, 2, "m", "f"), "A", "B") == ("sepupu ayah", "misanané bapak")
    assert words(related(2, 3, "m", "m"), "A", "B") == (
        "anak lelaki sepupu",
        "anak lanangé misanan",
    )
    assert words(related(4, 2, "m", "f"), "A", "B") == (
        "sepupu datuk sebelah ayah",
        "misanané simbah kakung saka bapak",
    )


# --- Marriage ---------------------------------------------------------------------------------


def in_laws() -> Builder:
    """Ali married Siti, whose elder brother Kamal and younger sister Nor both married."""
    family = Builder()
    family.people("Ali:m P:m Jah:f Rosli:m")
    family.person("Siti", "f", born=1980)
    family.person("Kamal", "m", born=1975)
    family.person("Nor", "f", born=1985)
    family.child("P", "Kamal", "Siti", "Nor")
    family.marry("Ali", "Siti")
    family.marry("Kamal", "Jah")
    family.marry("Nor", "Rosli")
    return family


def test_brothers_and_sisters_in_law_follow_the_sibling_in_between() -> None:
    family = in_laws()

    assert words(family, "Ali", "Kamal") == ("abang ipar", "mas ipé")
    assert words(family, "Ali", "Nor") == ("adik ipar", "adhi ipé")
    assert words(family, "Siti", "Rosli") == ("adik ipar", "adhi ipé")
    assert words(family, "Siti", "Jah") == ("kakak ipar", "mbakyu ipé")


def test_people_who_married_siblings_and_the_parents_of_a_couple() -> None:
    family = in_laws()
    family.people("Rahman:m")
    family.child("Rahman", "Ali")

    assert words(family, "Ali", "Rosli") == ("biras", "pripéan")
    assert words(family, "P", "Rahman") == ("besan", "bésan")


def test_co_wives() -> None:
    family = Builder()
    family.people("Hassan:m Mariam:f Halimah:f")
    family.marry("Hassan", "Mariam")
    family.marry("Hassan", "Halimah")

    assert words(family, "Mariam", "Halimah") == ("madu", "maru")
    assert family.says("Mariam", "Halimah") == "Halimah is Mariam's co-wife"


def test_an_uncles_wife_takes_his_word() -> None:
    family = siblings()
    family.people("Jah:f Rosli:m")
    family.marry("Along", "Jah")
    family.marry("Usu", "Rosli")

    assert words(family, "Ali", "Jah") == ("mak long", "budhé")
    assert words(family, "Ali", "Rosli") == ("pak su", "paklik")


def test_a_former_wife() -> None:
    family = Builder()
    family.people("Ali:m Rokiah:f")
    family.marry("Ali", "Rokiah", SpouseStatus.DIVORCED)

    assert words(family, "Ali", "Rokiah") == ("bekas isteri", "tilas bojo")


def test_a_chain_puts_the_owner_last() -> None:
    # "Kamal is Ali's stepmother's younger brother".
    family = Builder()
    family.people("Ali:m F:m M:f G:m")
    family.person("W", "f", born=1960)
    family.person("Kamal", "m", born=1965)
    family.parents(("F", "M"), "Ali")
    family.marry("F", "M")
    family.marry("F", "W")
    family.child("G", "W", "Kamal")

    assert family.says("Ali", "Kamal") == "Kamal is Ali's stepmother's younger brother"
    assert words(family, "Ali", "Kamal") == (
        "adik lelaki emak tiri",
        "adhi lanangé ibu kuwalon",
    )


def test_kinds_use_their_words_from_settings() -> None:
    family = Builder()
    family.people("P:m A:f B:m")
    family.person("A", "f", born=1990)
    family.person("B", "m", born=1985)
    family.child("P", "A")
    family.child("P", "B", kind="adoptive")

    assert words(family, "A", "P") == ("ayah", "bapak")
    assert words(family, "B", "P") == ("bapa angkat", "bapak angkat")
    assert words(family, "P", "B") == ("anak angkat", "anak pupon")
    assert words(family, "A", "B") == ("abang angkat", "kangmas angkat")


# --- The golden test, in the note's own words -------------------------------------------------

# The note's line; A and B; the Malay word the answer gives; the note's own word.
GOLDEN = [
    ("haji hamzah > abg > Abdullah salleh", "Abdullah Salleh", "Haji Hamzah", "abang", "abang"),
    ("haji hamzah > pakcik > na`imah", "Na'imah", "Haji Hamzah", "pak long", "pak cik"),
    ("haji hamzah > ayah > nenek kalsom", "Nenek Kalsom", "Haji Hamzah", "ayah", "ayah"),
    ("nenek kalsom > sepupu > na`imah", "Na'imah", "Nenek Kalsom", "sepupu", "sepupu"),
    ("nenek zaleha > cucu > haji hamzah", "Haji Hamzah", "Nenek Zaleha", "cucu", "cucu"),
    (
        "nenek zaleha > dua pupu > Abdul Karim",
        "Abdul Karim",
        "Nenek Zaleha",
        "dua pupu",
        "dua pupu",
    ),
    ("nenek kalsom > mak > nenek zaleha", "Nenek Zaleha", "Nenek Kalsom", "emak", "mak"),
]


@pytest.mark.parametrize(("note", "a", "b", "answer", "own"), GOLDEN, ids=[g[0] for g in GOLDEN])
def test_the_note_in_its_own_malay_words(note: str, a: str, b: str, answer: str, own: str) -> None:
    [relation] = the_note().relate(a, b)
    kin = relation.forward.kin
    assert kin is not None

    assert relation.forward.words["ms"].term == answer
    # The note's own word is the answer's, the general word for the relation (pak cik before
    # the title), or a form the dictionary lists beside it (mak for emak).
    general = (
        MALAY.term(replace(kin, seniority=None, place=None), KINDS)
        if isinstance(kin, Blood)
        else None
    )
    row = row_for(kin)
    assert row is not None
    listed = [
        *MALAY.dictionary_notes(row).get("also", ()),
        *MALAY.dictionary_notes(row).get("address", ()),
    ]
    assert own in {answer, general, *(word.lower() for word in listed)}
