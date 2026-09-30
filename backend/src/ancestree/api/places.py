"""The map: where everyone lives and was born, and the places put
on the map by hand."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Query

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.map import FamilyMap, MapPins, Pin
from ancestree.domain.person import Place
from ancestree.services import places as places_service

router = APIRouter(tags=["map"])


@router.get("/map")
async def get_map(ctx: Ctx) -> FamilyMap:
    """Everyone but unknown parents, with where they live and were born, each found on the
    map: by your pin for the place, its town, its state's middle, or its country."""
    return await places_service.family_map(ctx)


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
