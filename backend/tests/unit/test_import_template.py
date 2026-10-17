"""The import template and its example, the example family's.
test_import_example.py brings the example into an empty family, and finds it whole."""

import csv
import io

import pytest

from ancestree.exchange.spreadsheet import ENCODING
from ancestree.importing.matching import Tree, plan_sheet
from ancestree.importing.sheet import READ, read_sheet
from ancestree.importing.template import TEMPLATE, template_csv
from tests.unit.export_family import KINDS

# The template with every column, the place of death's too: its switch on.
pytestmark = pytest.mark.usefixtures("death_places")


def test_the_template_is_the_columns_an_import_reads_but_the_version() -> None:
    table = list(csv.reader(io.StringIO(template_csv(), newline="")))
    assert table == [list(TEMPLATE)]
    assert [column for column in READ if column not in TEMPLATE] == ["Version"]  # exports only
    # Where they live to the house, after Lives in (M52), with its district and location.
    lives_in = TEMPLATE.index("Lives in")
    assert TEMPLATE[lives_in : lives_in + 5] == (
        "Lives in",
        "Address",
        "Postcode",
        "District",
        "Location",
    )


def test_the_example_imports_as_the_whole_example_family() -> None:
    data = template_csv(example=True).encode(ENCODING)

    result = plan_sheet(read_sheet(data), Tree([], [], KINDS), {})

    assert len(result.people) == 64  # everyone but the unknown parent
    assert all(person.row is not None for person in result.people)
    assert result.left_out == []
    assert result.questions == []
    spouses = [link for link in result.links if link.type == "spouse"]
    parents = [link for link in result.links if link.type == "parent"]
    assert (len(spouses), len(parents)) == (24, 78)
    assert sum(link.status == "divorced" for link in spouses) == 1
    assert sum(link.status == "widowed" for link in spouses) == 1
    assert sum(link.kind == "adoptive" for link in parents) == 2


def test_the_example_uses_every_column_as_typed() -> None:
    table = list(csv.reader(io.StringIO(template_csv(example=True), newline="")))
    rows = {row[1]: dict(zip(TEMPLATE, row, strict=True)) for row in table[1:]}
    used = {column for row in rows.values() for column, cell in row.items() if cell}
    assert set(TEMPLATE) - used == {"Remove"}  # for taking someone out of the tree
    hassan = rows["Hassan bin Ismail"]
    assert (hassan["ID"], hassan["Title"], hassan["Nickname"]) == ("hassan", "Haji", "Acan")
    assert hassan["Born"] == "14/3/1938"
    assert hassan["Birthplace"] == "Kota Bharu, Kelantan, Malaysia"  # with its country
    assert (hassan["Postcode"], hassan["District"]) == ("15350", "Kota Bharu")
    assert hassan["Location"] == "6.1352, 102.2468"  # put on the map by hand
    assert hassan["Living"] == "no"
    assert hassan["Parents"] == "Ismail bin Ahmad (father); Fatimah binti Yusof (mother)"
    assert rows["Lina binti Zakaria"]["Parents"] == (
        "Yusof bin Ismail (adoptive); Rokiah binti Salleh (adoptive)"
    )
    assert rows["Karim bin Hassan"]["Spouses"] == (
        "Suraya binti Idris (former wife); Noraini binti Musa (wife)"
    )
    assert rows["Rahman bin Ismail"]["Spouses"].startswith("Zainab binti Hamzah (widowed)")
