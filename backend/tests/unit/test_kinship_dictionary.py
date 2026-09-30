"""The Kinship dictionary: built from the same word lists as
the answers, so the two agree; every row has its words; every answer finds its row."""

from collections import Counter

import pytest

from ancestree.kinship.dictionary import Section, build, row_for
from ancestree.kinship.terms import Titles
from tests.kinship_fixtures import BOOKS, KINDS, Builder
from tests.unit.test_kinship_blood import TERMS, related
from tests.unit.test_kinship_languages import siblings
from tests.unit.test_kinship_marriage import ROWS

SECTIONS = build(BOOKS, KINDS)


def rows(sections: tuple[Section, ...] = SECTIONS) -> dict[str, dict[str, str | None]]:
    """Each row's word in each language, by row id."""
    return {
        row.id: {code: word.word for code, word in row.words.items()}
        for section in sections
        for row in section.rows
    }


def test_rows_have_unique_ids() -> None:
    ids = Counter(row.id for section in SECTIONS for row in section.rows)
    assert [row for row, count in ids.items() if count > 1] == []


def test_every_note_is_for_a_row_that_exists() -> None:
    # A typo in a word list's dictionary section would silently lose its notes.
    known = set(rows())
    for code, book in BOOKS.items():
        noted = set(book.data.get("dictionary") or {})
        assert noted - known == set(), code


def test_every_relation_has_a_word_in_every_language() -> None:
    for section in SECTIONS:
        for row in section.rows:
            for code, word in row.words.items():
                if row.kin is not None:
                    assert word.word, (row.id, code)


def test_a_row_about_words_says_when_a_language_has_none() -> None:
    # Rows without a relation take their word from the list; a missing one must be deliberate.
    for section in SECTIONS:
        for row in section.rows:
            if row.kin is None:
                for code, book in BOOKS.items():
                    notes = book.dictionary_notes(row.id)
                    assert "word" in notes, (row.id, code)


def test_generation_names_go_eighteen_up_and_down() -> None:
    [generations] = [s for s in SECTIONS if s.id == "generations"]
    by_id = {row.id: row for row in generations.rows}

    assert len(generations.rows) == 36
    assert by_id["up-18"].words["jv"].word == "simbah trah tumerah"
    assert by_id["down-7"].words["jv"].word == "gantung siwur"
    assert by_id["up-4"].words["ms"].word == "buyut"
    assert by_id["down-5"].words["ms"].word == "oneng-oneng"
    assert by_id["up-3"].words["en"].word == "great-grandparent"


def test_the_dictionary_says_what_the_answers_say() -> None:
    words = rows()
    family = siblings()

    assert words["uncle-eldest"]["ms"] == family.word("Ali", "Along", "ms") == "pak long"
    assert words["uncle-elder"]["jv"] == family.word("Ali", "Along", "jv") == "pakdhé"
    assert words["aunt-youngest"]["ms"] == "mak su"
    assert words["cousin-of-parent"]["ms"] == "sepupu emak"
    assert words["co-sibling-in-law"] == {
        "en": "wife's sister's husband",
        "ms": "biras",
        "jv": "pripéan",
    }


def test_descriptions_are_marked() -> None:
    marked = {
        (row.id, code): word.descr
        for section in SECTIONS
        for row in section.rows
        for code, word in row.words.items()
    }

    assert marked["cousin-of-parent", "ms"]  # sepupu emak: said in pieces
    assert marked["co-sibling-in-law", "en"]  # no English word
    assert not marked["co-sibling-in-law", "ms"]  # biras is a word
    assert not marked["uncle-elder", "jv"]


def test_malay_titles_follow_the_familys_own() -> None:
    books = {**BOOKS, "ms": BOOKS["ms"].with_titles(Titles(("sulung", "tengah", "alang"), "busu"))}
    words = rows(build(books, KINDS))

    assert words["uncle-eldest"]["ms"] == "pak sulung"
    assert words["aunt-youngest"]["ms"] == "mak busu"


@pytest.mark.parametrize(("up", "down"), sorted(TERMS))
@pytest.mark.parametrize("gender", ["m", "f", "?"])
def test_every_blood_answer_finds_its_row(up: int, down: int, gender: str) -> None:
    [relation] = related(up, down, "m", gender).relate("A", "B")
    assert relation.forward.kin is not None

    assert row_for(relation.forward.kin) is not None


@pytest.mark.parametrize("row", sorted(set(ROWS) - {"guardian"}))
def test_every_in_law_and_step_answer_finds_its_row(row: str) -> None:
    build_family, _, _ = ROWS[row]
    relation = build_family("m", "f").relate("A", "B")[0]
    assert relation.forward.kin is not None

    assert row_for(relation.forward.kin) is not None


def test_an_answer_finds_the_row_that_fits_it_best() -> None:
    family = siblings()

    def row(a: str, b: str) -> str | None:
        kin = family.relate(a, b)[0].forward.kin
        return row_for(kin) if kin else None

    assert row("Ali", "Along") == "uncle-eldest"
    assert row("Ali", "Usu") == "uncle-younger"  # no row for a youngest uncle: seniority
    assert row("Ali", "Angah") == "aunt-second"
    assert row("Mak", "Usu") == "brother-younger"
    grandparents = Builder()
    grandparents.people("F:m GF:m GM:f A:f")
    grandparents.child("GF", "F")
    grandparents.child("GM", "F")
    grandparents.child("F", "A")
    kin = grandparents.relate("A", "GM")[0].forward.kin
    assert kin is not None
    assert row_for(kin) == "grandmother-paternal"
