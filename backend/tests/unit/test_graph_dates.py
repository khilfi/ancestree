"""The whole dates the timeline draws from, read from flattened properties."""

from ancestree.domain.person import DateQualifier, PartialDate
from ancestree.services.detail import living_from
from ancestree.services.graph import date_from_row


def test_a_date_keeps_its_qualifier_and_range() -> None:
    row = {"birth_year": 1910, "birth_qualifier": "between", "birth_year_to": 1915}

    assert date_from_row(row, "birth") == PartialDate(
        year=1910, qualifier=DateQualifier.BETWEEN, year_to=1915
    )


def test_what_doesnt_fit_is_dropped_rather_than_failing() -> None:
    # 31 February, as an old record might say: the day goes, the month stays.
    assert date_from_row({"death_year": 1950, "death_month": 2, "death_day": 31}, "death") == (
        PartialDate(year=1950, month=2)
    )
    # A range without its end: just the year.
    assert date_from_row({"birth_year": 1900, "birth_qualifier": "between"}, "birth") == (
        PartialDate(year=1900)
    )
    assert date_from_row({"birth_month": 3}, "birth") is None


def test_alive_as_set_by_hand_or_inferred() -> None:
    born = PartialDate(year=1990)

    assert living_from(False, born, None) is False
    assert living_from(None, born, None, this_year=2026) is True
    assert living_from(None, PartialDate(year=1901), None, this_year=2026) is False
    assert living_from(None, born, PartialDate(year=2020)) is False
    assert living_from(None, None, None) is None
