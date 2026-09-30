"""The gazetteer that comes with the app, and finding a place on the
map with it. Nothing is looked up online: the places are in gazetteer.tsv.gz, made from
GeoNames by places/build.py.

A place is found, in this order: your own pin for it; its town, in its state; its state's
middle; its country, at the capital. Names are compared reduced (names.place_key), so the
usual spellings and abbreviations of Malaysian places all find the same one.
"""

import gzip
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

from ancestree.domain.person import Place
from ancestree.places.names import country_named, place_key, state_named

FILE = Path(__file__).with_name("gazetteer.tsv.gz")

Found = Literal["pin", "town", "state", "country"]
_RANK = {"P": 0, "D": 1, "S": 2}  # a town before a district's or a state's middle


@dataclass(frozen=True)
class Entry:
    country: str  # its code: "MY"
    state: str  # the person form's name in Malaysia; GeoNames' elsewhere
    kind: str  # N a country, S a state's middle, D a district's middle, P a place
    name: str
    lat: float
    lon: float
    population: int


@dataclass(frozen=True)
class Spot:
    """Where a place goes on the map, how it was found, and where it counts: its state (the
    person form's name, in Malaysia) and its country (the English name)."""

    lat: float
    lon: float
    found: Found
    name: str  # what it was found as: "Kota Bharu", "Kelantan", "Malaysia"
    state: str | None
    country: str


@dataclass(frozen=True)
class Pinned:
    """Your own point for a place the gazetteer doesn't know."""

    lat: float
    lon: float


def pin_key(place: Place) -> str:
    """How a place is known among the pins: town, state and country, reduced."""
    state = state_named(place.state) or place.state
    country = country_named(place.country) or place.country
    return "|".join(place_key(part) for part in (place.town, state, country))


class Gazetteer:
    def __init__(self, lines: Iterable[str]) -> None:
        self.places: dict[tuple[str, str], list[Entry]] = defaultdict(list)
        self.states: dict[tuple[str, str], tuple[float, float]] = {}
        self.countries: dict[str, Entry] = {}
        self.codes: dict[str, str] = {}  # a country's name, reduced -> its code
        # Abroad a state has no middle of its own: its towns', weighted by their people.
        weights: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
        middles: dict[tuple[str, str], tuple[float, float]] = {}
        for line in lines:
            country, state, kind, name, lat, lon, people, others = line.rstrip("\n").split("\t")
            entry = Entry(country, state, kind, name, float(lat), float(lon), int(people))
            if kind == "N":
                self.countries[country] = entry
                self.codes[place_key(name)] = country
                continue
            if kind == "S":
                middles[(country, place_key(state))] = (entry.lat, entry.lon)
            elif kind == "P" and state:
                weight = weights[(country, place_key(state))]
                share = max(entry.population, 1)
                weight[0] += entry.lat * share
                weight[1] += entry.lon * share
                weight[2] += share
            for spelling in {name, *filter(None, others.split("|"))}:
                self.places[(country, place_key(spelling))].append(entry)
        self.states = {key: (w[0] / w[2], w[1] / w[2]) for key, w in weights.items()} | middles

    def towns(self, country: str, people: int) -> list[Entry]:
        """The places in a country with at least this many people, biggest first."""
        found = {
            entry
            for (code, _), entries in self.places.items()
            if code == country
            for entry in entries
            if entry.kind == "P" and entry.population >= people
        }
        return sorted(found, key=lambda entry: (-entry.population, entry.name))

    def country_code(self, written: str | None) -> str | None:
        """The code of a country as it's written, or None if it isn't known."""
        name = country_named(written) or written or "Malaysia"
        return self.codes.get(place_key(name))

    def locate(self, place: Place, pins: Mapping[str, Pinned]) -> Spot | None:
        """Where a place goes on the map, or None if its country isn't known."""
        code = self.country_code(place.country)
        country = self.countries[code].name if code else place.country
        # In Malaysia, a state the person form doesn't list isn't a state here either.
        state = state_named(place.state) if code == "MY" else place.state
        pinned = pins.get(pin_key(place))
        if pinned is not None:
            name = place.town or state or country
            return Spot(pinned.lat, pinned.lon, "pin", name, state, country)
        if code is None:
            return None
        if place.town:
            found = self.places.get((code, place_key(place.town)), [])
            if state:
                found = [entry for entry in found if place_key(entry.state) == place_key(state)]
            if found:
                best = min(found, key=lambda e: (_RANK.get(e.kind, 3), -e.population, e.name))
                return Spot(best.lat, best.lon, "town", best.name, best.state or state, country)
        if state and (middle := self.states.get((code, place_key(state)))) is not None:
            return Spot(*middle, "state", state, state, country)
        capital = self.countries[code]
        return Spot(capital.lat, capital.lon, "country", country, None, country)


@cache
def gazetteer() -> Gazetteer:
    """The gazetteer, read the first time a place is looked up (about a second)."""
    with gzip.open(FILE, "rt", encoding="utf-8") as lines:
        return Gazetteer(lines)
