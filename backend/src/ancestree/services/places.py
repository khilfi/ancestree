"""The map: where everyone lives and was born, found in the
gazetteer that comes with the app, and the places put on the map by hand, with the towns
around them named. Nothing is looked up online."""

import asyncio
import random
from collections.abc import Collection, Iterable, Mapping
from uuid import UUID

from ancestree.domain.map import FamilyMap, Located, MapPerson, MapPins, Pin, Town
from ancestree.domain.person import Place
from ancestree.places.gazetteer import Entry, Gazetteer, Pinned, gazetteer, pin_key
from ancestree.repo.places import read_places
from ancestree.seed.generated import generated_family
from ancestree.services.context import Context, RuleError, read
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

    def __init__(self, places: Gazetteer, pins: Mapping[str, Pinned]) -> None:
        self.places = places
        self.pins = pins
        self.found: dict[Place, Located] = {}

    def __call__(self, place: Place | None) -> Located | None:
        if place is None or place.is_empty:
            return None
        if place not in self.found:
            spot = self.places.locate(place, self.pins)
            self.found[place] = (
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


async def family_map(ctx: Context, hidden: Collection[str] = ()) -> FamilyMap:
    """Everyone but unknown parents, with where they live and were born, the pins, and the
    towns around the family's places. The `hidden` people's places stay off it, and no town is
    named for them: a copy hiding living people's details."""
    rows = await read(ctx, read_places)
    pins = await asyncio.to_thread(read_pins, ctx.data_dir)
    places = await asyncio.to_thread(gazetteer)
    shown = [row for row in rows if row.id not in hidden]
    # The family's countries' places, read in one go and off the event loop.
    written = {place.country for row in shown for place in (row.lives, row.born) if place}
    await asyncio.to_thread(places.load, [places.country_code(country) for country in written])
    find = _Finder(places, _pinned(pins))
    people = [
        MapPerson(id=UUID(row.id))
        if row.id in hidden
        else MapPerson(id=UUID(row.id), lives=find(row.lives), born=find(row.born))
        for row in rows
    ]
    towns = await asyncio.to_thread(towns_around, places, people)
    return FamilyMap(
        people=sorted(people, key=lambda person: str(person.id)), pins=pins.pins, towns=towns
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
