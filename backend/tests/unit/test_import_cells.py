"""Reading one spreadsheet cell for an import."""

import pytest

from ancestree.domain.person import DateQualifier, Gender, PartialDate, Place
from ancestree.domain.relationship import SpouseStatus
from ancestree.importing.cells import (
    CellError,
    Mention,
    link_kind,
    read_date,
    read_gender,
    read_living,
    read_mentions,
    read_place,
    read_text,
    spouse_status,
    written_date,
)
from tests.unit.export_family import KINDS


@pytest.mark.parametrize(
    ("text", "gender"),
    [
        ("Male", Gender.MALE),
        (" m ", Gender.MALE),
        ("Lelaki", Gender.MALE),
        ("L", Gender.MALE),
        ("female", Gender.FEMALE),
        ("Perempuan", Gender.FEMALE),
        ("P", Gender.FEMALE),
        ("", Gender.UNKNOWN),
    ],
)
def test_genders_in_english_or_malay(text: str, gender: Gender) -> None:
    assert read_gender(text) == gender


def test_a_gender_that_isnt_one_is_left_out() -> None:
    with pytest.raises(CellError, match="Male or Female"):
        read_gender("x")


def test_living_is_yes_no_or_worked_out() -> None:
    assert read_living("yes") is True
    assert read_living("Tidak") is False
    assert read_living("") is None
    with pytest.raises(CellError):
        read_living("maybe")


def test_dates_are_read_as_the_app_reads_typed_dates() -> None:
    assert read_date("14/3/1938") == PartialDate(year=1938, month=3, day=14)
    assert read_date("sekitar 1950") == PartialDate(year=1950, qualifier=DateQualifier.ABOUT)
    assert read_date("") is None


def test_a_date_that_isnt_one_keeps_what_was_written() -> None:
    with pytest.raises(CellError, match="February 1950 has no day 31"):
        read_date("31/2/1950")
    kept = written_date("  31/2/1950 ")
    assert kept == PartialDate(original_text="31/2/1950")
    assert kept.year is None


@pytest.mark.parametrize(
    ("text", "place"),
    [
        ("Kota Bharu, Kelantan", Place(town="Kota Bharu", state="Kelantan")),
        # As the spreadsheet export writes it.
        ("Kota Bharu, Kelantan, Malaysia", Place(town="Kota Bharu", state="Kelantan")),
        ("Kelantan", Place(state="Kelantan")),
        ("Georgetown, Penang", Place(town="Georgetown", state="Pulau Pinang")),
        ("Setapak, Kuala Lumpur", Place(town="Setapak", state="W.P. Kuala Lumpur")),
        ("Muar", Place(town="Muar")),
        ("Jakarta, Indonesia", Place(town="Jakarta", country="Indonesia")),
        (
            "Medan, Sumatera Utara, Indonesia",
            Place(town="Medan", state="Sumatera Utara", country="Indonesia"),
        ),
        ("Singapore", Place(country="Singapore")),
        (
            "Kg. Parit Empat, Mukim Lima, Johor",
            Place(town="Kg. Parit Empat, Mukim Lima", state="Johor"),
        ),
    ],
)
def test_places_read_town_state_and_country(text: str, place: Place) -> None:
    assert read_place(text) == place


def test_an_empty_place_is_none() -> None:
    assert read_place(" , ") is None
    assert read_place("Malaysia") is None


def test_text_keeps_the_forms_limits() -> None:
    assert read_text("  Tok   Ismail ", "nickname") == "Tok Ismail"
    assert read_text("Line one\nLine two", "notes", lines=True) == "Line one\nLine two"
    with pytest.raises(CellError, match="100 characters"):
        read_text("x" * 101, "nickname")


def test_people_are_listed_with_what_kind_of_link_in_brackets() -> None:
    assert read_mentions("Ismail bin Abu (father); Fatimah binti Daud (mother)") == [
        Mention("Ismail bin Abu", "father"),
        Mention("Fatimah binti Daud", "mother"),
    ]
    assert read_mentions("P1, P2 (adoptive)\nP3") == [
        Mention("P1"),
        Mention("P2", "adoptive"),
        Mention("P3"),
    ]
    assert read_mentions("  ;  ") == []


@pytest.mark.parametrize(
    ("label", "kind"),
    [
        (None, "biological"),
        ("father", "biological"),  # the export's own words
        ("Mother", "biological"),
        ("birth", "biological"),
        ("ayah", "biological"),
        ("adoptive", "adoptive"),
        ("adoptive parent", "adoptive"),
        ("guardian", "guardian"),
    ],
)
def test_a_parents_label_names_a_kind(label: str | None, kind: str) -> None:
    assert link_kind(label, KINDS, "parent") == kind


def test_a_childs_label_names_a_kind_from_the_child_side() -> None:
    assert link_kind("adopted child", KINDS, "child") == "adoptive"
    assert link_kind("son", KINDS, "child") == "biological"
    assert link_kind("ward", KINDS, "child") == "guardian"


def test_a_label_that_isnt_a_kind_is_left_out() -> None:
    with pytest.raises(CellError, match="isn't a kind of parent"):
        link_kind("step-father", KINDS, "parent")


def test_a_spouses_label_says_married_divorced_or_widowed() -> None:
    assert spouse_status(None) is SpouseStatus.MARRIED
    assert spouse_status("wife") is SpouseStatus.MARRIED
    assert spouse_status("former wife") is SpouseStatus.DIVORCED
    assert spouse_status("Bekas suami") is SpouseStatus.DIVORCED
    assert spouse_status("widowed") is SpouseStatus.WIDOWED
    with pytest.raises(CellError, match="former"):
        spouse_status("second")
