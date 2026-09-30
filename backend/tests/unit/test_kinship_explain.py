""" "What does this mean?": each answer told with the people on
its path, in English, and where the two lines meet for the ladder."""

from ancestree.kinship.explain import COUSIN_RULE, Explanation
from tests.kinship_fixtures import Builder


def _family() -> Builder:
    """The plan's example: Tok Ismail & Nenek Fatimah's sons Hassan and Rahman, and
    their lines down to Ali on one side and Iman on the other. Siti married Ahmad, whose
    brother Kamal married Zainab; Tok Ismail also had Zul with Wan Esah."""
    b = Builder()
    for name, gender in [
        ("Tok Ismail", "m"),
        ("Nenek Fatimah", "f"),
        ("Wan Esah", "f"),
        ("Hassan", "m"),
        ("Mariam", "f"),
        ("Rahman", "m"),
        ("Zul", "m"),
        ("Aminah", "f"),
        ("Ali", "m"),
        ("Siti", "f"),
        ("Nadia", "f"),
        ("Iman", "?"),
        ("Pak Wan", "m"),
        ("Ahmad", "m"),
        ("Kamal", "m"),
        ("Zainab", "f"),
    ]:
        b.person(name, gender)
    b.marry("Tok Ismail", "Nenek Fatimah")
    b.parents(("Tok Ismail", "Nenek Fatimah"), "Hassan", "Rahman")
    b.parents(("Tok Ismail", "Wan Esah"), "Zul")
    b.marry("Hassan", "Mariam")
    b.parents(("Hassan", "Mariam"), "Aminah")
    b.child("Aminah", "Ali")
    b.child("Rahman", "Siti")
    b.child("Siti", "Nadia")
    b.child("Nadia", "Iman")
    b.marry("Siti", "Ahmad")
    b.child("Pak Wan", "Ahmad", "Kamal")
    b.marry("Kamal", "Zainab")
    return b


def _explain(a: str, b: str) -> Explanation:
    [relation, *_] = _family().relate(a, b)
    assert relation.explanation is not None
    return relation.explanation


def test_cousins_are_explained_by_the_ancestors_they_share() -> None:
    explained = _explain("Ali", "Iman")

    assert explained.sentences == (
        "Ali and Nadia are second cousins: they share great-grandparents, "
        "Tok Ismail & Nenek Fatimah.",
        # Iman's gender isn't recorded: "child", and names rather than "their".
        "Iman is Nadia's child, one generation below Ali: that's what \"once removed\" means.",
    )
    assert explained.top == 3  # Ali > Aminah > Hassan > Tok Ismail: the lines meet there
    assert (explained.pair, explained.removed, explained.rule) == (
        "second cousins",
        "once removed",
        COUSIN_RULE,
    )


def test_removed_upwards_names_the_cousin_on_the_first_persons_line() -> None:
    assert _explain("Ali", "Siti").sentences == (
        "Aminah and Siti are first cousins: they share grandparents, Tok Ismail & Nenek Fatimah.",
        "Ali is Aminah's son, one generation below Siti: that's what \"once removed\" means.",
    )


def test_uncles_nephews_and_siblings() -> None:
    assert _explain("Aminah", "Rahman").sentences == (
        "Rahman is the brother of Aminah's father, Hassan: one generation above Aminah.",
    )
    assert _explain("Hassan", "Siti").sentences == (
        "Siti is Rahman's daughter, and Rahman is Hassan's brother: one generation below Hassan.",
    )
    brothers = _explain("Hassan", "Rahman")
    assert brothers.sentences == (
        "Hassan and Rahman share their parents, Tok Ismail & Nenek Fatimah.",
    )
    assert brothers.pair == "brothers"
    half = _explain("Hassan", "Zul")
    assert half.sentences == ("Hassan and Zul share one parent, Tok Ismail.",)
    assert half.pair == "half-brothers"


def test_a_direct_line_names_the_people_in_between() -> None:
    assert _explain("Ali", "Mariam").sentences == (
        "Mariam is Ali's mother's mother, through Aminah: two generations above Ali.",
    )
    down = _explain("Tok Ismail", "Ali")
    assert down.sentences == (
        "Ali is Tok Ismail's son's daughter's son, through Hassan and Aminah: "
        "three generations below Tok Ismail.",
    )
    assert down.top is None  # no ladder: one line


def test_in_laws_say_whose_relative_each_one_is() -> None:
    assert _explain("Siti", "Kamal").sentences == (
        "Kamal is the brother of Siti's husband, Ahmad.",
    )
    assert _explain("Siti", "Zainab").sentences == (
        "Siti's husband is Ahmad; Ahmad's brother is Kamal; and Kamal's wife is Zainab.",
    )
    assert _explain("Siti", "Ahmad").sentences == ("Ahmad is Siti's husband.",)
