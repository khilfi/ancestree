from ancestree.domain.person import Gender, PartialDate
from ancestree.lineage.birth_order import (
    Sibling,
    compare_siblings,
    order_siblings,
    position_label,
)

M, F, U = Gender.MALE, Gender.FEMALE, Gender.UNKNOWN


def sib(
    name: str, gender: Gender = M, born: PartialDate | None = None, order: int | None = None
) -> Sibling:
    return Sibling(id=name, gender=gender, birth_date=born, birth_order=order, tiebreak=name)


def year(y: int, m: int | None = None, d: int | None = None) -> PartialDate:
    return PartialDate(year=y, month=m, day=d)


def ids(siblings: list[Sibling]) -> list[str]:
    return [s.id for s in siblings]


def test_birth_dates_decide_the_order() -> None:
    ordered, decided = order_siblings(
        [sib("c", born=year(1968)), sib("a", born=year(1962)), sib("b", born=year(1965))]
    )

    assert ids(ordered) == ["a", "b", "c"]
    assert decided


def test_dates_only_decide_at_the_precision_both_have() -> None:
    ordered, decided = order_siblings([sib("x", born=year(1950, 3)), sib("y", born=year(1950))])

    assert set(ids(ordered)) == {"x", "y"}
    assert not decided  # "1950" vs "March 1950" can't tell who came first


def test_a_complete_manual_order_wins_even_over_dates() -> None:
    ordered, decided = order_siblings(
        [sib("a", born=year(1962), order=2), sib("b", born=year(1965), order=1)]
    )

    assert ids(ordered) == ["b", "a"]
    assert decided


def test_twins_are_told_apart_by_manual_order() -> None:
    same_day = year(1970, 5, 5)
    ordered, decided = order_siblings(
        [sib("aina", F, same_day, order=2), sib("aida", F, same_day, order=1)]
    )

    assert ids(ordered) == ["aida", "aina"]
    assert decided


def test_undated_siblings_come_after_dated_ones_and_leave_the_order_open() -> None:
    ordered, decided = order_siblings([sib("undated"), sib("dated", born=year(1950))])

    assert ids(ordered) == ["dated", "undated"]
    assert not decided


def test_comparing_two_siblings_agrees_with_the_family_order() -> None:
    a, b = sib("a", born=year(1962), order=2), sib("b", born=year(1965), order=1)
    c = sib("c", born=year(1968))

    assert (compare_siblings(a, b, [a, b]) or 0) > 0  # a complete manual order wins: b is elder
    assert (compare_siblings(a, b, [a, b, c]) or 0) < 0  # c has no manual place: dates decide
    assert compare_siblings(sib("x"), sib("y"), [sib("x"), sib("y")]) is None


def test_positions_count_sons_among_sons_and_daughters_among_daughters() -> None:
    family = [sib("hassan", M), sib("nor", F), sib("karim", M), sib("zul", M), sib("aminah", F)]

    assert position_label(family, "hassan") == "eldest son"
    assert position_label(family, "karim") == "second son"
    assert position_label(family, "zul") == "youngest son"
    assert position_label(family, "nor") == "elder daughter"
    assert position_label(family, "aminah") == "younger daughter"


def test_only_children_and_unknown_genders() -> None:
    assert position_label([sib("siti", F)], "siti") == "only child"
    assert position_label([sib("siti", F), sib("hafiz", M)], "siti") == "only daughter"
    assert position_label([sib("a", U), sib("b", M), sib("c", U)], "c") == "youngest child"
    # With a sister or brother of unknown gender, sons can't be counted among sons.
    assert position_label([sib("hassan", M), sib("x", U), sib("zul", M)], "hassan") == (
        "eldest child"
    )
    assert position_label([sib("hassan", M), sib("x", U)], "hassan") == "elder child"
