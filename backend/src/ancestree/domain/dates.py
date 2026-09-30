"""Reading and writing partial dates the way people type them.

Day before month, as written in Malaysia:

    1950 · 3/1950 · 12/3/1950 · 12-3-1950 · 12.3.1950 · 1950-03-12 (ISO)
    March 1950 · Mac 1950 · 12 March 1950 · March 12, 1950
    c. 1950 · about 1950 · before 1900 · after 1900 · 1910-1915 · between 1910 and 1915

Malay month names and words work too: Mac, Ogos, Disember; sekitar, sebelum, selepas,
antara 1910 dan 1915.
"""

import calendar
import math
import re

from pydantic import ValidationError

from ancestree.domain.person import DateQualifier, PartialDate

MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]

_MONTHS = {
    name: number
    for number, names in enumerate(
        [
            ("january", "jan", "januari"),
            ("february", "feb", "februari"),
            ("march", "mar", "mac"),
            ("april", "apr"),
            ("may", "mei"),
            ("june", "jun"),
            ("july", "jul", "julai"),
            ("august", "aug", "ogos"),
            ("september", "sep", "sept"),
            ("october", "oct", "oktober", "okt"),
            ("november", "nov"),
            ("december", "dec", "disember", "dis"),
        ],
        start=1,
    )
    for name in names
}

_QUALIFIERS = [
    (
        DateQualifier.ABOUT,
        re.compile(
            r"^(?:circa|ca\.?|c\.?|about|abt\.?|approx\.?|around|~|sekitar|lebih kurang|kira-kira)"
            r"\s*(?P<rest>.+)$"
        ),
    ),
    (DateQualifier.BEFORE, re.compile(r"^(?:before|bef\.?|<|sebelum)\s*(?P<rest>.+)$")),
    (DateQualifier.AFTER, re.compile(r"^(?:after|aft\.?|>|selepas)\s*(?P<rest>.+)$")),
]

_RANGES = [
    re.compile(r"^(?:between|bet\.?|antara)\s+(?P<a>\d{4})\s+(?:and|&|dan)\s+(?P<b>\d{4})$"),
    # Hyphen, en dash or em dash: people type all three, so the dashes here are deliberate.
    re.compile(r"^(?P<a>\d{4})\s*(?:-|–|—|to|hingga|sehingga)\s*(?P<b>\d{4})$"),  # noqa: RUF001
]

_DATES = [
    re.compile(r"^(?P<year>\d{4})$"),
    re.compile(r"^(?P<month>\d{1,2})\s*[/.-]\s*(?P<year>\d{4})$"),
    re.compile(r"^(?P<day>\d{1,2})\s*[/.-]\s*(?P<month>\d{1,2})\s*[/.-]\s*(?P<year>\d{4})$"),
    re.compile(r"^(?P<year>\d{4})-(?P<month>\d{1,2})-(?P<day>\d{1,2})$"),
    re.compile(r"^(?P<month_name>[a-z]+)\.?\s+(?P<year>\d{4})$"),
    re.compile(r"^(?P<day>\d{1,2})\s+(?P<month_name>[a-z]+)\.?,?\s+(?P<year>\d{4})$"),
    re.compile(r"^(?P<month_name>[a-z]+)\.?\s+(?P<day>\d{1,2}),?\s+(?P<year>\d{4})$"),
]

_TWO_DIGIT_YEAR = re.compile(r"(?:^|[/.\s-])\d{2}$")


class DateParseError(ValueError):
    """The text isn't a date AncesTree can read."""


def parse_partial_date(text: str | None) -> PartialDate | None:
    """Read a typed date. Blank text means "unknown" and gives None."""
    if text is None:
        return None
    cleaned = " ".join(text.strip().lower().split())
    if not cleaned:
        return None

    for pattern in _RANGES:
        if match := pattern.match(cleaned):
            return _build(
                year=int(match["a"]), year_to=int(match["b"]), qualifier=DateQualifier.BETWEEN
            )

    qualifier = DateQualifier.EXACT
    for candidate, pattern in _QUALIFIERS:
        if match := pattern.match(cleaned):
            qualifier, cleaned = candidate, match["rest"]
            break

    for pattern in _DATES:
        if match := pattern.match(cleaned):
            parts = match.groupdict()
            month = _month(parts)
            day = int(parts["day"]) if parts.get("day") else None
            if day is not None and not 1 <= day <= 31:
                raise DateParseError(f"There's no day {day}.")
            return _build(year=int(parts["year"]), month=month, day=day, qualifier=qualifier)

    if _TWO_DIGIT_YEAR.search(cleaned):
        raise DateParseError(f"Use a 4-digit year in '{text.strip()}', e.g. 12/3/1950.")
    raise DateParseError(
        f"Couldn't read '{text.strip()}' as a date. Try 1950, 3/1950, 12/3/1950 or c. 1950."
    )


def format_partial_date(date: PartialDate) -> str:
    """The editable form: what `parse_partial_date` reads back to the same date."""
    if date.qualifier is DateQualifier.BETWEEN:
        return f"{date.year}-{date.year_to}"
    if date.year is None:
        return date.original_text or ""
    if date.day is not None:
        core = f"{date.day}/{date.month}/{date.year}"
    elif date.month is not None:
        core = f"{date.month}/{date.year}"
    else:
        core = str(date.year)
    prefix = {
        DateQualifier.ABOUT: "c. ",
        DateQualifier.BEFORE: "before ",
        DateQualifier.AFTER: "after ",
    }.get(date.qualifier, "")
    return prefix + core


def describe_partial_date(date: PartialDate) -> str:
    """For reading: "12 March 1950", "about 1920", "between 1910 and 1915"."""
    if date.qualifier is DateQualifier.BETWEEN:
        return f"between {date.year} and {date.year_to}"
    if date.year is None:
        return date.original_text or ""
    if date.month is not None and date.day is not None:
        core = f"{date.day} {MONTH_NAMES[date.month - 1]} {date.year}"
    elif date.month is not None:
        core = f"{MONTH_NAMES[date.month - 1]} {date.year}"
    else:
        core = str(date.year)
    prefix = {
        DateQualifier.ABOUT: "about ",
        DateQualifier.BEFORE: "before ",
        DateQualifier.AFTER: "after ",
    }.get(date.qualifier, "")
    return prefix + core


def year_of(date: PartialDate) -> float:
    """A date as a point in time: the middle of whatever it doesn't say (the month, the day,
    or the years of a "between"). The timeline does the same (lib/dates.ts)."""
    year = date.year or 0
    if date.qualifier is DateQualifier.BETWEEN and date.year_to is not None:
        return (year + date.year_to + 1) / 2
    if date.month is None:
        return year + 0.5
    day = (date.day - 0.5) / 31 if date.day is not None else 0.5
    return year + (date.month - 1 + day) / 12


type _Day = tuple[int, int, int]


def _bounds(date: PartialDate) -> tuple[_Day, _Day] | None:
    """The earliest and latest days a date could be."""
    if date.year is None:
        return None
    last = date.year
    if date.qualifier is DateQualifier.BETWEEN and date.year_to is not None:
        last = date.year_to
    last_month = date.month or 12
    last_day = date.day or calendar.monthrange(last, last_month)[1]
    return (date.year, date.month or 1, date.day or 1), (last, last_month, last_day)


def _birthdays(start: _Day, end: _Day) -> int:
    years = end[0] - start[0]
    return years - 1 if (end[1], end[2]) < (start[1], start[2]) else years


def years_between(start: PartialDate, end: PartialDate) -> tuple[int, bool] | None:
    """Whole years from one date to another, and whether that's only "about": exact when every
    reading of the two dates agrees. The app's ages work the same way (lib/dates.ts, D17)."""
    first, second = _bounds(start), _bounds(end)
    if first is None or second is None:
        return None
    least, most = _birthdays(first[1], second[0]), _birthdays(first[0], second[1])
    if most < 0:
        return None  # the wrong way round
    rough = start.qualifier is not DateQualifier.EXACT or end.qualifier is not DateQualifier.EXACT
    if not rough and least == most:
        return least, False
    middle = math.floor(year_of(end) - year_of(start))
    years = middle if rough else min(max(middle, least), most)
    return max(0, years), True


def _month(parts: dict[str, str | None]) -> int | None:
    if (number := parts.get("month")) is not None:
        month = int(number)
    elif (name := parts.get("month_name")) is not None:
        if name not in _MONTHS:
            raise DateParseError(f"'{name}' isn't a month name.")
        month = _MONTHS[name]
    else:
        return None
    if not 1 <= month <= 12:
        raise DateParseError(f"There's no month {month}.")
    return month


def _build(**fields: object) -> PartialDate:
    try:
        return PartialDate.model_validate(fields)
    except ValidationError as error:
        message = str(error.errors()[0]["msg"]).removeprefix("Value error, ")
        raise DateParseError(message[:1].upper() + message[1:] + ".") from error
