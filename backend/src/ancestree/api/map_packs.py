"""The map's packs: how each stands on this computer, fetching or
removing one, and their tiles, served to the window so the map asks nothing of the internet.
And the online extra, off unless chosen: OpenFreeMap's tiles, where the packs end."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Request, Response, status
from fastapi import Path as InPath
from fastapi.responses import JSONResponse

from ancestree.domain.map import MapPack, MapPacks, OnlineMap, PackKey
from ancestree.maps.online import DEEPEST, FROM_ZOOM, OnlineError
from ancestree.maps.packs import BUILD, PACKS, Pack, PackError, PackStore
from ancestree.services.context import NotFoundError, RuleError

router = APIRouter(tags=["map"])

VECTOR_TILE = "application/vnd.mapbox-vector-tile"


def _store(request: Request) -> PackStore:
    store: PackStore = request.app.state.map_packs
    return store


def _packs(store: PackStore) -> MapPacks:
    def one(pack: Pack) -> MapPack:
        state = store.fetching.get(pack.key)
        running = state is not None and state.running
        return MapPack(
            key=pack.key,
            title=pack.title,
            size=pack.size,
            minzoom=pack.minzoom,
            maxzoom=pack.maxzoom,
            first=pack.first,
            installed=store.installed(pack),
            fetching=running,
            done=state.done if state is not None and running else 0,
            error=state.error if state is not None and not running else None,
        )

    packs = [one(pack) for pack in PACKS.values()]
    return MapPacks(build=BUILD, packs=packs, online=store.online)


@router.get("/map/packs")
async def get_map_packs(request: Request) -> MapPacks:
    """Each of the map's packs, and how it stands on this computer."""
    return _packs(_store(request))


@router.put("/map/online")
async def choose_online_map(chosen: OnlineMap, request: Request) -> MapPacks:
    """Turn the map's online extra on or off: OpenFreeMap's tiles, where the packs end."""
    store = _store(request)
    await asyncio.to_thread(store.choose_online, chosen.on)
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
    store.start(PACKS[key])
    return _packs(store)


@router.delete("/map/packs/{key}")
async def remove_map_pack(key: PackKey, request: Request) -> MapPacks:
    """Take a pack off this computer, stopping it first if it's on its way."""
    store = _store(request)
    try:
        await asyncio.to_thread(store.remove, PACKS[key])
    except PackError as error:
        raise RuleError("pack_stopping", str(error)) from error
    return _packs(store)


@router.get(
    "/map/tiles/{key}/{z}/{x}/{y}",
    response_class=Response,
    responses={200: {"content": {VECTOR_TILE: {}}}, 204: {"description": "No tile there"}},
)
async def get_map_tile(
    key: PackKey,
    z: Annotated[int, InPath(ge=0, le=15)],
    x: Annotated[int, InPath(ge=0)],
    y: Annotated[int, InPath(ge=0)],
    request: Request,
) -> Response:
    """A tile of a pack, as Protomaps cut it from OpenStreetMap: vector data, gzipped. No
    content where the pack has none."""
    pack = PACKS[key]
    reader = _store(request).reader(pack)
    if reader is None:
        raise NotFoundError(f"{pack.title} isn't on this computer")
    if not (pack.minzoom <= z <= pack.maxzoom and x < 2**z and y < 2**z):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    data = reader.tile(z, x, y)
    if data is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    headers = {"Cache-Control": "private, max-age=604800"}  # a pack's tiles never change
    if reader.gzipped:
        headers["Content-Encoding"] = "gzip"
    return Response(content=data, media_type=VECTOR_TILE, headers=headers)
