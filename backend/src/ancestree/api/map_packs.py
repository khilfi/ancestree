"""The map's packs: how each stands on this computer,
fetching or removing one, or a whole country's, and their tiles, served to the window so the
map asks nothing of the internet: all the packs cut to one depth as one source. And the online
extra, off unless chosen: OpenFreeMap's tiles, where the packs end."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Request, Response, status
from fastapi import Path as InPath
from fastapi.responses import JSONResponse

from ancestree.api.deps import Ctx
from ancestree.domain.map import (
    FamilyCountries,
    MapCountry,
    MapPack,
    MapPacks,
    MapPlaces,
    OnlineLookup,
    OnlineMap,
    PackKey,
)
from ancestree.maps.online import DEEPEST, FROM_ZOOM, OnlineError
from ancestree.maps.packs import (
    BUILD,
    COUNTRIES,
    PACKS,
    PLACE_FILES,
    Country,
    Pack,
    PackError,
    PackStore,
    PlaceFile,
)
from ancestree.services import places as places_service
from ancestree.services.context import NotFoundError, RuleError

router = APIRouter(tags=["map"])

VECTOR_TILE = "application/vnd.mapbox-vector-tile"


def _store(request: Request) -> PackStore:
    store: PackStore = request.app.state.map_packs
    return store


def _pack(key: str) -> Pack:
    if key not in PACKS:
        raise NotFoundError("There's no such pack of the map")
    return PACKS[key]


def _country(key: str) -> Country:
    if key not in COUNTRIES:
        raise NotFoundError("There's no such country on the map's list")
    return COUNTRIES[key]


def _packs(store: PackStore) -> MapPacks:
    def one(pack: Pack) -> MapPack:
        state = store.fetching.get(pack.key)
        running = state is not None and state.running
        return MapPack(
            key=pack.key,
            title=pack.title,
            country=pack.country,
            size=pack.size,
            minzoom=pack.minzoom,
            maxzoom=pack.maxzoom,
            first=pack.first,
            installed=store.installed(pack),
            fetching=running,
            done=state.done if state is not None and running else 0,
            error=state.error if state is not None and not running else None,
        )

    def places(file: PlaceFile) -> MapPlaces:
        state = store.fetching.get(file.key)
        running = state is not None and state.running
        return MapPlaces(
            country=file.country,
            size=file.size,
            installed=store.installed(file),
            fetching=running,
            done=state.done if state is not None and running else 0,
            error=state.error if state is not None and not running else None,
        )

    packs = [one(pack) for pack in PACKS.values()]
    countries = [
        MapCountry(
            key=country.key,
            title=country.title,
            continent=country.continent,
            packs=list(country.packs),
        )
        for country in COUNTRIES.values()
    ]
    return MapPacks(
        build=BUILD,
        packs=packs,
        countries=countries,
        places=[places(file) for file in PLACE_FILES.values()],
        online=store.online,
        lookup=store.lookup,
        placed=dict(store.placed),
    )


@router.get("/map/packs")
async def get_map_packs(request: Request) -> MapPacks:
    """Each of the map's packs, and how it stands on this computer; the countries; and the
    places that come with them."""
    return _packs(_store(request))


@router.get("/map/countries/family")
async def get_family_countries(ctx: Ctx) -> FamilyCountries:
    """The countries anyone in the family lives or was born in: Settings → Map lists them
    first."""
    return await places_service.family_countries(ctx)


@router.put("/map/online")
async def choose_online_map(chosen: OnlineMap, request: Request) -> MapPacks:
    """Turn the map's online extra on or off: OpenFreeMap's tiles, where the packs end."""
    store = _store(request)
    await asyncio.to_thread(store.choose_online, chosen.on)
    return _packs(store)


@router.put("/map/lookup")
async def choose_lookup(chosen: OnlineLookup, request: Request) -> MapPacks:
    """Whether an address may be looked up online on this computer: asked each time,
    without asking, or never."""
    store = _store(request)
    await asyncio.to_thread(store.choose_lookup, chosen.lookup)
    return _packs(store)


@router.get(
    "/map/online/{z}/{x}/{y}",
    response_class=Response,
    responses={
        200: {"content": {VECTOR_TILE: {}}},
        204: {"description": "A pack here has the tile, or OpenFreeMap has nothing there"},
        502: {"description": "OpenFreeMap couldn't be reached"},
    },
)
async def get_online_tile(
    z: Annotated[int, InPath(ge=0, le=DEEPEST)],
    x: Annotated[int, InPath(ge=0)],
    y: Annotated[int, InPath(ge=0)],
    request: Request,
) -> Response:
    """A tile of OpenFreeMap's, for the map's online extra, fetched by the engine so the
    window still reaches nothing outside this computer. Asked only where no pack here has the
    tile: no content where one has, or below zoom 7, where the world's pack has them all. Not
    found while the extra is off."""
    store = _store(request)
    if not store.online:
        raise NotFoundError("The map's online extra is off")
    if z < FROM_ZOOM or x >= 2**z or y >= 2**z or store.covered(z, x, y):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    try:
        found = await asyncio.to_thread(store.openfreemap.tile, z, x, y)
    except OnlineError as error:
        return JSONResponse(
            {"detail": {"code": "openfreemap", "message": str(error)}},
            status_code=status.HTTP_502_BAD_GATEWAY,
        )
    if found is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    data, gzipped = found
    headers = {"Cache-Control": "private, max-age=86400"}  # OpenFreeMap's tiles change weekly
    if gzipped:
        headers["Content-Encoding"] = "gzip"
    return Response(content=data, media_type=VECTOR_TILE, headers=headers)


@router.post("/map/packs/{key}", status_code=status.HTTP_202_ACCEPTED)
async def fetch_map_pack(key: PackKey, request: Request) -> MapPacks:
    """Fetch a pack in the background, unless it's here or on its way: the answer says how
    it stands, and asking again says how it's going."""
    store = _store(request)
    store.start(_pack(key))
    return _packs(store)


@router.delete("/map/packs/{key}")
async def remove_map_pack(key: PackKey, request: Request) -> MapPacks:
    """Take a pack off this computer, stopping it first if it's on its way."""
    store = _store(request)
    try:
        await asyncio.to_thread(store.remove, _pack(key))
    except PackError as error:
        raise RuleError("pack_stopping", str(error)) from error
    return _packs(store)


@router.post("/map/countries/{key}", status_code=status.HTTP_202_ACCEPTED)
async def fetch_map_country(key: PackKey, request: Request) -> MapPacks:
    """Fetch every pack of a country, its own or each of its states', but those here
    already or on their way."""
    store = _store(request)
    store.start_country(_country(key))
    return _packs(store)


@router.delete("/map/countries/{key}")
async def remove_map_country(key: PackKey, request: Request) -> MapPacks:
    """Take every pack of a country off this computer, stopping any on its way."""
    store = _store(request)
    try:
        await asyncio.to_thread(store.remove_country, _country(key))
    except PackError as error:
        raise RuleError("pack_stopping", str(error)) from error
    return _packs(store)


@router.get(
    "/map/depth/{depth}/{z}/{x}/{y}",
    response_class=Response,
    responses={200: {"content": {VECTOR_TILE: {}}}, 204: {"description": "No tile there"}},
)
async def get_map_tile(
    depth: Annotated[int, InPath(ge=0, le=15)],
    z: Annotated[int, InPath(ge=0, le=15)],
    x: Annotated[int, InPath(ge=0)],
    y: Annotated[int, InPath(ge=0)],
    request: Request,
) -> Response:
    """A tile from whichever pack on this computer cut to `depth` has it: the world's to
    6, or the countries' and states', to 13 or 14. As Protomaps cut it from OpenStreetMap:
    vector data, gzipped. No content where no pack here has it."""
    if x >= 2**z or y >= 2**z:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    found = _store(request).tile(z, x, y, depth)
    if found is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    data, gzipped = found
    headers = {"Cache-Control": "private, max-age=604800"}  # a pack's tiles never change
    if gzipped:
        headers["Content-Encoding"] = "gzip"
    return Response(content=data, media_type=VECTOR_TILE, headers=headers)
