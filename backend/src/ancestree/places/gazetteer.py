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


@dataclass(frozen=True, order=True)
class Suggestion:
    """What an address line may be: to fill in the place's town, district, state,
    postcode and country, and where it is, as exactly as the postcode's spot or the town's; or
    what's nearest a point put on the map by hand."""

    town: str
    district: str
    state: str
    postcode: str
    country: str  # its English name, as the person form has it
    lat: float
    lon: float
    exact: Literal["postcode", "town", "hand"]


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
    def __init__(
        self,
        lines: Iterable[str] | Callable[[], Iterable[str]],
        more: Callable[[str], Iterable[str] | None] = lambda key: None,
    ) -> None:
        """`lines`, as gazetteer.tsv.gz has them, the countries first; or what reads them
        afresh, each time a country is wanted. `more`: the lines of the places downloaded with
        the map, by key, a country's ("my") or the world's ("world"), or None where none
        is: a country's own file is read in place of these lines for it, and the world's
        beside them."""
        if callable(lines):
            self._lines = lines
        else:
            kept = list(lines)
            self._lines = lambda: kept
        self._more = more
        self.places: dict[str, Named] = {}  # by country, once read
        self._grid: dict[tuple[int, int], list[Entry]] = {}  # the same places, by where
        # Each postcode, reduced, with the towns it's given for: from downloads alone.
        self.postcodes: dict[tuple[str, str], list[tuple[str, Entry]]] = {}
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
            postcodes: dict[tuple[str, str], list[tuple[str, Entry]]] = defaultdict(list)
            seen: set[str] = set()  # a town in the app's own lines and the world's, once
            for read in self._sources(wanted):
                line = read.rstrip("\n")
                if line[: line.find("\t")] not in wanted or line in seen:
                    continue
                seen.add(line)
                fields = line.split("\t")
                if fields[3] == "N":
                    continue
                entry = self._entry(fields)
                if entry.kind == "Z":  # a postcode, with its town
                    postcodes[(entry.country, place_key(entry.name))].append((fields[8], entry))
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
            self.postcodes |= postcodes
            self.places |= named

    def _sources(self, wanted: set[str]) -> Iterator[str]:
        """The lines for these countries: each one's own file where it's downloaded;
        for the rest, the app's own lines and the world's file, where that's downloaded."""
        rest = set(wanted)
        for code in sorted(wanted):
            own = self._more(code.lower())
            if own is not None:
                rest.discard(code)
                yield from own
        if rest:
            yield from (line for line in self._lines() if line[: line.find("\t")] in rest)
            yield from (
                line for line in self._more("world") or () if line[: line.find("\t")] in rest
            )

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

    def postcode_at(
        self, code: str, postcode: str, town: str | None = None, state: str | None = None
    ) -> Entry | None:
        """Where a postcode is, from downloads alone: of one given for several towns, the
        one in the town written, else in the state written, else the first."""
        self.load([code])
        found = self.postcodes.get((code, place_key(postcode)), [])
        if not found:
            return None

        def fit(given: tuple[str, Entry]) -> tuple[bool, bool]:
            named, entry = given
            return (
                place_key(named) != place_key(town or ""),
                place_key(entry.state) != place_key(state or ""),
            )

        return min(found, key=fit)[1]

    def nearest(self, code: str, lat: float, lon: float) -> Suggestion | None:
        """The place known nearest a point in a country, for a pin put on the map before
        its address: its town within 30 km, with its district and state, and the nearest
        postcode within 15 km. None if no town is that near."""
        self.load([code])
        towns = [entry for _, entry in self.near(lat, lon, 30.0) if entry.country == code]
        if not towns:
            return None
        town = towns[0]
        closest = min(
            (
                (km_between(lat, lon, entry.lat, entry.lon), entry.name)
                for (country, _), given in self.postcodes.items()
                if country == code
                for _, entry in given
            ),
            default=None,
        )
        postcode = closest[1] if closest is not None and closest[0] <= 15.0 else ""
        country = self.countries[code].name
        return Suggestion(town.name, town.district, town.state, postcode, country, lat, lon, "hand")

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

    def suggest(self, code: str, line: str, most: int = 8) -> list[Suggestion]:
        """What an address line, as it's typed, may be, in a country: its postcodes first,
        each with its town, and of those the one whose town the line names too; then the towns
        and places lived at that the line names: those in a postcode's state first; then those
        named later in it, as an address ends with its town ("Taman Bunga Raya, Kajang"); then
        those named by more of its words (Kota Bharu before Johor Bahru, which "Bharu" alone
        names too); then the biggest. A town its postcode is suggested with isn't suggested
        again. Postcodes come from downloads alone."""
        self.load([code])
        if code not in self.places:
            return []
        country = self.countries[code].name
        words = line.replace(",", " ").split()
        runs = [
            (start + size, size, " ".join(words[start : start + size]))
            for size in range(min(len(words), 4), 0, -1)
            for start in range(len(words) - size + 1)
        ]
        named = {place_key(run) for _, _, run in runs}
        found: dict[tuple[str, str], tuple[tuple[int, ...], str, Suggestion]] = {}

        def add(rank: tuple[int, ...], name: str, suggestion: Suggestion) -> None:
            key = (place_key(suggestion.town), suggestion.postcode)
            if key not in found or (rank, name) < found[key][:2]:
                found[key] = (rank, name, suggestion)

        postcodes = [
            hit for _, _, run in runs for hit in self.postcodes.get((code, place_key(run)), ())
        ]
        states = {place_key(entry.state) for _, entry in postcodes}
        posted = {(place_key(town), place_key(entry.state)) for town, entry in postcodes}
        for town, entry in postcodes:
            district = entry.district or self._district(code, town, entry.state)
            add((0 if place_key(town) in named else 1,), town,
                Suggestion(town, district, entry.state, entry.name, country,
                           entry.lat, entry.lon, "postcode"))  # fmt: skip
        for end, size, run in runs:
            for entry in self._named(code, run):
                if entry.kind not in ("P", "L") or (
                    (place_key(entry.name), place_key(entry.state)) in posted
                ):
                    continue
                elsewhere = 1 if states and place_key(entry.state) not in states else 0
                add((2, elsewhere, -end, -size, -entry.population), entry.name,
                    Suggestion(entry.name, entry.district, entry.state, "", country,
                               entry.lat, entry.lon, "town"))  # fmt: skip
        return [suggestion for _, _, suggestion in sorted(found.values())[:most]]

    def _district(self, code: str, town: str, state: str) -> str:
        """A town's district, for a postcode given none: GeoNames gives Malaysia's none."""
        found = [
            entry
            for entry in self._named(code, town)
            if entry.kind == "P" and entry.district and place_key(entry.state) == place_key(state)
        ]
        return max(found, key=lambda entry: entry.population).district if found else ""


def district_of(place: Place | None) -> str | None:
    """The district a place's town is in, as the gazetteer has it: None for a town it doesn't
    know, or knows without one."""
    if place is None or not place.town:
        return None
    spot = gazetteer().locate(place, {})
    return spot.district if spot is not None and spot.found == "town" else None


def _read(path: Path = FILE) -> Iterator[str]:
    with gzip.open(path, "rt", encoding="utf-8") as lines:
        yield from lines


def _none_here(key: str) -> Path | None:
    return None


# Where the places downloaded with the map are, by key, "my" or "world": the app tells it
# as it starts, from the map's packs. None until then, and where none is downloaded.
places_of: Callable[[str], Path | None] = _none_here


def _downloaded(key: str) -> Iterator[str] | None:
    path = places_of(key)
    return None if path is None else _read(path)


@cache
def gazetteer() -> Gazetteer:
    """The gazetteer, its countries read the first time a place is looked up; each country's
    places when one there is, from its download if it has one. Made afresh when a
    download comes or goes (`gazetteer.cache_clear`)."""
    return Gazetteer(_read, _downloaded)
