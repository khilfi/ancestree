"""Finding places on the map: names as people write them, and the
gazetteer that comes with the app. The places here are real towns and made-up ones."""

import pytest

from ancestree.domain.person import Place
from ancestree.places.gazetteer import Gazetteer, Pinned, gazetteer, pin_key
from ancestree.places.names import country_named, place_key, state_named


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


# A made-up gazetteer: country, state, kind, name, latitude, longitude, people, other names.
LINES = [
    "MY\t\tN\tMalaysia\t3.1\t101.7\t30000000\t",
    "MY\tKelantan\tS\tKelantan\t5.3\t102.0\t0\t",
    "MY\tKelantan\tP\tKampung Contoh\t6.0\t102.1\t1200\tKg Contoh Lama",
    "MY\tPerak\tP\tKampung Contoh\t4.5\t101.1\t300\t",
    "MY\tPerak\tP\tBandar Contoh\t4.6\t101.2\t90000\t",
    "SG\t\tN\tSingapore\t1.29\t103.85\t5600000\t",
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
