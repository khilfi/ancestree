"""Addresses: a place's address, district, postcode and
location kept, and read as before where a place has none; where someone with no place of their
own lives, at their parents'; and addresses in GEDCOM and the spreadsheet only when chosen. The
people are made up; the places are real."""

import csv
import io
from datetime import UTC, datetime
from uuid import uuid7

import pytest
from pydantic import ValidationError

from ancestree.domain.person import Gender, Person, Place
from ancestree.domain.views import PersonDetail, at_parents
from ancestree.exchange.copies import hidden_detail, hidden_family
from ancestree.exchange.family import FamilyData, Member
from ancestree.exchange.gedcom import write_gedcom
from ancestree.exchange.records import person_record
from ancestree.exchange.returned import ReturnedPerson
from ancestree.exchange.spreadsheet import ADDRESS_COLUMNS, write_people_csv
from ancestree.repo.mapping import person_from_props, person_to_props, place_from, place_props
from tests.unit.export_family import KINDS

HOME = Place(
    town="Kajang",
    state="Selangor",
    address="No. 12, Jalan Melati 3",
    district="Hulu Langat",
    postcode="43000",
    lat=2.993,
    lon=101.788,
    exact="postcode",
)
KOTA_BHARU = Place(town="Kota Bharu", state="Kelantan")
F, M = Gender.FEMALE, Gender.MALE


def test_a_place_keeps_every_part_and_a_place_from_before_reads_as_it_did() -> None:
    props = place_props("residence", HOME)
    assert (props["residence_address"], props["residence_postcode"]) == (
        "No. 12, Jalan Melati 3",
        "43000",
    )
    assert place_from("residence", props) == HOME
    older = place_from(
        "residence",
        {
            "residence_town": "Kajang",
            "residence_state": "Selangor",
            "residence_country": "Malaysia",
        },
    )
    assert older == Place(town="Kajang", state="Selangor")
    assert older is not None
    assert (older.address, older.lat, older.exact) == (None, None, None)
    assert not Place(address="No. 12, Jalan Melati 3").is_empty  # an address alone is a place
    assert not Place(postcode="43000").is_empty
    assert Place().is_empty


def test_a_location_is_both_its_numbers_and_how_exact_needs_one() -> None:
    for wrong in ({"lat": 2.993}, {"lon": 101.788}, {"exact": "town"}, {"lat": 91, "lon": 0}):
        with pytest.raises(ValidationError):
            Place.model_validate(wrong)
    assert Place(lat=2.993, lon=101.788).exact is None  # placed, how exactly not said


def test_someone_with_no_place_lives_at_their_parents_whose_as_chosen() -> None:
    """Both parents' when it's one place; the mother's when they live apart, unless the
    father's is chosen; none if elsewhere, or once they've died, or with a place of their own;
    one step only: parents with no place give none."""
    apart = [(M, KOTA_BHARU), (F, HOME)]
    together = [(M, HOME), (F, HOME)]

    def at(*args: object) -> tuple[Place, str] | None:
        found = at_parents(*args)  # type: ignore[arg-type]
        return None if found is None else (found.place, found.whose)

    assert at(None, None, True, together) == (HOME, "parents")
    assert at(None, None, True, apart) == (HOME, "mother")
    assert at(None, None, None, apart) == (HOME, "mother")  # not known to have died
    assert at(None, "father", True, apart) == (KOTA_BHARU, "father")
    assert at(None, "mother", True, apart) == (HOME, "mother")
    assert at(None, None, True, [(M, KOTA_BHARU), (F, None)]) == (KOTA_BHARU, "father")
    assert at(None, "elsewhere", True, together) is None
    assert at(None, None, False, together) is None  # the dead stay where they're written
    assert at(KOTA_BHARU, None, True, together) is None  # a place of their own
    assert at(None, None, True, [(M, None), (F, None)]) is None  # never the grandparents'
    assert at(None, None, True, []) is None


def family_with(person: Person) -> FamilyData:
    return FamilyData({str(person.id): Member(person=person, added="000")}, [], [], dict(KINDS))


AINA = Person(
    id=uuid7(),
    full_name="Aina binti Hassan",
    gender=F,
    residence=HOME,
    birth_place=Place(
        town="Kajang", address="Hospital Kajang", lat=2.9934, lon=101.7862, exact="spot"
    ),
)
MADE_AT = datetime(2026, 10, 14, tzinfo=UTC)


def test_gedcom_holds_addresses_only_when_chosen() -> None:
    plain = write_gedcom(family_with(AINA), made_at=MADE_AT, file_name="family.ged")
    for kept_out in ("ADDR", "POST", "MAP", "No. 12", "43000", "Hospital Kajang"):
        assert kept_out not in plain, kept_out
    assert "2 PLAC Kajang, Selangor" in plain
    full = write_gedcom(family_with(AINA), made_at=MADE_AT, file_name="family.ged", addresses=True)
    for kept in (
        "1 RESI\n2 PLAC Kajang, Selangor, Malaysia\n3 MAP\n4 LATI N2.993\n4 LONG E101.788\n"
        "2 ADDR No. 12, Jalan Melati 3\n3 POST 43000",
        "1 BIRT\n2 PLAC Kajang, Malaysia\n3 MAP\n4 LATI N2.9934\n4 LONG E101.786\n"
        "2 ADDR Hospital Kajang",
    ):
        assert kept.replace("\n", "\r\n") in full, kept


def test_the_spreadsheet_holds_where_they_live_to_the_house_only_when_chosen() -> None:
    def rows(addresses: bool) -> list[dict[str, str]]:
        text = write_people_csv(family_with(AINA), addresses=addresses)
        return list(csv.DictReader(io.StringIO(text)))

    [plain] = rows(False)
    assert not set(ADDRESS_COLUMNS) & set(plain)
    assert plain["Lives in"] == "Kajang, Selangor, Malaysia"
    [full] = rows(True)
    header = list(full)
    assert header[header.index("Lives in") + 1 : header.index("Lives in") + 3] == [
        "Address",
        "Postcode",
    ]
    assert (full["Address"], full["Postcode"]) == ("No. 12, Jalan Melati 3", "43000")
    assert full["Version"] == plain["Version"]  # the versions of earlier spreadsheets hold


def test_a_copy_hiding_living_people_takes_their_addresses_too() -> None:
    hidden = hidden_family(
        family_with(AINA.model_copy(update={"lives_with": "father"})), {str(AINA.id)}
    )
    person = hidden.members[str(AINA.id)].person
    assert (person.residence, person.birth_place, person.lives_with) == (None, None, None)


def test_a_copy_hiding_living_people_doesnt_say_their_parents_live_apart() -> None:
    """Put right in the security review of 0.8.0: their panel said so, a fact of their parents'
    homes, and so, it may be, of their parents' marriage."""
    shown = PersonDetail.model_construct(  # type: ignore[call-arg]
        birth_date=None, parents_apart=True, lives_with="mother"
    )
    hidden = hidden_detail(shown)
    assert (hidden.parents_apart, hidden.lives_with, hidden.residence_at_parents) == (
        False,
        None,
        None,
    )


def test_a_relatives_computer_sends_every_part_and_the_keeper_reads_it() -> None:
    """The family folder's and the copy to edit's records: an address, its
    location and whom they live with travel, and are read back."""
    person = Person(id=uuid7(), full_name="Aina binti Hassan", residence=HOME, lives_with="father")
    record = person_record(person_to_props(person))
    assert (record["residence_postcode"], record["residence_lat"], record["lives_with"]) == (
        "43000",
        2.993,
        "father",
    )
    returned = ReturnedPerson.model_validate(record)
    assert (returned.residence_address, returned.residence_exact, returned.lives_with) == (
        "No. 12, Jalan Melati 3",
        "postcode",
        "father",
    )
    assert person_from_props(person_to_props(person)).residence == HOME
    with pytest.raises(ValidationError):
        ReturnedPerson.model_validate({**record, "residence_lat": 200})
