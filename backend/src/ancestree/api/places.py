"""The map: where everyone lives and was born, and the places put
on the map by hand."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status

from ancestree.api.deps import Ctx, Hist
from ancestree.config import Settings
from ancestree.domain.map import (
    FamilyMap,
    LookupAsked,
    MapPins,
    Pin,
    PlaceSuggestion,
    PlaceSuggestions,
)
from ancestree.domain.person import Place
from ancestree.maps.packs import PackStore
from ancestree.maps.photon import PhotonError
from ancestree.services import places as places_service
from ancestree.services.context import RuleError

router = APIRouter(tags=["map"])


@router.get("/map")
async def get_map(ctx: Ctx) -> FamilyMap:
    """Everyone but unknown parents, with where they live and were born, each found on the
    map: by your pin for the place, its town, its state's middle, or its country."""
    return await places_service.family_map(ctx)


@router.get("/places/suggest")
async def suggest_place(
    line: Annotated[str, Query(max_length=300)], country: Annotated[str, Query(max_length=100)]
) -> PlaceSuggestions:
    """What an address line, as it's typed, may be, in a country: its postcodes and
    towns, from the country's places, each with its district, state and where it is; and
    whether those places are on this computer, so their download can be offered."""
    return await asyncio.to_thread(places_service.suggest, line, country)


@router.get("/places/near")
async def place_near(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    country: Annotated[str, Query(max_length=100)],
) -> PlaceSuggestion | None:
    """What's nearest a point put on the map before its address: the town within 30 km,
    with its district and state, and the nearest postcode, to fill the address in. None where
    nothing is that near, or the country isn't known."""
    return await asyncio.to_thread(places_service.near, lat, lon, country)


@router.post(
    "/places/lookup",
    responses={502: {"description": "Photon couldn't be reached, or answered otherwise"}},
)
async def look_up_place(asked: LookupAsked, request: Request) -> PlaceSuggestions:
    """Look one address up online, once: the engine asks Photon (komoot), sending the
    line as typed, with its country, so the pages reach nothing outside this computer. Refused
    where this computer looks nothing up online. What it finds is to check, never an answer."""
    store: PackStore = request.app.state.map_packs
    if store.lookup == "never":
        raise RuleError("lookup_off", "Looking addresses up online is off on this computer.")
    settings: Settings = request.app.state.settings
    try:
        return await asyncio.to_thread(
            places_service.look_up, settings.photon_url, asked.line, asked.country
        )
    except PhotonError as error:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, {"code": "photon", "message": str(error)}
        ) from error


@router.get("/sample/map")
async def get_sample_map(people: Annotated[int, Query(ge=10, le=5000)] = 2000) -> FamilyMap:
    """The made-up family on the map, spread over real towns. Nothing is stored."""
    return await asyncio.to_thread(places_service.sample_map, people)


@router.put("/places/pins")
async def put_pin(ctx: Ctx, history: Hist, pin: Pin) -> MapPins:
    """Put a place the gazetteer doesn't know on the map, or move its pin. One Undo step."""
    async with history.pins_change(ctx) as step:
        pins = await places_service.put_pin(ctx, pin)
        step.label = f"Put {pin.town or pin.state} on the map"
    return pins


@router.delete("/places/pins")
async def remove_pin(
    ctx: Ctx,
    history: Hist,
    town: str | None = None,
    state: str | None = None,
    country: str = "Malaysia",
) -> MapPins:
    """Take a place's pin off the map. One Undo step."""
    place = Place(town=town, state=state, country=country)
    async with history.pins_change(ctx) as step:
        pins = await places_service.remove_pin(ctx, place)
        step.label = f"Take {place.town or place.state} off the map"
    return pins
