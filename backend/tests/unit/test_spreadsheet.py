"""The spreadsheet export: one row per person."""

import csv
import io

import pytest

from ancestree.exchange.spreadsheet import COLUMNS, ENCODING, guard, unguard, write_people_csv
from tests.unit.export_family import NOTES, sample_family

# The spreadsheet with every column, the place of death's too: its switch on.
pytestmark = pytest.mark.usefixtures("death_places")


def rows() -> dict[str, dict[str, str]]:
    family, _ = sample_family()
    text = write_people_csv(family)
    table = list(csv.reader(io.StringIO(text, newline="")))
    assert table[0] == list(COLUMNS)
    return {row[1].split()[0]: dict(zip(COLUMNS, row, strict=True)) for row in table[1:]}


def test_everyone_but_unknown_parents_has_a_row() -> None:
    assert set(rows()) == {
        "Ismail",
        "Fatimah",
        "Hassan",
        "Aminah",
        "Mariam",
        "Yusof",
        "Nor",
        "Latif",
        "Rahman",
        "Siti",
        "Umar",
        "Hana",
    }


def test_a_row_reads_like_the_person_panel() -> None:
    hassan = rows()["Hassan"]

    assert hassan["Full name"] == "Hassan bin Ismail"
    assert hassan["Nickname"] == "Acan"
    assert hassan["Name in Jawi"] == "حسن بن إسماعيل"
    assert hassan["Gender"] == "Male"
    assert hassan["Born"] == "12/3/1938"
    assert hassan["Birthplace"] == "Kota Bharu, Kelantan, Malaysia"
    assert hassan["Died"] == "2011"
    assert hassan["Living"] == "no"
    assert hassan["Parents"] == "Ismail bin Abu (father); Fatimah binti Daud (mother)"
    assert hassan["Spouses"] == "Mariam binti Salleh (wife)"
    assert hassan["Children"] == "Yusof bin Hassan; Nor binti Hassan"
    assert hassan["Story (words)"] == "13"  # not counting the ## and the list's dashes
    assert hassan["Sources"] == "Birth certificate, 1938; Talk with Nor, 2019"
    # Commas and line breaks survive the trip through the file.
    assert hassan["Notes"] == NOTES


def test_other_kinds_of_parent_and_former_spouses_are_named_as_such() -> None:
    table = rows()

    assert table["Nor"]["Parents"] == (
        "Hassan bin Ismail (adoptive parent); Mariam binti Salleh (adoptive parent); "
        "Latif bin Omar (guardian)"
    )
    assert table["Rahman"]["Spouses"] == "Siti binti Ali (former wife)"
    assert table["Siti"]["Died"] == "in the war"
    assert table["Umar"]["Parents"] == ""  # only an unknown parent


def test_excel_reads_it_as_utf8() -> None:
    assert ENCODING == "utf-8-sig"  # the byte-order mark Excel looks for


FULL_WIDTH_EQUALS, FULL_WIDTH_AT = chr(0xFF1D), chr(0xFF20)


@pytest.mark.parametrize(
    "written",
    [
        "=1+1",
        "+1",
        "-1",
        "@SUM(A1)",
        " =1+1",
        f"{FULL_WIDTH_EQUALS}HYPERLINK(1)",
        f"{FULL_WIDTH_AT}x",
    ],
)
def test_a_cell_a_spreadsheet_would_run_is_written_as_plain_text(written: str) -> None:
    guarded = guard(written)
    assert guarded == "'" + written
    assert unguard(str(guarded)) == written


def test_every_cell_is_quoted_so_no_semicolon_splits_one() -> None:
    """Excel splits on ";" where commas are decimal points: a quoted cell it never splits."""
    family, _ = sample_family()
    header = write_people_csv(family).lstrip(chr(0xFEFF)).splitlines()[0]
    assert header.startswith('"')
    assert header.endswith('"')
    assert next(csv.reader(io.StringIO(header))) == list(COLUMNS)
