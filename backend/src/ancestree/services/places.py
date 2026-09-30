"""The map: where everyone lives and was born, found in the
gazetteer that comes with the app, and the places put on the map by hand. Nothing is looked
up online."""

import asyncio
import random
from collections.abc import Iterable, Mapping
from uuid import UUID

from ancestree.domain.map import FamilyMap, Located, MapPerson, MapPins, Pin
from ancestree.domain.person import Place
from ancestree.places.gazetteer import Gazetteer, Pinned, gazetteer, pin_key
from ancestree.places.names import COUNTRIES, STATES
from ancestree.repo.places import read_places
from ancestree.seed.generated import generated_family
from ancestree.services.context import Context, RuleError, read
from ancestree.storage.settings import read_pins, write_pins


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
                )
            )
        return self.found[place]


def rough_places() -> dict[str, Located]:
    """The middle of each of Malaysia's states and of the usual countries, under every name the
    app takes for them ("state:penang", "country:singapura"): for a copy to edit, which has no
    gazetteer, to place a place typed in it roughly until the app finds its town."""
    places = gazetteer()
    found: dict[str, Located] = {}

    def keep(keys: Iterable[str], place: Place) -> None:
        spot = places.locate(place, {})
        if spot is None:
            return
        located = Located(
            place=place,
            lat=spot.lat,
            lon=spot.lon,
            found=spot.found,
            name=spot.name,
            state=spot.state,
            country=spot.country,
        )
        for key in keys:
            found[key] = located

    for state, aliases in STATES.items():
        keep((f"state:{name.casefold()}" for name in (state, *aliases)), Place(state=state))
    for country in sorted(set(COUNTRIES.values())):
        names = [alias for alias, named in COUNTRIES.items() if named == country]
        keep((f"country:{name}" for name in {country.casefold(), *names}), Place(country=country))
    return found


async def family_map(ctx: Context) -> FamilyMap:
    """Everyone but unknown parents, with where they live and were born, and the pins."""
    rows = await read(ctx, read_places)
    pins = await asyncio.to_thread(read_pins, ctx.data_dir)
    find = _Finder(await asyncio.to_thread(gazetteer), _pinned(pins))
    people = [
        MapPerson(id=UUID(row.id), lives=find(row.lives), born=find(row.born)) for row in rows
    ]
    return FamilyMap(people=sorted(people, key=lambda person: str(person.id)), pins=pins.pins)


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
    return FamilyMap(people=people, pins=[])
