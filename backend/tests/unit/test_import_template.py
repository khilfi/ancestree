"""The import template and its example."""

import csv
import io

from ancestree.exchange.spreadsheet import ENCODING
from ancestree.importing.matching import Tree, plan_sheet
from ancestree.importing.sheet import READ, read_sheet
from ancestree.importing.template import TEMPLATE, template_csv
from tests.unit.export_family import KINDS


def test_the_template_is_the_columns_an_import_reads_but_the_version() -> None:
    table = list(csv.reader(io.StringIO(template_csv(), newline="")))
    assert table == [list(TEMPLATE)]
    assert [column for column in READ if column not in TEMPLATE] == ["Version"]  # exports only


def test_the_example_imports_as_the_whole_test_family() -> None:
    data = template_csv(example=True).encode(ENCODING)

    result = plan_sheet(read_sheet(data), Tree([], [], KINDS), {})

    assert len(result.people) == 40  # everyone but the unknown parent
    assert all(person.row is not None for person in result.people)
    assert result.left_out == []
    assert result.questions == []
    spouses = [link for link in result.links if link.type == "spouse"]
    parents = [link for link in result.links if link.type == "parent"]
    assert (len(spouses), len(parents)) == (14, 50)
    assert sum(link.status == "divorced" for link in spouses) == 1
    assert sum(link.kind == "adoptive" for link in parents) == 2


def test_the_example_shows_dates_places_and_kinds_as_typed() -> None:
    rows = {
        row[1]: dict(zip(TEMPLATE, row, strict=True))
        for row in csv.reader(io.StringIO(template_csv(example=True), newline=""))
    }
    hassan = rows["Hassan bin Ismail"]
    assert hassan["ID"] == "hassan"
    assert hassan["Born"] == "14/3/1938"
    assert hassan["Birthplace"] == "Kota Bharu, Kelantan"
    assert hassan["Parents"] == "Ismail bin Ahmad; Fatimah binti Yusof"
    assert rows["Lina binti Zakaria"]["Parents"] == (
        "Yusof bin Ismail (adoptive); Rokiah binti Salleh (adoptive)"
    )
    assert rows["Karim bin Hassan"]["Spouses"] == (
        "Suraya binti Idris (former); Noraini binti Musa"
    )
    assert rows["Fatimah binti Yusof"]["Born"] == "c. 1905"
