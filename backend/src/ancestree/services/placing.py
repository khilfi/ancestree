"""People pinned where they live, by themselves.

- A place with an address or a postcode and no location of its own is given one, with no
  internet: at its postcode's area where its postcode is known, else at its town.
- People at one address share one location, the most exact of theirs; moving its pin moves it
  for all of them.
- When a country's places come, the addresses there at their town or their postcode's area are
  placed again, more exactly where they now can be, as one Undo step.

Nothing put on the map by hand is ever moved by any of it."""

import asyncio
from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, Any

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.person import EXACTER, Exactness, Place
from ancestree.domain.requests import PersonInput, PersonPatch
from ancestree.places.gazetteer import Gazetteer, gazetteer
from ancestree.places.names import country_named, place_key
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import place_from
from ancestree.repo.places import read_addresses, read_places
from ancestree.services.context import Context, read, write
from ancestree.services.snapshots import refresh_snapshots

if TYPE_CHECKING:  # the history service uses the people service, which uses this
    from ancestree.services.history import History

# The places a person has, by the form's name, with the prefix their properties are kept under.
PLACES = {"birth_place": "birth", "death_place": "death", "residence": "residence"}
# How exact a location may be and still be placed again: the town's, the postcode's area.
AGAIN: frozenset[Exactness | None] = frozenset({"town", "postcode"})


def finding(place: Place, places: Gazetteer) -> tuple[float, float, Exactness] | None:
    """Where a place's address puts it with no internet, as exactly as is known: its postcode's
    area, where its postcode is known; else its town. None where neither is."""
    code = places.country_code(place.country)
    if code is None:
        return None
    if place.postcode:
        entry = places.postcode_at(code, place.postcode, place.town, place.state)
        if entry is not None:
            return round(entry.lat, 6), round(entry.lon, 6), "postcode"
    if place.town:
        town = Place(town=place.town, state=place.state, country=place.country)
        spot = places.locate(town, {})
        if spot is not None and spot.found == "town":
            return round(spot.lat, 6), round(spot.lon, 6), "town"
    return None


def located(place: Place | None, places: Gazetteer | None = None) -> Place | None:
    """A place with an address or a postcode but no location of its own, given one; any other
    as it is. Reads the gazetteer, so off the event loop."""
    if place is None or place.lat is not None or not (place.address or place.postcode):
        return place
    found = finding(place, places or gazetteer())
    if found is None:
        return place
    lat, lon, exact = found
    return place.model_copy(update={"lat": lat, "lon": lon, "exact": exact})


def placed[Data: (PersonInput, PersonPatch)](data: Data) -> Data:
    """The person form's places, or a quick fix's, each given its location where it has an
    address and none."""
    places = gazetteer()
    update = {
        name: located(getattr(data, name), places)
        for name in PLACES
        if getattr(data, name, None) is not None
    }
    return data.model_copy(update=update)


def household_key(place: Place | None) -> str | None:
    """Which household a place where someone lives is: its address line, town and country,
    capitals, spaces and punctuation aside. None without an address line: people with only a
    town are together at the town already."""
    if place is None or not place.address:
        return None
    country = country_named(place.country) or place.country
    return "|".join(place_key(part or "") for part in (place.address, place.town, country))


async def household(ctx: Context, place: Place | None, but: str | None = None) -> list[str]:
    """Everyone else who lives at this address, by id: those who share its location."""
    key = household_key(place)
    if key is None:
        return []
    rows = await read(ctx, read_places)
    return [row.id for row in rows if row.id != but and household_key(row.lives) == key]


def _rank(place: Place) -> int:
    return EXACTER[place.exact or "hand"]  # a location given with no "how" is the person's own


def shared(place: Place, others: Iterable[Place | None]) -> Place:
    """Where a household is: the most exact of its locations, this one's where it's as exact as
    any other, so a pin just moved moves them all."""
    best = place
    for other in others:
        if other is None or other.lat is None:
            continue
        if best.lat is None or _rank(other) > _rank(best):
            best = other
    if best is place:
        return place
    return place.model_copy(update={"lat": best.lat, "lon": best.lon, "exact": best.exact})


async def share_location(tx: Tx, place: Place, mates: Sequence[str]) -> Place:
    """Within the change of where someone lives: the household's location, given to everyone
    at the address whose location isn't it. Where they live, with it."""
    found = await people_repo.fetch_people(tx, list(mates))
    theirs = {pid: place_from("residence", props) for pid, props in found.items()}
    home = shared(place, theirs.values())
    if home.lat is None:
        return home
    where = {"residence_lat": home.lat, "residence_lon": home.lon, "residence_exact": home.exact}
    for pid, their in theirs.items():
        if their is not None and (their.lat, their.lon, their.exact) != (
            home.lat,
            home.lon,
            home.exact,
        ):
            await people_repo.update_person(tx, pid, where)
    return home


def _better(
    rows: Sequence[tuple[str, dict[str, Place]]], code: str | None
) -> dict[str, dict[str, tuple[Place, dict[str, Any]]]]:
    """Each place in the country (every country, for None) that can now be placed more exactly,
    by person and prefix: the place as it was read, and its location's properties."""
    places = gazetteer()
    changes: dict[str, dict[str, tuple[Place, dict[str, Any]]]] = {}
    for pid, owned in rows:
        for prefix, place in owned.items():
            if place.lat is not None and place.exact not in AGAIN:
                continue  # by hand, or to the house or street
            if code is not None and places.country_code(place.country) != code:
                continue
            found = finding(place, places)
            if found is None:
                continue
            lat, lon, exact = found
            if place.lat is not None and EXACTER[exact] <= EXACTER[place.exact or "town"]:
                continue
            where = {f"{prefix}_lat": lat, f"{prefix}_lon": lon, f"{prefix}_exact": exact}
            changes.setdefault(pid, {})[prefix] = (place, where)
    return changes


async def place_more_exactly(ctx: Context, history: History, country: str) -> int:
    """When a country's places come, by its key ("my"), or the world's ("world"): every address
    there at its town or its postcode's area, or not placed yet, placed again where it now can
    be more exactly. Nothing placed by hand, or to the house or street, moves. One Undo step,
    "34 addresses in Malaysia placed more exactly"; how many."""
    rows = await read(ctx, read_addresses)
    code = None if country == "world" else country.upper()
    changes = await asyncio.to_thread(_better, rows, code)
    if not changes:
        return 0

    async def work(tx: Tx) -> int:
        now = await people_repo.fetch_people(tx, list(changes))
        moved = 0
        for pid, owned in changes.items():
            for prefix, (was, where) in owned.items():
                # Changed meanwhile, as by hand: it stays as it is now.
                if pid in now and place_from(prefix, now[pid]) == was:
                    await people_repo.update_person(tx, pid, where)
                    moved += 1
        return moved

    known = gazetteer().countries
    in_country = f" in {known[code].name}" if code is not None and code in known else ""
    async with history.change(ctx, list(changes)) as change:
        moved = await write(ctx, work)
        many = "1 address" if moved == 1 else f"{moved} addresses"
        change.label = f"{many}{in_country} placed more exactly"
    await refresh_snapshots(ctx, list(changes))
    return moved
