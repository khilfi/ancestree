"""The word lists: English, Malay and Javanese share their keys, and
the words themselves are data."""

import re
from collections.abc import Mapping
from importlib import resources
from itertools import pairwise
from typing import Any

import yaml

from ancestree.domain.kinship import KinshipSettings
from ancestree.kinship.blood import Place
from ancestree.kinship.finder import relate
from ancestree.kinship.terms import TermBook, Titles
from tests.kinship_fixtures import BOOKS, ENGLISH, Builder

# What only some languages have: which parent half-siblings share, the Javanese possessive,
# and the birth-order titles; and each language's dictionary notes.
LANGUAGE_ONLY = {"grammar.half_paternal", "grammar.half_maternal", "grammar.possessive_suffix"}
GENERATION = re.compile(r"^blood\.(\d+,0|0,\d+)$")


def read(language: str) -> dict[str, Any]:
    text = resources.files("ancestree.kinship").joinpath(f"terms/{language}.yaml").read_text()
    data: dict[str, Any] = yaml.safe_load(text)
    return data


def entries(data: Mapping[str, Any]) -> set[str]:
    """Every entry by its section and structure key: "blood.2,1", "in_law.=u", "grammar.side".
    What's inside an entry (which genders, seniority...) is each language's own business."""
    return {
        f"{section}.{key}"
        for section, content in data.items()
        if isinstance(content, Mapping) and section not in {"kinds", "dictionary", "titles"}
        for key in content
    }


def test_every_language_has_every_english_entry() -> None:
    english = entries(read("en")) - {"grammar.sentence", "grammar.nth"}
    for language in ("ms", "jv"):
        assert english - entries(read(language)) == set(), language


def test_the_other_languages_only_add_distinctions_and_generations() -> None:
    english = entries(read("en"))
    for language in ("ms", "jv"):
        extra = entries(read(language)) - english - LANGUAGE_ONLY
        # Only more generation names, straight up or down: buyut; canggah … trah tumerah.
        assert all(GENERATION.match(entry) for entry in extra), extra


def test_the_default_malay_titles_are_the_settings_defaults() -> None:
    # ms.yaml's titles are used until Settings says otherwise; the two must agree.
    defaults = KinshipSettings()
    assert BOOKS["ms"].titles == Titles(tuple(defaults.titles), defaults.youngest)


def test_titles_name_each_place_and_the_youngest() -> None:
    titles = Titles(("long", "ngah", "lang"), "su")

    assert titles.title(Place(1, 4)) == "long"
    assert titles.title(Place(3, 4)) == "lang"
    assert titles.title(Place(4, 4)) == "su"  # the youngest has its own title
    assert titles.title(Place(2, 2)) == "su"
    assert titles.title(Place(4, 6)) is None  # no title for the 4th: the general word
    assert Titles((), "").title(Place(1, 3)) is None


def test_a_family_can_give_its_own_titles() -> None:
    family = Builder()
    family.people("Tok:m Nek:f Ali:m")
    for n, name in enumerate(["Along", "Angah", "Alang", "Andak", "Mak", "Usu"], start=1):
        family.person(name, "f" if name == "Mak" else "m", order=n)
    family.parents(("Tok", "Nek"), "Along", "Angah", "Alang", "Andak", "Mak", "Usu")
    family.child("Mak", "Ali")
    built = family.family()
    perak = BOOKS["ms"].with_titles(Titles(("long", "ngah", "lang", "andak"), "su"))
    books = {**BOOKS, "ms": perak}

    def malay(b: str) -> str:
        return relate(built, "Ali", b, ENGLISH, books)[0].forward.words["ms"].term

    assert malay("Andak") == "pak andak"
    assert malay("Usu") == "pak su"
    assert family.word("Ali", "Andak", "ms") == "pak cik"  # the default titles stop at lang


def test_english_numbers_distant_generations() -> None:
    family = Builder()
    names = [f"G{n}" for n in range(8)]
    for name in names:
        family.person(name, "f")
    for parent, child in pairwise(names):
        family.child(parent, child)

    assert family.says("G7", "G0") == "G0 is G7's maternal 5th great-grandmother"
    assert family.says("G0", "G7") == "G7 is G0's 5th great-granddaughter"


def test_every_language_is_said_in_an_english_sentence() -> None:
    family = Builder()
    family.people("Ali:m Siti:f")
    family.marry("Ali", "Siti")

    [relation] = family.relate("Ali", "Siti")

    assert relation.forward.words["ms"].sentence == "Siti is Ali's isteri"  # D12
    assert relation.forward.words["jv"].sentence == "Siti is Ali's bojo"
    assert relation.forward.words["en"].sentence == relation.forward.sentence
    assert not any(said.english for said in relation.forward.words.values())


def test_without_a_word_the_english_one_stands_in() -> None:
    book = TermBook({"language": "Test"}, "xx")  # a language with no words at all
    family = Builder()
    family.people("Ali:m Siti:f")
    family.marry("Ali", "Siti")

    [relation] = relate(family.family(), "Ali", "Siti", ENGLISH, {"xx": book})

    said = relation.forward.words["xx"]
    assert (said.term, said.english) == ("wife", True)
