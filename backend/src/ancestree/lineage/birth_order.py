"""Birth order among siblings.

Siblings here are the children of the same parents. Birth dates decide their order
where the dates can; a manual order (set by dragging in the app) decides the rest.
Birth order never decides generations or relationship terms: lineage does.

Since 0.8.7: a date said "about", "before", "after" or "between" decides only where it
can't overlap the other; and a manual order stays when a child is added, the new one taking
its place among them by its date, or last.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import pairwise

from ancestree.domain.person import DateQualifier, Gender, PartialDate

# "About 1950" could be any year from 1945 to 1955: as an import matches people's dates
# (importing/matching.py).
ABOUT_YEARS = 5

type _Day = tuple[int, int, int]
_EARLIEST: _Day = (0, 0, 0)
_LATEST: _Day = (10_000, 13, 32)


@dataclass(frozen=True)
class Sibling:
    id: str
    gender: Gender
    birth_date: PartialDate | None
    birth_order: int | None
    tiebreak: str = ""  # stable order when nothing else decides, e.g. when they were added


def birth_span(date: PartialDate | None) -> tuple[_Day, _Day] | None:
    """The first and last days a birth could have been on, as (year, month, day): a year alone
    is all of it; "about" is ABOUT_YEARS either side; "before" and "after" have no end on
    their side; "between" runs from the first year to the last. None with no year."""
    if date is None or date.year is None:
        return None
    if date.qualifier is DateQualifier.ABOUT:
        return (date.year - ABOUT_YEARS, 1, 1), (date.year + ABOUT_YEARS, 12, 31)
    last_year = date.year
    if date.qualifier is DateQualifier.BETWEEN and date.year_to is not None:
        last_year = date.year_to
    first = (date.year, date.month or 1, date.day or 1)
    # Day 31 of any month: only ever compared, and no day of the month after comes before it.
    last = (last_year, date.month or 12, date.day or 31)
    if date.qualifier is DateQualifier.BEFORE:
        return _EARLIEST, last
    if date.qualifier is DateQualifier.AFTER:
        return first, _LATEST
    return first, last


def compare_births(a: PartialDate | None, b: PartialDate | None) -> int | None:
    """Negative if `a` was born first, positive if `b` was, None if the dates can't tell.

    Dates only decide where they can't overlap: 1950 against March 1950 can't tell, nor can
    "before 1960" against 1955, "between 1950 and 1960" against 1955, or "about 1950" against
    1953.
    """
    first, second = birth_span(a), birth_span(b)
    if first is None or second is None:
        return None
    if first[1] < second[0]:
        return -1
    if second[1] < first[0]:
        return 1
    return None


def _by_manual_order(a: Sibling, b: Sibling) -> int | None:
    if a.birth_order is None or b.birth_order is None or a.birth_order == b.birth_order:
        return None
    return a.birth_order - b.birth_order


def compare_siblings(a: Sibling, b: Sibling, family: Sequence[Sibling]) -> int | None:
    """Negative if `a` is the elder of two children of the same parents, None if unknown.

    Agrees with `order_siblings` on the same family: a manual order wins over dates, and
    stays when a child is added; a child without one is placed among them by its date,
    which says who is elder only where it agrees with that place.
    """
    by_dates, by_hand = compare_births(a.birth_date, b.birth_date), _by_manual_order(a, b)
    if all(s.birth_order is not None for s in family):
        return by_hand
    if a.birth_order is not None and b.birth_order is not None:
        return by_hand
    if by_dates is None or not any(s.birth_order is not None for s in family):
        return by_dates or by_hand
    places = {s.id: n for n, s in enumerate(order_siblings(family)[0])}
    if a.id not in places or b.id not in places:
        return by_dates
    return by_dates if (by_dates < 0) == (places[a.id] < places[b.id]) else None


def _known(a: Sibling, b: Sibling) -> bool:
    """Whether `a` is known to come before `b`: by hand when both are placed so, else by
    their dates."""
    if a.birth_order is not None and b.birth_order is not None:
        return (_by_manual_order(a, b) or 0) < 0
    return (compare_births(a.birth_date, b.birth_date) or 0) < 0


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

    by_hand = [s for s in siblings if s.birth_order is not None]
    if by_hand:
        # A manual order, then a child added: those placed by hand keep their order, and
        # each of the others, eldest first, goes in after the last one not born after it: by
        # its date, or last if it has none.
        ordered = sorted(by_hand, key=lambda s: (s.birth_order or 0, s.tiebreak))
        for sibling in _insertion_sorted([s for s in siblings if s.birth_order is None], compare):
            index = len(ordered)
            while (
                index > 0
                and (compare_births(ordered[index - 1].birth_date, sibling.birth_date) or 0) > 0
            ):
                index -= 1
            ordered.insert(index, sibling)
        return ordered, all(_known(a, b) for a, b in pairwise(ordered))

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
