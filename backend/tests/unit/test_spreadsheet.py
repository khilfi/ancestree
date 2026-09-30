"""The spreadsheet export: one row per person."""

import csv
import io

from ancestree.exchange.spreadsheet import COLUMNS, ENCODING, write_people_csv
from tests.unit.export_family import NOTES, sample_family


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
