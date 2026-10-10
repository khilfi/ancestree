"""Finding places on the map: names as people write them, and the
gazetteer that comes with the app. The places here are real towns and made-up ones."""

from unittest.mock import patch
from uuid import uuid4

import pytest

from ancestree.domain.map import Located, MapPerson
from ancestree.domain.person import Place
from ancestree.places.gazetteer import Found, Gazetteer, Pinned, gazetteer, pin_key
from ancestree.places.names import country_named, place_key, state_named
from ancestree.services.places import towns_around


def test_names_compare_without_case_accents_or_the_usual_abbreviations() -> None:
    assert place_key("Kg. Sg. Bharu") == place_key("Kampung Sungai Baru") == "kampung sungai baru"
    assert place_key("Johor Bahru") == place_key("Johor Baharu")
    assert place_key("  Ayer  Itam ") == place_key("Air Itam")
    assert place_key("Bkt. Mertajam") == "bukit mertajam"
    assert place_key("Pengkalan Chépa") == "pengkalan chepa"
    assert place_key(None) == place_key("") == ""


def test_states_and_countries_as_people_write_them() -> None:
    assert state_named("penang") == state_named("P. Pinang") == "Pulau Pinang"
    assert state_named("Kuala  Lumpur") == "W.P. Kuala Lumpur"
    assert state_named("Sumatera Utara") is None
    assert country_named("Arab Saudi") == "Saudi Arabia"
    assert country_named("Singapura") == "Singapore"
    assert country_named("Narnia") is None


# A made-up gazetteer, the countries first: country, state, district, kind, name, latitude,
# longitude, people, other names.
LINES = [
    "MY\t\t\tN\tMalaysia\t3.1\t101.7\t30000000\t",
    "SG\t\t\tN\tSingapore\t1.29\t103.85\t5600000\t",
    "MY\tKelantan\t\tS\tKelantan\t5.3\t102.0\t0\t",
    "MY\tKelantan\tTumpat\tP\tKampung Contoh\t6.0\t102.1\t1200\tKg Contoh Lama",
    "MY\tPerak\t\tP\tKampung Contoh\t4.5\t101.1\t300\t",
    "MY\tPerak\tKinta\tP\tBandar Contoh\t4.6\t101.2\t90000\t",
]


@pytest.fixture
def places() -> Gazetteer:
    return Gazetteer(LINES)


def test_a_town_is_found_in_its_state(places: Gazetteer) -> None:
    found = places.locate(Place(town="Kg. Contoh", state="Perak"), {})
    assert found is not None
    assert (found.lat, found.found, found.name, found.state) == (
        4.5,
        "town",
        "Kampung Contoh",
        "Perak",
    )


def test_a_town_found_says_its_district_where_there_is_one(places: Gazetteer) -> None:
    """ "Bandar Contoh, Kinta, Perak": no district for a town GeoNames gives none."""
    found = places.locate(Place(town="Bandar Contoh", state="Perak"), {})
    assert found is not None
    assert (found.name, found.district, found.state) == ("Bandar Contoh", "Kinta", "Perak")
    unknown = places.locate(Place(town="Kampung Contoh", state="Perak"), {})
    assert unknown is not None
    assert unknown.district is None
    middle = places.locate(Place(town="Kampung Entah", state="Kelantan"), {})
    assert middle is not None
    assert middle.district is None  # a state's middle, not a town


def test_a_countrys_places_are_read_only_once_one_there_is_looked_for() -> None:
    """Indonesia alone has a quarter of a million places: a family that never lived
    there doesn't carry them. The countries themselves are read at once."""
    reads: list[str] = []

    def lines() -> list[str]:
        reads.append("read")
        return LINES

    places = Gazetteer(lines)
    assert places.country_code("Singapura") == "SG"
    assert places.places == {}
    places.locate(Place(town="Kampung Contoh"), {})
    assert set(places.places) == {"MY"}
    places.locate(Place(town="Bandar Contoh", state="Perak"), {})
    places.load(["MY", None, "XX"])  # read already, or not a country it knows
    assert len(reads) == 2  # the countries, then Malaysia's places once


def test_without_a_state_the_bigger_town_of_that_name_wins(places: Gazetteer) -> None:
    found = places.locate(Place(town="Kampung Contoh"), {})
    assert found is not None
    assert (found.lat, found.state) == (6.0, "Kelantan")  # and it counts under its state


def test_other_spellings_find_the_town(places: Gazetteer) -> None:
    found = places.locate(Place(town="Kampung Contoh Lama", state="Kelantan"), {})
    assert found is not None
    assert (found.found, found.name) == ("town", "Kampung Contoh")


def test_a_town_not_found_goes_to_its_states_middle_then_the_country(places: Gazetteer) -> None:
    in_state = places.locate(Place(town="Kampung Entah", state="Kelantan"), {})
    assert in_state is not None
    assert (in_state.lat, in_state.found, in_state.state) == (5.3, "state", "Kelantan")
    # A town in another state than the one given isn't taken: the state's middle is safer.
    elsewhere = places.locate(Place(town="Bandar Contoh", state="Kelantan"), {})
    assert elsewhere is not None
    assert elsewhere.found == "state"
    nowhere = places.locate(Place(town="Kampung Entah"), {})
    assert nowhere is not None
    assert (nowhere.found, nowhere.name, nowhere.country) == ("country", "Malaysia", "Malaysia")


def test_a_country_the_gazetteer_doesnt_know_isnt_placed(places: Gazetteer) -> None:
    assert places.locate(Place(town="Somewhere", country="Narnia"), {}) is None
    found = places.locate(Place(country="Singapura"), {})
    assert found is not None
    assert (found.found, found.country) == ("country", "Singapore")


def test_your_pin_comes_first(places: Gazetteer) -> None:
    place = Place(town="Kampung Entah", state="Kelantan")
    pins = {
        pin_key(Place(town="kg entah", state="kelantan", country="Malaysia")): Pinned(5.9, 102.2)
    }
    found = places.locate(place, pins)
    assert found is not None
    assert (found.lat, found.lon, found.found, found.name) == (5.9, 102.2, "pin", "Kampung Entah")


# The towns named around the family's places. Kampung Asal is the family's; north of it,
# 25 kampungs a third of a kilometre apart; a town 20 km south and another 40 km south.
HOME = (6.0, 102.0)
AROUND = [
    "MY\t\t\tN\tMalaysia\t3.1\t101.7\t30000000\t",
    "MY\tKelantan\t\tS\tKelantan\t5.3\t102.0\t0\t",
    "MY\tKelantan\tTumpat\tP\tKampung Asal\t6.0\t102.0\t0\t",
    *(
        f"MY\tKelantan\tTumpat\tP\tKampung {n:02}\t{6.0 + 0.003 * n:.3f}\t102.0\t0\t"
        for n in range(1, 26)
    ),
    "MY\tKelantan\tBachok\tP\tBandar Dekat\t5.82\t102.0\t5000\t",
    "MY\tKelantan\tMachang\tP\tBandar Jauh\t5.64\t102.0\t90000\t",
    "MY\tKelantan\tTumpat\tP\tKampung Seberang\t6.0\t102.13\t0\t",
]


def lives_in(town: str, lat: float, lon: float, found: Found = "town") -> MapPerson:
    place = Place(town=town, state="Kelantan")
    at = Located(place=place, lat=lat, lon=lon, found=found, name=town, country="Malaysia")
    return MapPerson(id=uuid4(), lives=at)


def test_the_places_near_a_point_nearest_first() -> None:
    places = Gazetteer(AROUND)
    assert places.near(*HOME, 5) == []  # nothing read yet: only the family's countries are
    places.load(["MY"])
    found = places.near(*HOME, 1.5)
    assert [entry.name for _, entry in found] == [
        "Kampung Asal",
        "Kampung 01",
        "Kampung 02",
        "Kampung 03",
        "Kampung 04",
    ]
    assert [round(km, 2) for km, _ in found] == [0.0, 0.33, 0.67, 1.0, 1.33]
    # Across the grid's cells, and towns alone: not the state's middle 78 km away.
    assert [entry.name for _, entry in places.near(*HOME, 21)][-1] == "Bandar Dekat"
    assert all(entry.kind == "P" for _, entry in places.near(*HOME, 100))


def test_towns_are_named_around_the_familys_places() -> None:
    """Towns of 1,000 people or more within 30 km, the biggest first; then the 20 nearest
    places of any size within 10 km. Never the family's own place, which the map names."""
    places = Gazetteer(AROUND)
    places.load(["MY"])
    towns = towns_around(places, [lives_in("Kampung Asal", *HOME)])
    names = [town.name for town in towns]
    assert names == ["Bandar Dekat", *(f"Kampung {n:02}" for n in range(1, 21))]
    assert towns[0].people == 5000
    assert "Bandar Jauh" not in names  # 40 km away
    assert "Kampung Seberang" not in names  # 14 km away, and no town


def test_no_town_is_named_around_a_rough_place_or_none() -> None:
    """A state's middle isn't where anyone lives; a pin is."""
    places = Gazetteer(AROUND)
    places.load(["MY"])
    rough = lives_in("Kampung Entah", 6.0, 102.0, found="state")
    assert towns_around(places, [rough, MapPerson(id=uuid4())]) == []
    pinned = lives_in("Kampung Entah", 6.0, 102.12, found="pin")
    assert [town.name for town in towns_around(places, [pinned])] == [
        "Bandar Dekat",  # 24 km away
        "Kampung Seberang",  # 1 km away
    ]


def test_the_most_names_a_map_carries_are_the_biggest() -> None:
    places = Gazetteer(AROUND)
    places.load(["MY"])
    family = [lives_in("Kampung Asal", *HOME)]
    with patch("ancestree.services.places.MOST_TOWNS", 3):
        towns = towns_around(places, family)
    assert [town.name for town in towns] == ["Bandar Dekat", "Kampung 01", "Kampung 02"]


@pytest.mark.parametrize(
    ("place", "found", "near"),
    [
        (Place(town="Kota Bharu", state="Kelantan"), "town", (6.12, 102.24)),
        (Place(town="Kota Baharu"), "town", (6.12, 102.24)),
        (Place(town="Johor Baharu", state="Johor"), "town", (1.47, 103.76)),
        (Place(town="Kuala Lumpur", state="W.P. Kuala Lumpur"), "town", (3.14, 101.69)),
        (Place(town="Shah Alam", state="Selangor"), "town", (3.09, 101.53)),
        (Place(state="Sabah"), "state", (5.5, 117.0)),
        (Place(town="Singapore", country="Singapore"), "town", (1.29, 103.85)),
        (Place(town="Makkah", country="Arab Saudi"), "town", (21.42, 39.83)),
        (Place(town="Bogor", country="Indonesia"), "town", (-6.59, 106.79)),
        (Place(town="Ubud", state="Bali", country="Indonesia"), "town", (-8.51, 115.27)),
        (Place(town="Cibinong", country="Indonesia"), "town", (-6.48, 106.85)),
    ],
)
def test_real_places_are_found_where_they_are(
    place: Place, found: str, near: tuple[float, float]
) -> None:
    spot = gazetteer().locate(place, {})
    assert spot is not None
    assert spot.found == found
    assert abs(spot.lat - near[0]) < 0.1
    assert abs(spot.lon - near[1]) < 0.1


@pytest.mark.parametrize(
    ("place", "district"),
    [
        (Place(town="Kampung Laut", state="Kelantan"), "Tumpat"),
        (Place(town="Cibinong", country="Indonesia"), "Kabupaten Bogor"),
        (Place(town="Bogor", country="Indonesia"), "Kota Bogor"),
        (Place(town="Ubud", state="Bali", country="Indonesia"), "Kabupaten Gianyar"),
    ],
)
def test_real_places_are_named_to_the_district(place: Place, district: str) -> None:
    """GeoNames' districts: Malaysia's without "Daerah", Indonesia's with "Kabupaten"
    or "Kota", as two of one name are told apart."""
    spot = gazetteer().locate(place, {})
    assert spot is not None
    assert spot.district == district
