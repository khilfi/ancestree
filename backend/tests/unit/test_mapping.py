from uuid import uuid7

from ancestree.domain.person import DateQualifier, Gender, PartialDate, Person, Place
from ancestree.repo.mapping import person_from_props, person_to_props


def test_a_full_person_survives_the_round_trip_through_flat_properties() -> None:
    person = Person(
        id=uuid7(),
        full_name="Hassan bin Ismail",
        nickname="Acan",
        title="Haji",
        gender=Gender.MALE,
        birth_date=PartialDate(year=1938, month=3, day=14),
        birth_place=Place(town="Kota Bharu", state="Kelantan"),
        death_date=PartialDate(year=2011, qualifier=DateQualifier.ABOUT),
        residence=Place(town="Singapore", country="Singapore"),
        birth_order=1,
    )

    props = person_to_props(person)

    assert props["birth_year"] == 1938
    assert props["birth_town"] == "Kota Bharu"
    assert person_from_props(props) == person


def test_missing_dates_and_places_are_written_as_empty_properties() -> None:
    props = person_to_props(Person(id=uuid7(), full_name="Salmah binti Daud"))

    assert props["birth_year"] is None
    assert props["death_qualifier"] is None
    assert props["residence_country"] is None
    assert person_from_props(props).birth_date is None
