import calendar
import json
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from ancestree.config import REPO_ROOT
from ancestree.domain.dates import (
    DateParseError,
    describe_partial_date,
    format_partial_date,
    parse_partial_date,
    years_between,
)
from ancestree.domain.person import DateQualifier, PartialDate


@pytest.mark.parametrize(
    ("text", "description"),
    [
        ("1950", "1950"),
        ("3/1950", "March 1950"),
        ("12/3/1950", "12 March 1950"),
        ("12-3-1950", "12 March 1950"),
        ("12.03.1950", "12 March 1950"),
        ("1950-03-12", "12 March 1950"),
        ("March 1950", "March 1950"),
        ("mac 1950", "March 1950"),
        ("12 Ogos 1950", "12 August 1950"),
        ("December 25, 1950", "25 December 1950"),
        ("c. 1920", "about 1920"),
        ("circa 1920", "about 1920"),
        ("sekitar 1920", "about 1920"),
        ("~1920", "about 1920"),
        ("before 1900", "before 1900"),
        ("sebelum Mac 1900", "before March 1900"),
        ("after 1945", "after 1945"),
        ("1910-1915", "between 1910 and 1915"),
        ("1910–1915", "between 1910 and 1915"),  # noqa: RUF001 - en dash, as people type it
        ("between 1910 and 1915", "between 1910 and 1915"),
        ("antara 1910 dan 1915", "between 1910 and 1915"),
        ("  12/3/1950  ", "12 March 1950"),
    ],
)
def test_reads_dates_as_people_type_them(text: str, description: str) -> None:
    date = parse_partial_date(text)

    assert date is not None
    assert describe_partial_date(date) == description


# The date picker reads dates in the browser (frontend/src/lib/dates.ts): both are tested on
# these examples, so what the picker shows is what's saved.
_READINGS: list[dict[str, Any]] = json.loads(
    (REPO_ROOT / "frontend" / "src" / "lib" / "date-readings.json").read_text("utf-8")
)


@pytest.mark.parametrize("example", _READINGS, ids=[e["reading"] for e in _READINGS])
def test_reads_dates_as_the_date_picker_does(example: dict[str, Any]) -> None:
    date = PartialDate.model_validate(example["date"])

    assert describe_partial_date(date) == example["reading"]


@pytest.mark.parametrize("text", [None, "", "   "])
def test_blank_means_unknown(text: str | None) -> None:
    assert parse_partial_date(text) is None


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("12/3/50", "4-digit year"),
        ("30/2/1950", "February 1950 has no day 30"),
        ("13/1950", "no month 13"),
        ("32/1/1950", "no day 32"),
        ("Smarch 1950", "isn't a month name"),
        ("zaman Jepun", "Couldn't read"),
        ("1915-1910", "must not be before"),
    ],
)
def test_explains_what_it_cannot_read(text: str, message: str) -> None:
    with pytest.raises(DateParseError, match=message):
        parse_partial_date(text)


def test_years_between_is_exact_only_when_the_dates_leave_no_doubt() -> None:
    born = PartialDate(year=1938, month=3, day=14)

    assert years_between(born, PartialDate(year=2011, month=3, day=13)) == (72, False)
    assert years_between(born, PartialDate(year=2011, month=3, day=14)) == (73, False)
    # Born in March, and it's September: the birthday has passed whatever the day was.
    march = PartialDate(year=1986, month=3)
    assert years_between(march, PartialDate(year=2026, month=9, day=27)) == (40, False)
    assert years_between(PartialDate(year=1986), PartialDate(year=2026, month=9)) == (40, True)
    about = PartialDate(year=1962, qualifier=DateQualifier.ABOUT)
    assert years_between(about, PartialDate(year=2026, month=9, day=27)) == (64, True)
    assert years_between(PartialDate(year=2000), PartialDate(year=1999)) is None


def test_the_editable_form_is_short() -> None:
    assert format_partial_date(PartialDate(year=1950, month=3, day=12)) == "12/3/1950"
    assert format_partial_date(PartialDate(year=1920, qualifier=DateQualifier.ABOUT)) == "c. 1920"
    between = PartialDate(year=1910, year_to=1915, qualifier=DateQualifier.BETWEEN)
    assert format_partial_date(between) == "1910-1915"


_years = st.integers(min_value=1000, max_value=2100)
_qualifiers = st.sampled_from(
    [DateQualifier.EXACT, DateQualifier.ABOUT, DateQualifier.BEFORE, DateQualifier.AFTER]
)


@st.composite
def _dates(draw: st.DrawFn) -> PartialDate:
    year, qualifier = draw(_years), draw(_qualifiers)
    precision = draw(st.sampled_from(["year", "month", "day", "between"]))
    if precision == "between":
        other = draw(_years)
        return PartialDate(
            year=min(year, other), year_to=max(year, other), qualifier=DateQualifier.BETWEEN
        )
    if precision == "year":
        return PartialDate(year=year, qualifier=qualifier)
    month = draw(st.integers(min_value=1, max_value=12))
    if precision == "month":
        return PartialDate(year=year, month=month, qualifier=qualifier)
    day = draw(st.integers(min_value=1, max_value=calendar.monthrange(year, month)[1]))
    return PartialDate(year=year, month=month, day=day, qualifier=qualifier)


@given(_dates())
def test_every_date_reads_back_from_its_editable_form(date: PartialDate) -> None:
    assert parse_partial_date(format_partial_date(date)) == date
