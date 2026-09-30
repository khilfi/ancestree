"""The golden test: the statements a family note worked out by hand,
from its five links and the brothers' birth order. The names are made up; the note's own
are kept private. test_kinship_languages.py checks the note's own Malay words (abg, pakcik...)."""

import pytest

from tests.kinship_fixtures import Builder


def the_note() -> Builder:
    family = Builder()
    family.person("?", unknown_parent=True)  # the brothers' parents aren't recorded
    family.person("Haji Hamzah", "m", order=1)  # the elder brother
    family.person("Abdullah Salleh", "m", order=2)
    family.person("Nenek Kalsom", "f")
    family.person("Nenek Zaleha", "f")
    family.person("Na'imah", "f")
    family.person("Abdul Karim", "m")
    family.child("?", "Haji Hamzah", "Abdullah Salleh")
    family.child("Haji Hamzah", "Nenek Kalsom")
    family.child("Nenek Kalsom", "Nenek Zaleha")
    family.child("Abdullah Salleh", "Na'imah")
    family.child("Na'imah", "Abdul Karim")
    return family


# The note's line, and what the engine must answer: (A, B, "B is A's ...", detail).
GOLDEN = [
    (
        "haji hamzah > abg > Abdullah salleh",
        "Abdullah Salleh",
        "Haji Hamzah",
        "Haji Hamzah is Abdullah Salleh's elder brother",
        None,
    ),
    (
        "haji hamzah > pakcik > na`imah",
        "Na'imah",
        "Haji Hamzah",
        "Haji Hamzah is Na'imah's uncle",
        "her father's elder brother",
    ),
    (
        "haji hamzah > ayah > nenek kalsom",
        "Nenek Kalsom",
        "Haji Hamzah",
        "Haji Hamzah is Nenek Kalsom's father",
        None,
    ),
    (
        "nenek kalsom > sepupu > na`imah",
        "Na'imah",
        "Nenek Kalsom",
        "Nenek Kalsom is Na'imah's first cousin",
        "her father's brother's daughter",
    ),
    (
        "nenek zaleha > cucu > haji hamzah",
        "Haji Hamzah",
        "Nenek Zaleha",
        "Nenek Zaleha is Haji Hamzah's granddaughter",
        None,
    ),
    (
        "nenek zaleha > dua pupu > Abdul Karim",
        "Abdul Karim",
        "Nenek Zaleha",
        "Nenek Zaleha is Abdul Karim's second cousin",
        None,
    ),
    (
        "nenek kalsom > mak > nenek zaleha",
        "Nenek Zaleha",
        "Nenek Kalsom",
        "Nenek Kalsom is Nenek Zaleha's mother",
        None,
    ),
]


@pytest.mark.parametrize(
    ("note", "a", "b", "sentence", "detail"), GOLDEN, ids=[g[0] for g in GOLDEN]
)
def test_the_engine_reproduces_the_note(
    note: str, a: str, b: str, sentence: str, detail: str | None
) -> None:
    [relation] = the_note().relate(a, b)

    assert relation.forward.sentence == sentence
    assert relation.forward.detail == detail
