"""Reading a spreadsheet file however Excel saved it."""

import pytest

from ancestree.exchange.spreadsheet import guard
from ancestree.importing.sheet import READ, SheetError, read_sheet

HEADER = "ID,Full name,Gender,Born,Photo\r\n"


def test_utf8_with_or_without_a_byte_order_mark() -> None:
    text = HEADER + "P1,Hassan bin Ismail,Male,14/3/1938,yes\r\n"
    for data in (text.encode("utf-8-sig"), text.encode("utf-8")):
        sheet = read_sheet(data)
        [row] = sheet.rows
        assert row["Full name"] == "Hassan bin Ismail"
        assert row["Born"] == "14/3/1938"


def test_excels_windows_encoding_and_utf16() -> None:
    text = HEADER + "P1,Amélie binti Ahmad,Female,,\r\n"
    for data in (text.encode("cp1252"), text.encode("utf-16")):
        assert read_sheet(data).rows[0]["Full name"] == "Amélie binti Ahmad"


def test_semicolons_and_tabs_as_well_as_commas() -> None:
    for separator in (";", "\t"):
        text = f"Full name{separator}Parents\r\nAli bin Rosli{separator}Rosli bin Hamid, Aminah\r\n"
        [row] = read_sheet(text.encode()).rows
        assert row["Parents"] == "Rosli bin Hamid, Aminah"


def test_rows_are_numbered_as_excel_shows_them() -> None:
    text = (
        HEADER
        + "P1,Hassan bin Ismail,Male,,\r\n"
        + ",,,,\r\n"  # an empty row is passed over, but still counts
        + '"P2","Nor binti\r\nHassan",Female,,\r\n'  # a line break inside a cell
        + "P3,Aminah binti Hassan,Female,,\r\n"
    )
    rows = read_sheet(text.encode()).rows
    assert [(row.number, row["ID"]) for row in rows] == [(2, "P1"), (4, "P2"), (5, "P3")]


def test_column_names_are_matched_loosely_and_the_rest_listed() -> None:
    text = "  full   NAME ,Age,Photo,Story (words),Notes\r\nZul,45,yes,120,Hi\r\n"
    sheet = read_sheet(text.encode())
    [row] = sheet.rows
    assert row["Full name"] == "Zul"
    assert row["Notes"] == "Hi"
    assert row["Gender"] == ""  # a column the file doesn't have
    assert sheet.not_read == ["Age"]  # the export's own extra columns aren't listed


def test_a_file_without_a_full_name_column_is_refused() -> None:
    with pytest.raises(SheetError, match="Full name"):
        read_sheet(b"Name,Born\r\nZul,1980\r\n")
    with pytest.raises(SheetError, match="empty"):
        read_sheet(b"   \r\n")


def test_a_cell_guarded_against_formulas_reads_as_written() -> None:
    assert guard("=HYPERLINK(1)") == "'=HYPERLINK(1)"
    assert guard("- a note") == "'- a note"
    assert guard("Hassan") == "Hassan"
    text = f"Full name,Notes\r\nZul,{guard('=1+1')}\r\n"
    assert read_sheet(text.encode()).rows[0]["Notes"] == "=1+1"


def test_the_import_reads_the_exports_columns_but_three() -> None:
    assert "Photo" not in READ
    assert "Story (words)" not in READ
    assert "Sources" not in READ
    assert READ[:2] == ("ID", "Full name")
