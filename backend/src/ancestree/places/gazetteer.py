"""The gazetteer that comes with the app, and finding a place on the
map with it. Nothing is looked up online: the places are in gazetteer.tsv.gz, made from
GeoNames by places/build.py.

A place is found, in this order: your own pin for it; its town, in its state; its state's
middle; its country, at the capital. Names are compared reduced (names.place_key), so the
usual spellings and abbreviations of Malaysian places all find the same one. A town found says
its district too, where GeoNames gives one: "Kampung Laut, Tumpat, Kelantan".

The countries are read at once; each country's places when one there is first wanted:
a family has its places in a few countries, and Indonesia alone has a quarter of a million,
which no family that never lived there should carry in memory. Its places are also kept by
where they are, so the towns around a family's places can be named on the map.
"""

import gzip
import math
import threading
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

from ancestree.domain.person import Place
from ancestree.places.names import country_named, place_key, state_named

FILE = Path(__file__).with_name("gazetteer.tsv.gz")

Found = Literal["pin", "town", "state", "country"]
_RANK = {"P": 0, "D": 1, "S": 2}  # a town before a district's or a state's middle
CELL = 0.1  # degrees of the grid places are kept in by where they are: about 11 km
KM_PER_DEGREE = 111.2


def km_between(lat: float, lon: float, other_lat: float, other_lon: float) -> float:
    """How far apart two points are, near enough for tens of kilometres."""
    across = (lon - other_lon) * math.cos(math.radians((lat + other_lat) / 2))
    return KM_PER_DEGREE * math.hypot(lat - other_lat, across)


def _cell(lat: float, lon: float) -> tuple[int, int]:
    return math.floor(lat / CELL), math.floor(lon / CELL)


@dataclass(frozen=True, slots=True)
class Entry:
    country: str  # its code: "MY"
    state: str  # the person form's name in Malaysia; GeoNames' elsewhere
    district: str  # a place's, as GeoNames names it, or ""
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
    district: str | None = None  # a town's, where GeoNames gives one: "Tumpat"


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


# A country's places by each name they go by, reduced: most names are one place's alone, kept
# as it is rather than in a list.
Named = dict[str, Entry | list[Entry]]


class Gazetteer:
    def __init__(self, lines: Iterable[str] | Callable[[], Iterable[str]]) -> None:
        """`lines`, as gazetteer.tsv.gz has them, the countries first; or what reads them
        afresh, each time a country is wanted."""
        if callable(lines):
            self._lines = lines
        else:
            kept = list(lines)
            self._lines = lambda: kept
        self.places: dict[str, Named] = {}  # by country, once read
        self._grid: dict[tuple[int, int], list[Entry]] = {}  # the same places, by where
        self.states: dict[tuple[str, str], tuple[float, float]] = {}
        self.countries: dict[str, Entry] = {}
        self.codes: dict[str, str] = {}  # a country's name, reduced -> its code
        self._shared: dict[str, str] = {}  # each state's and district's name, kept once
        self._lock = threading.Lock()
        for line in self._lines():
            fields = line.rstrip("\n").split("\t")
            if fields[3] != "N":
                break  # the countries come first
            entry = self._entry(fields)
            self.countries[entry.country] = entry
            self.codes[place_key(entry.name)] = entry.country

    def _entry(self, fields: list[str]) -> Entry:
        country, state, district, kind, name, lat, lon, people, _ = fields
        one = self._shared.setdefault
        return Entry(
            one(country, country),
            one(state, state),
            one(district, district),
            kind,
            name,
            float(lat),
            float(lon),
            int(people),
        )

    def load(self, codes: Iterable[str | None]) -> None:
        """These countries' places, if they aren't here yet: read together, in one go."""
        wanted = {code for code in codes if code in self.countries} - self.places.keys()
        if not wanted:
            return
        with self._lock:
            wanted -= self.places.keys()
            if not wanted:
                return
            named: dict[str, Named] = {code: {} for code in wanted}
            # Abroad a state has no middle of its own: its towns', weighted by their people.
            weights: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
            middles: dict[tuple[str, str], tuple[float, float]] = {}
            grid: dict[tuple[int, int], list[Entry]] = defaultdict(list)
            for line in self._lines():
                if line[: line.find("\t")] not in wanted:
                    continue
                fields = line.rstrip("\n").split("\t")
                if fields[3] == "N":
                    continue
                entry = self._entry(fields)
                if entry.kind == "P":
                    grid[_cell(entry.lat, entry.lon)].append(entry)
                if entry.kind == "S":
                    middles[(entry.country, place_key(entry.state))] = (entry.lat, entry.lon)
                elif entry.kind == "P" and entry.state:
                    weight = weights[(entry.country, place_key(entry.state))]
                    share = max(entry.population, 1)
                    weight[0] += entry.lat * share
                    weight[1] += entry.lon * share
                    weight[2] += share
                names = named[entry.country]
                for spelling in {entry.name, *filter(None, fields[8].split("|"))}:
                    key = place_key(spelling)
                    have = names.get(key)
                    if have is None:
                        names[key] = entry
                    elif isinstance(have, list):
                        have.append(entry)
                    else:
                        names[key] = [have, entry]
            self.states |= {key: (w[0] / w[2], w[1] / w[2]) for key, w in weights.items()}
            self.states |= middles
            # New lists, never longer ones, for a cell on a border: the map may be reading.
            self._grid |= {cell: [*self._grid.get(cell, ()), *got] for cell, got in grid.items()}
            self.places |= named

    def _named(self, code: str, written: str) -> list[Entry]:
        found = self.places.get(code, {}).get(place_key(written))
        return [] if found is None else found if isinstance(found, list) else [found]

    def towns(self, country: str, people: int) -> list[Entry]:
        """The places in a country with at least this many people, biggest first."""
        self.load([country])
        found = {
            entry
            for entries in self.places.get(country, {}).values()
            for entry in (entries if isinstance(entries, list) else [entries])
            if entry.kind == "P" and entry.population >= people
        }
        return sorted(found, key=lambda entry: (-entry.population, entry.name))

    def near(self, lat: float, lon: float, km: float) -> list[tuple[float, Entry]]:
        """The places within `km` of a point, nearest first, each with how far it is: in the
        countries read so far, which are the family's."""
        rows = math.ceil(km / KM_PER_DEGREE / CELL)
        width = KM_PER_DEGREE * max(math.cos(math.radians(lat)), 0.01)
        columns = math.ceil(km / width / CELL)
        row, column = _cell(lat, lon)
        found = [
            (distance, entry)
            for r in range(row - rows, row + rows + 1)
            for c in range(column - columns, column + columns + 1)
            for entry in self._grid.get((r, c), ())
            if (distance := km_between(lat, lon, entry.lat, entry.lon)) <= km
        ]
        return sorted(found, key=lambda pair: (pair[0], pair[1].name))

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
        self.load([code])
        if place.town:
            found = self._named(code, place.town)
            if state:
                found = [entry for entry in found if place_key(entry.state) == place_key(state)]
            if found:
                best = min(found, key=lambda e: (_RANK.get(e.kind, 3), -e.population, e.name))
                where, district = best.state or state, best.district or None
                return Spot(best.lat, best.lon, "town", best.name, where, country, district)
        if state and (middle := self.states.get((code, place_key(state)))) is not None:
            return Spot(*middle, "state", state, state, country)
        capital = self.countries[code]
        return Spot(capital.lat, capital.lon, "country", country, None, country)


def district_of(place: Place | None) -> str | None:
    """The district a place's town is in, as the gazetteer has it: None for a town it doesn't
    know, or knows without one."""
    if place is None or not place.town:
        return None
    spot = gazetteer().locate(place, {})
    return spot.district if spot is not None and spot.found == "town" else None


def _read() -> Iterator[str]:
    with gzip.open(FILE, "rt", encoding="utf-8") as lines:
        yield from lines


@cache
def gazetteer() -> Gazetteer:
    """The gazetteer, its countries read the first time a place is looked up; each country's
    places when one there is."""
    return Gazetteer(_read)
