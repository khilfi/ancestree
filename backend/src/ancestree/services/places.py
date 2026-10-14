"""The map: where everyone lives and was born, found in the
gazetteer that comes with the app, and the places put on the map by hand, with the towns
around them named. Nothing is looked up online."""

import asyncio
import random
from collections.abc import Collection, Iterable, Mapping
from dataclasses import asdict
from uuid import UUID

from ancestree.domain.map import (
    FamilyCountries,
    FamilyMap,
    Located,
    MapPerson,
    MapPins,
    Pin,
    PlaceSuggestion,
    PlaceSuggestions,
    Town,
)
from ancestree.domain.person import Place
from ancestree.domain.views import AtParents, at_parents
from ancestree.maps import photon
from ancestree.places import gazetteer as gazetteer_module
from ancestree.places.gazetteer import Entry, Gazetteer, Pinned, gazetteer, pin_key
from ancestree.places.names import state_named
from ancestree.repo.places import Places, read_places
from ancestree.seed.generated import generated_family
from ancestree.services.context import Context, RuleError, read
from ancestree.services.detail import living_from
from ancestree.storage.settings import read_pins, write_pins

# The towns named around the family's places, as you chose on 10 Oct 2026: towns of
# 1,000 people or more within 30 km, named from a state's zoom; and the 20 nearest places of
# any size within 10 km, kampungs too, named as you zoom closer (features/map/labels.ts).
BIG = 1_000  # people
FAR_KM = 30.0
CLOSE_KM = 10.0
NEAREST = 20
MOST_TOWNS = 4_000  # names one map carries at most: the biggest, then the nearest


def _pinned(pins: MapPins) -> dict[str, Pinned]:
    return {pin_key(pin.place()): Pinned(pin.lat, pin.lon) for pin in pins.pins}


class _Finder:
    """Finds places, each once: a family has many people in few places."""

    def __init__(self, places: Gazetteer, pins: Mapping[str, Pinned], exact: bool = True) -> None:
        self.places = places
        self.pins = pins
        self.exact = exact  # False: each place no closer than its town (0.8.0)
        self.found: dict[Place, Located] = {}

    def __call__(self, place: Place | None) -> Located | None:
        if place is None or place.is_empty:
            return None
        if not self.exact:
            place = place.to_the_town()
        if place not in self.found:
            spot = self.places.locate(place, self.pins)
            located = (
                Located(place=place, country=place.country)
                if spot is None
                else Located(
                    place=place,
                    lat=spot.lat,
                    lon=spot.lon,
                    found=spot.found,
                    name=spot.name,
                    state=spot.state,
                    country=spot.country,
                    district=spot.district,
                )
            )
            if place.lat is not None and place.lon is not None and place.exact != "town":
                # Its own location, finer than its town, counted under its town and state
                # as found; one with no "how" is the person's own.
                own = {"lat": place.lat, "lon": place.lon, "exact": place.exact or "hand"}
                located = located.model_copy(update=own)
            self.found[place] = located
        return self.found[place]


def towns_around(places: Gazetteer, people: Iterable[MapPerson]) -> list[Town]:
    """The towns named around where these people live and were born: around each place found
    as a town or put on the map by hand, never a state's or a country's middle, and never the
    family's own places, which the map names already. The biggest first, then the nearest."""
    points = {
        (located.lat, located.lon)
        for person in people
        for located in (person.lives, person.born)
        if located is not None
        and located.found in ("town", "pin")
        and located.lat is not None
        and located.lon is not None
    }
    nearest: dict[Entry, float] = {}  # each with how far it is from the family's nearest place
    for lat, lon in points:
        close = 0
        for distance, entry in places.near(lat, lon, FAR_KM):
            if (entry.lat, entry.lon) in points:
                continue
            counted = distance <= CLOSE_KM and close < NEAREST
            close += counted
            if counted or entry.population >= BIG:
                nearest[entry] = min(distance, nearest.get(entry, distance))
    chosen = sorted(
        nearest,
        key=lambda entry: (
            entry.population < BIG,
            -entry.population if entry.population >= BIG else nearest[entry],
            entry.name,
        ),
    )
    return [
        Town(
            name=entry.name,
            lat=round(entry.lat, 4),
            lon=round(entry.lon, 4),
            people=entry.population,
        )
        for entry in chosen[:MOST_TOWNS]
    ]


async def family_map(
    ctx: Context, hidden: Collection[str] = (), *, exact: bool = True
) -> FamilyMap:
    """Everyone but unknown parents, with where they live and were born, the pins, and the
    towns around the family's places. The `hidden` people's places stay off it, and no town is
    named for them: a copy hiding living people's details, where, not `exact`, everyone
    else's are no closer than their town (0.8.0)."""
    rows = await read(ctx, read_places)
    pins = await asyncio.to_thread(read_pins, ctx.data_dir)
    places = await asyncio.to_thread(gazetteer)
    shown = [row for row in rows if row.id not in hidden]
    # The living with no place of their own, at their parents'.
    homes = {row.id: _at_parents(row) for row in shown}
    # The family's countries' places, read in one go and off the event loop.
    written = {place.country for row in shown for place in (row.lives, row.born, row.died) if place}
    await asyncio.to_thread(places.load, [places.country_code(country) for country in written])
    find = _Finder(places, _pinned(pins), exact)
    people = []
    for row in rows:
        at = homes.get(row.id)
        if row.id in hidden:
            people.append(MapPerson(id=UUID(row.id)))
        elif at is not None:
            people.append(
                MapPerson(
                    id=UUID(row.id),
                    lives=find(at.place),
                    born=find(row.born),
                    died=find(row.died),
                    at_parents=at.whose,
                )
            )
        else:
            people.append(
                MapPerson(
                    id=UUID(row.id), lives=find(row.lives), born=find(row.born), died=find(row.died)
                )
            )
    towns = await asyncio.to_thread(towns_around, places, people)
    return FamilyMap(
        people=sorted(people, key=lambda person: str(person.id)), pins=pins.pins, towns=towns
    )


def _at_parents(row: Places) -> AtParents | None:
    """Their parents' place, for the living with no place of their own."""
    living = living_from(row.living, row.born_on, row.died_on)
    return at_parents(row.lives, row.lives_with, living, row.parents)


async def family_countries(ctx: Context) -> FamilyCountries:
    """The countries anyone in the family lives or was born in, by their codes in small
    letters, as the map's packs are keyed."""
    rows = await read(ctx, read_places)
    places = await asyncio.to_thread(gazetteer)
    written = {place.country for row in rows for place in (row.lives, row.born) if place}
    codes = {places.country_code(country) for country in written}
    return FamilyCountries(countries=sorted(code.lower() for code in codes if code))


def suggest(line: str, country: str) -> PlaceSuggestions:
    """What an address line may be, in a country: from its places and postcodes,
    downloaded or the app's own. Reads the gazetteer, so off the event loop."""
    places = gazetteer()
    code = places.country_code(country)
    if code is None:
        return PlaceSuggestions(country=None, downloaded=False, suggestions=[])
    found = places.suggest(code, line) if line.strip() else []
    return PlaceSuggestions(
        country=code.lower(),
        downloaded=gazetteer_module.places_of(code.lower()) is not None,
        suggestions=[PlaceSuggestion(**asdict(each)) for each in found],
    )


def near(lat: float, lon: float, country: str) -> PlaceSuggestion | None:
    """What's nearest a point put on the map before its address, in its country. Reads
    the gazetteer, so off the event loop."""
    places = gazetteer()
    code = places.country_code(country)
    found = places.nearest(code, lat, lon) if code is not None else None
    return PlaceSuggestion(**asdict(found)) if found is not None else None


def look_up(url: str, line: str, country: str) -> PlaceSuggestions:
    """An address looked up online, once, through Photon at `url`: what it found, each to
    check, in the country written where it found any there, and in its own words otherwise. A
    state written as the person form has it, in Malaysia. Off the event loop: it waits on the
    internet."""
    places = gazetteer()
    code = places.country_code(country)
    found = photon.look_up(url, line, country)
    if code is not None and any(each.country == code for each in found):
        found = [each for each in found if each.country == code]
    suggestions = []
    for each in found:
        name = places.countries[each.country].name if each.country in places.countries else ""
        in_malaysia = each.country == "MY"
        suggestions.append(
            PlaceSuggestion(
                town=each.town,
                district=each.district,
                state=(state_named(each.state) or each.state) if in_malaysia else each.state,
                postcode=each.postcode,
                country=name or country,
                lat=each.lat,
                lon=each.lon,
                exact=each.exact,
                address=each.address,
            )
        )
    return PlaceSuggestions(
        country=code.lower() if code else None,
        downloaded=code is not None and gazetteer_module.places_of(code.lower()) is not None,
        suggestions=suggestions,
    )


def _named(place: Place) -> str:
    return place.town or place.state or place.country


async def put_pin(ctx: Context, pin: Pin) -> MapPins:
    """Put a place on the map by hand. A pin for the same place moves to the new point."""
    if not (pin.town or pin.state):
        raise RuleError("no_place", "Say which town or state to put on the map.")
    key = pin_key(pin.place())
    now = await asyncio.to_thread(read_pins, ctx.data_dir)
    pins = MapPins(pins=[*(p for p in now.pins if pin_key(p.place()) != key), pin])
    await asyncio.to_thread(write_pins, ctx.data_dir, pins)
    return pins


async def remove_pin(ctx: Context, place: Place) -> MapPins:
    """Take a place's pin off the map: it's found in the gazetteer again, if it can be."""
    key = pin_key(place)
    now = await asyncio.to_thread(read_pins, ctx.data_dir)
    if not any(pin_key(pin.place()) == key for pin in now.pins):
        raise RuleError("no_pin", f"{_named(place)} isn't on the map by hand.")
    pins = MapPins(pins=[pin for pin in now.pins if pin_key(pin.place()) != key])
    await asyncio.to_thread(write_pins, ctx.data_dir, pins)
    return pins


# Where the made-up family lives abroad, now and then.
_ABROAD = (
    Place(town="Singapore", country="Singapore"),
    Place(town="Bandar Seri Begawan", country="Brunei"),
    Place(town="Jakarta", country="Indonesia"),
    Place(town="Makkah", country="Saudi Arabia"),
    Place(town="London", country="United Kingdom"),
    Place(town="Melbourne", country="Australia"),
)


def sample_map(size: int) -> FamilyMap:
    """The made-up family of `size` on the map, spread over real towns, most in
    Malaysia and the bigger towns more often: to try the map at size. Nothing is stored."""
    rows, _ = generated_family(size)
    places = gazetteer()
    towns = places.towns("MY", 20_000)
    weights = [town.population**0.6 for town in towns]
    rng = random.Random(7)  # noqa: S311 - inventing a family, not keeping secrets

    def somewhere() -> Place:
        if rng.random() < 0.04:
            return rng.choice(_ABROAD)
        town = rng.choices(towns, weights)[0]
        return Place(town=town.name, state=town.state, country="Malaysia")

    find = _Finder(places, {})
    people = [
        MapPerson(
            id=UUID(str(row["id"])),
            lives=find(somewhere()) if rng.random() < 0.8 else None,
            born=find(somewhere()) if rng.random() < 0.6 else None,
        )
        for row in rows
        if not row.get("placeholder")
    ]
    return FamilyMap(people=people, pins=[], towns=towns_around(places, people))
