"""Birth order among siblings.

Siblings here are the children of the same parents. Birth dates decide their order
where the dates can; a manual order (set by dragging in the app) decides the rest.
Birth order never decides generations or relationship terms: lineage does.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import pairwise

from ancestree.domain.person import Gender, PartialDate


@dataclass(frozen=True)
class Sibling:
    id: str
    gender: Gender
    birth_date: PartialDate | None
    birth_order: int | None
    tiebreak: str = ""  # stable order when nothing else decides, e.g. when they were added


def compare_births(a: PartialDate | None, b: PartialDate | None) -> int | None:
    """Negative if `a` was born first, positive if `b` was, None if the dates can't tell.

    Dates only decide at the precision both have: 1950 vs March 1950 can't tell.
    """
    if a is None or b is None or a.year is None or b.year is None:
        return None
    if a.year != b.year:
        return a.year - b.year
    if a.month is None or b.month is None:
        return None
    if a.month != b.month:
        return a.month - b.month
    if a.day is None or b.day is None or a.day == b.day:
        return None
    return a.day - b.day


def _by_manual_order(a: Sibling, b: Sibling) -> int | None:
    if a.birth_order is None or b.birth_order is None or a.birth_order == b.birth_order:
        return None
    return a.birth_order - b.birth_order


def compare_siblings(a: Sibling, b: Sibling, family: Sequence[Sibling]) -> int | None:
    """Negative if `a` is the elder of two children of the same parents, None if unknown.

    Agrees with `order_siblings` on the same family: a complete manual order wins over dates.
    """
    by_dates, by_hand = compare_births(a.birth_date, b.birth_date), _by_manual_order(a, b)
    if all(s.birth_order is not None for s in family):
        return by_hand
    return by_dates or by_hand


def order_siblings(siblings: Sequence[Sibling]) -> tuple[list[Sibling], bool]:
    """Eldest first, and whether every step of that order is actually known."""
    if siblings and all(s.birth_order is not None for s in siblings):
        # A complete manual order wins: it is also how wrong-looking dates get overruled.
        ordered = sorted(siblings, key=lambda s: (s.birth_order or 0, s.tiebreak))
        return ordered, all(_by_manual_order(a, b) is not None for a, b in pairwise(ordered))

    def compare(a: Sibling, b: Sibling) -> int:
        decided = compare_births(a.birth_date, b.birth_date) or _by_manual_order(a, b)
        if decided:
            return decided
        dated_a = a.birth_date is not None and a.birth_date.year is not None
        dated_b = b.birth_date is not None and b.birth_date.year is not None
        if dated_a != dated_b:
            return -1 if dated_a else 1
        return (a.tiebreak > b.tiebreak) - (a.tiebreak < b.tiebreak)

    ordered = _insertion_sorted(siblings, compare)
    decided = all(
        (compare_births(a.birth_date, b.birth_date) or _by_manual_order(a, b) or 0) < 0
        for a, b in pairwise(ordered)
    )
    return ordered, decided


def _insertion_sorted(
    siblings: Sequence[Sibling], compare: Callable[[Sibling, Sibling], int]
) -> list[Sibling]:
    """Sorted and stable, by a rule simple enough to follow exactly elsewhere: the copy's
    kinship engine orders siblings the same way. Dates of mixed
    precision can make `compare` disagree with itself (a year alone against two full dates),
    and then a library sort's answer depends on how that library sorts."""
    ordered: list[Sibling] = []
    for sibling in siblings:
        index = len(ordered)
        while index > 0 and compare(ordered[index - 1], sibling) > 0:
            index -= 1
        ordered.insert(index, sibling)
    return ordered


def position_label(ordered: Sequence[Sibling], person_id: str) -> str:
    """Where someone sits among their siblings: "eldest son", "younger daughter", "only child".

    Sons are counted among sons and daughters among daughters. While a brother's or sister's
    gender is unknown, that can't be done, so everyone is counted as a child. Only meaningful
    when `order_siblings` says the order is decided.
    """
    me = next(s for s in ordered if s.id == person_id)
    if len(ordered) == 1:
        return "only child"
    unsure = any(s.gender is Gender.UNKNOWN for s in ordered if s.id != person_id)
    if me.gender is Gender.UNKNOWN or unsure:
        noun, same = "child", [s.id for s in ordered]
    else:
        noun = "son" if me.gender is Gender.MALE else "daughter"
        same = [s.id for s in ordered if s.gender == me.gender]
    index, count = same.index(person_id), len(same)
    if count == 1:
        return f"only {noun}"
    if count == 2:
        return f"{'elder' if index == 0 else 'younger'} {noun}"
    if index == 0:
        return f"eldest {noun}"
    if index == count - 1:
        return f"youngest {noun}"
    return f"{_ordinal(index + 1)} {noun}"


def _ordinal(number: int) -> str:
    words = [
        "first",
        "second",
        "third",
        "fourth",
        "fifth",
        "sixth",
        "seventh",
        "eighth",
        "ninth",
        "tenth",
    ]
    if number <= len(words):
        return words[number - 1]
    suffix = (
        "th" if 10 <= number % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    )
    return f"{number}{suffix}"
