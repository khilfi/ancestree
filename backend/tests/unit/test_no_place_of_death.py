"""The place of death, kept but shown nowhere. With the
switch off, as it ships: no file made for anyone holds it, not even as a row's fingerprint;
what an import is given of it isn't read in, and says so; and a save or a quick fix that sends
one leaves the place kept as it is. The fictional family's names; the places are real."""

import csv
import io
from dataclasses import replace
from datetime import UTC, datetime

from ancestree.domain.person import PartialDate, Place
from ancestree.domain.requests import PersonInput, PersonPatch
from ancestree.exchange.family import FamilyData
from ancestree.exchange.gedcom import write_gedcom
from ancestree.exchange.spreadsheet import ENCODING, fingerprint, read_version, write_people_csv
from ancestree.importing.sheet import read_sheet
from ancestree.importing.template import template_csv
from ancestree.repo.mapping import editable_props
from tests.unit.export_family import sample_family

DIED_AT = Place(address="Lot 12, Kampung Laut", town="Tumpat", state="Kelantan", country="Malaysia")
# The properties that hold a place of death, as the database keeps them.
PLACE_OF_DEATH = {
    f"death_{field}"
    for field in ("town", "state", "country", "address", "district", "postcode", "lat", "lon")
} | {"death_exact"}


def with_a_place_of_death() -> FamilyData:
    """The sample family, Hassan bin Ismail with where he died: a house in Tumpat."""
    family, ids = sample_family()
    hassan = family.members[ids["Hassan"]]
    died = hassan.person.model_copy(update={"death_place": DIED_AT})
    family.members[hassan.id] = replace(hassan, person=died)
    return family


def table(text: str) -> list[dict[str, str]]:
    rows = list(csv.reader(io.StringIO(text, newline="")))
    return [dict(zip(rows[0], row, strict=True)) for row in rows[1:]]


def test_the_spreadsheet_has_no_place_of_death_not_even_in_a_rows_version() -> None:
    for addresses in (False, True):
        text = write_people_csv(with_a_place_of_death(), addresses=addresses)
        assert "Death place" not in text.splitlines()[0]
        assert "Tumpat" not in text
        assert "Kampung Laut" not in text
        [hassan] = [row for row in table(text) if row["Full name"] == "Hassan bin Ismail"]
        assert hassan["Died"] == "2011"
        # A fingerprint of three bytes could be matched against a list of towns: none at all.
        version = read_version(hassan["Version"])
        assert version is not None
        assert version["death_place"] == fingerprint("")


def test_gedcom_says_they_died_but_not_where() -> None:
    made_at = datetime(2026, 10, 15, tzinfo=UTC)
    text = write_gedcom(with_a_place_of_death(), made_at=made_at, file_name="family.ged")
    assert "Tumpat" not in text
    assert "Kampung Laut" not in text
    assert "1 DEAT\r\n2 DATE 2011\r\n" in text


def test_the_template_asks_for_no_place_of_death() -> None:
    for example in (False, True):
        header = next(csv.reader(io.StringIO(template_csv(example=example), newline="")))
        assert "Death place" not in header
        assert {"Died", "Burial place", "Birthplace"} <= set(header)


def test_an_imports_place_of_death_isnt_read_in_and_the_report_says_so() -> None:
    sheet = read_sheet("Full name,Died,Death place\nAli bin Rosli,1990,Klang\n".encode(ENCODING))
    assert sheet.not_read == ["Death place"]
    assert "Death place" not in sheet.columns
    [row] = sheet.rows
    assert (row["Died"], row["Death place"]) == ("1990", "")


def test_a_save_from_the_form_leaves_the_kept_place_of_death_as_it_is() -> None:
    sent = PersonInput(
        full_name="Hassan bin Ismail", death_date=PartialDate(year=2011), death_place=DIED_AT
    )
    props = editable_props(sent)
    assert props["death_year"] == 2011
    assert PLACE_OF_DEATH.isdisjoint(props)  # neither cleared nor changed: untouched
    assert PLACE_OF_DEATH.isdisjoint(editable_props(PersonInput(full_name="Hassan bin Ismail")))


def test_a_quick_fix_can_neither_clear_nor_set_a_place_of_death() -> None:
    assert PersonPatch.model_validate({"death_place": None}).changes() == set()
    given = PersonPatch.model_validate({"residence": DIED_AT.model_dump(), "death_place": None})
    assert given.changes() == {"residence"}
