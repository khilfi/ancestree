"""People pinned where they live, by themselves: a place
placed from its address with no internet, at its postcode's area or its town; households
sharing one location; addresses placed more exactly when a country's places come, never one
placed by hand; what's nearest a pin; and what Photon answers, read. The places are made up
in the gazetteer's own lines, after real ones; the people are made up."""

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, ClassVar

import pytest

from ancestree.domain.person import Place
from ancestree.maps import photon
from ancestree.places.gazetteer import Gazetteer
from ancestree.services import placing

LINES = [
    "MY\t\t\tN\tMalaysia\t3.1\t101.7\t30000000\t",
    "MY\tSelangor\t\tS\tSelangor\t3.3\t101.5\t0\t",
    "MY\tSelangor\tHulu Langat\tP\tKajang\t2.99\t101.79\t342657\t",
    "MY\tSelangor\tHulu Langat\tP\tSemenyih\t2.95\t101.84\t50000\t",
    "MY\tSelangor\t\tZ\t43000\t2.985\t101.785\t0\tKajang",
    "MY\tSelangor\t\tZ\t43500\t2.951\t101.843\t0\tSemenyih",
]
KAJANG = Place(town="Kajang", state="Selangor")


@pytest.fixture
def places() -> Gazetteer:
    return Gazetteer(LINES)


def test_an_address_is_placed_at_its_postcode_else_at_its_town(places: Gazetteer) -> None:
    home = KAJANG.model_copy(update={"address": "No. 12, Jalan Melati 3", "postcode": "43000"})
    found = placing.located(home, places)
    assert found is not None
    assert (found.lat, found.lon, found.exact) == (2.985, 101.785, "postcode")
    unknown = home.model_copy(update={"postcode": "99999"})
    found = placing.located(unknown, places)
    assert found is not None
    assert (found.lat, found.lon, found.exact) == (2.99, 101.79, "town")
    nowhere = Place(town="Kampung Tiada", state="Selangor", address="Lot 5")
    assert placing.located(nowhere, places) == nowhere  # not found: left for the map to find


def test_only_an_address_with_no_location_is_placed(places: Gazetteer) -> None:
    """A town alone is found by the map, as before; a location given stays as it is."""
    assert placing.located(KAJANG, places) == KAJANG
    mine = KAJANG.model_copy(
        update={"address": "No. 12", "lat": 3.0006, "lon": 101.7869, "exact": "hand"}
    )
    assert placing.located(mine, places) == mine
    assert placing.located(None, places) is None


def test_what_is_nearest_a_pin_fills_the_address_in(places: Gazetteer) -> None:
    near = places.nearest("MY", 2.96, 101.835)
    assert near is not None
    assert (near.town, near.district, near.state, near.postcode, near.exact) == (
        "Semenyih",
        "Hulu Langat",
        "Selangor",
        "43500",
        "hand",
    )
    assert (near.lat, near.lon) == (2.96, 101.835)  # the pin stays where it was put
    assert places.nearest("MY", 6.1, 102.2) is None  # nothing within 30 km


def test_a_postcode_given_for_two_towns_is_the_one_in_the_town_written(
    places: Gazetteer,
) -> None:
    shared = Gazetteer([*LINES, "MY\tSelangor\t\tZ\t43000\t2.95\t101.84\t0\tSemenyih"])
    first = shared.postcode_at("MY", "43000", "Semenyih", "Selangor")
    assert first is not None
    assert (first.lat, first.lon) == (2.95, 101.84)
    assert places.postcode_at("MY", "00000") is None


def test_a_household_is_its_address_line_town_and_country(places: Gazetteer) -> None:
    one = Place(address="No. 12, Jalan Melati 3", town="Kajang")
    assert placing.household_key(one) == placing.household_key(
        Place(address="NO.12 jalan  melati 3", town="kajang", country="malaysia")
    )
    assert placing.household_key(one) != placing.household_key(
        one.model_copy(update={"town": "Semenyih"})
    )
    assert placing.household_key(KAJANG) is None  # only with an address line


def test_a_household_shares_its_most_exact_location() -> None:
    """A pin put by hand outranks the postcode's area; this one wins a tie, as it's just been
    moved; those with none are left out."""
    by_postcode = KAJANG.model_copy(update={"lat": 2.985, "lon": 101.785, "exact": "postcode"})
    by_hand = KAJANG.model_copy(update={"lat": 3.0006, "lon": 101.7869, "exact": "hand"})
    moved = KAJANG.model_copy(update={"lat": 3.001, "lon": 101.787, "exact": "hand"})
    assert placing.shared(by_postcode, [by_hand, None, KAJANG]).exact == "hand"
    assert placing.shared(by_postcode, [by_hand]).lat == 3.0006
    assert placing.shared(moved, [by_hand]) == moved
    assert placing.shared(KAJANG, []) == KAJANG


def test_a_countrys_places_place_its_addresses_more_exactly_never_one_by_hand(
    places: Gazetteer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(placing, "gazetteer", lambda: places)
    at_town = KAJANG.model_copy(
        update={"address": "No. 12", "postcode": "43000", "lat": 2.99, "lon": 101.79}
    )
    at_town = at_town.model_copy(update={"exact": "town"})
    by_hand = at_town.model_copy(update={"lat": 3.0006, "lon": 101.7869, "exact": "hand"})
    found_once = at_town.model_copy(update={"lat": 2.985, "lon": 101.785, "exact": "postcode"})
    not_yet = KAJANG.model_copy(update={"postcode": "43500"})
    abroad = Place(town="Singapore", country="Singapore", address="1 Raffles Place")
    rows = [
        ("aina", {"residence": at_town, "birth": by_hand}),
        ("siti", {"residence": found_once, "death": not_yet}),
        ("ali", {"residence": abroad}),
    ]
    changes = placing._better(rows, "MY")
    assert set(changes) == {"aina", "siti"}
    assert set(changes["aina"]) == {"residence"}  # never the birthplace placed by hand
    assert changes["aina"]["residence"][1] == {
        "residence_lat": 2.985,
        "residence_lon": 101.785,
        "residence_exact": "postcode",
    }
    assert set(changes["siti"]) == {"death"}  # at its postcode already: nothing better
    assert changes["siti"]["death"][1]["death_exact"] == "postcode"
    assert set(placing._better(rows, None)) == {"aina", "siti"}  # the world's: every country


# --- Photon, read from what it answers; asked of a stand-in on this computer ----------------

HOUSE = {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [101.7869, 3.0006]},
    "properties": {
        "osm_key": "building",
        "type": "house",
        "housenumber": "12",
        "street": "Jalan Melati 3",
        "postcode": "43000",
        "city": "Kajang",
        "county": "Hulu Langat",
        "state": "Selangor",
        "country": "Malaysia",
        "countrycode": "MY",
    },
}
STREET = {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [101.78, 2.99]},
    "properties": {
        "type": "street",
        "name": "Jalan Melati 3",
        "city": "Kajang",
        "countrycode": "MY",
    },
}
TOWN = {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [103.82, 1.35]},
    "properties": {"type": "city", "name": "Singapore", "countrycode": "SG"},
}


class _Photon(BaseHTTPRequestHandler):
    answer: ClassVar[bytes] = b""
    status: ClassVar[int] = 200
    location: ClassVar[str] = ""  # where it sends the page on, answering a redirect
    asked: ClassVar[list[str]] = []  # each test's stand-in has its own (`stand_in`)

    def do_GET(self) -> None:
        type(self).asked.append(self.path)
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        if self.location:
            self.send_header("Location", self.location)
        self.end_headers()
        self.wfile.write(self.answer)

    def log_message(self, *args: Any) -> None:
        pass


@pytest.fixture
def stand_in() -> Iterator[tuple[str, type[_Photon]]]:
    """A made-up Photon on this computer: nothing leaves it."""
    handler = type("Answers", (_Photon,), {"asked": []})
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/api/", handler
    finally:
        server.shutdown()
        server.server_close()


def test_photons_answer_is_read_to_the_house_street_or_town(
    stand_in: tuple[str, type[_Photon]],
) -> None:
    url, handler = stand_in
    handler.answer = json.dumps({"features": [HOUSE, STREET, TOWN, {"nonsense": 1}]}).encode()
    found = photon.look_up(url, "No. 12, Jalan Melati 3, 43000 Kajang", "Malaysia")
    assert [(f.address, f.town, f.exact) for f in found] == [
        ("12 Jalan Melati 3", "Kajang", "spot"),
        ("Jalan Melati 3", "Kajang", "street"),
        ("", "Singapore", "town"),
    ]
    house = found[0]
    assert (house.district, house.state, house.postcode, house.country) == (
        "Hulu Langat",
        "Selangor",
        "43000",
        "MY",
    )
    assert (house.lat, house.lon) == (3.0006, 101.7869)
    [asked] = handler.asked
    assert "q=No.+12%2C+Jalan+Melati+3%2C+43000+Kajang%2C+Malaysia" in asked  # what goes


def test_what_goes_to_photon_is_the_line_with_its_country_once() -> None:
    assert photon.query("  12 Jalan Melati 3 ", "Malaysia") == "12 Jalan Melati 3, Malaysia"
    assert photon.query("Kajang, Malaysia", "Malaysia") == "Kajang, Malaysia"


def test_photon_down_or_answering_otherwise_is_said(stand_in: tuple[str, type[_Photon]]) -> None:
    url, handler = stand_in
    handler.answer = b"<html>not json</html>"
    with pytest.raises(photon.PhotonError, match="couldn't be read"):
        photon.look_up(url, "Kajang", "Malaysia")
    handler.status = 503
    with pytest.raises(photon.PhotonError, match="answered 503"):
        photon.look_up(url, "Kajang", "Malaysia")
    with pytest.raises(photon.PhotonError, match="couldn't be reached"):
        photon.look_up("http://127.0.0.1:9/api/", "Kajang", "Malaysia")


def test_photon_is_trusted_no_further_than_places(stand_in: tuple[str, type[_Photon]]) -> None:
    """Put right in the security review of 0.8.0: a redirect isn't followed, so the address
    goes nowhere else; an answer nested too deep, or larger than places are, is said to be
    unreadable; no more places than asked for are taken; and true or false is no coordinate."""
    url, handler = stand_in
    handler.status, handler.location = 302, url + "elsewhere"
    with pytest.raises(photon.PhotonError, match="answered 302"):
        photon.look_up(url, "Kajang", "Malaysia")
    assert len(handler.asked) == 1  # not sent on
    handler.status, handler.location = 200, ""
    handler.answer = b"[" * 100_000 + b"]" * 100_000
    with pytest.raises(photon.PhotonError, match="couldn't be read"):
        photon.look_up(url, "Kajang", "Malaysia")
    handler.answer = b" " * (photon.MOST_BYTES + 1)
    with pytest.raises(photon.PhotonError, match="more than places"):
        photon.look_up(url, "Kajang", "Malaysia")
    yes_no = {**HOUSE, "geometry": {"type": "Point", "coordinates": [True, False]}}
    handler.answer = json.dumps({"features": [yes_no, *[HOUSE] * 50]}).encode()
    found = photon.look_up(url, "Kajang", "Malaysia")
    assert len(found) == photon.MOST
    assert {(f.lat, f.lon) for f in found} == {(3.0006, 101.7869)}
    # What it's asked for is compared in small letters, as the page compares it.
    assert photon.query("Jalan Straße 1, MALAYSIA", "Malaysia") == "Jalan Straße 1, MALAYSIA"
