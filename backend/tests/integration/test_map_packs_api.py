"""The map's packs over HTTP: how each stands on this
computer, fetching and removing one, or a whole country's, and their tiles, those cut to one
depth served to the window as one source, gzipped as cut; and the online extra. The
downloads and OpenFreeMap are made up: nothing here reaches the internet."""

import asyncio
import dataclasses
import gzip
import hashlib
import io
import json
import urllib.error
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest

from ancestree.config import Settings
from ancestree.desktop.guard import PageHeaders
from ancestree.main import create_app
from ancestree.maps.online import INDEX, SERVER
from ancestree.maps.packs import BUILD, CHOSEN, COUNTRIES, PACKS, PLACE_FILES, Pack, PlaceFile
from tests.fake_packs import write_pack

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

TILES = {(0, 0, 0): b"the world", (5, 25, 15): b"Malaysia"}


async def packs_now(client: httpx.AsyncClient) -> dict[str, dict[str, Any]]:
    answer = await client.get("/api/map/packs")
    assert answer.status_code == 200, answer.text
    assert answer.json()["build"] == BUILD
    return {pack["key"]: pack for pack in answer.json()["packs"]}


async def test_each_pack_says_how_it_stands_on_this_computer(client: httpx.AsyncClient) -> None:
    packs = await packs_now(client)
    assert list(packs) == list(PACKS)
    assert next(iter(packs)) == "world"
    world = packs["world"]
    assert (world["title"], world["first"], world["minzoom"], world["maxzoom"]) == (
        "The world",
        True,
        0,
        6,
    )
    assert world["size"] == PACKS["world"].size
    assert not any(pack["installed"] or pack["fetching"] for pack in packs.values())
    assert (packs["us-ca"]["title"], packs["us-ca"]["country"]) == ("California", "us")
    countries = {c["key"]: c for c in (await client.get("/api/map/packs")).json()["countries"]}
    assert countries["my"] == {
        "key": "my",
        "title": "Malaysia",
        "continent": "Asia",
        "packs": ["my"],
    }
    assert len(countries["us"]["packs"]) == len(COUNTRIES["us"].packs) > 50


async def test_a_packs_tiles_are_served_as_cut(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    (settings.data_dir / "maps").mkdir(parents=True, exist_ok=True)
    write_pack(settings.data_dir / "maps" / f"world-{BUILD}.pmtiles", TILES)

    tile = await client.get("/api/map/depth/6/5/25/15")

    assert tile.status_code == 200
    assert tile.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert tile.headers["content-encoding"] == "gzip"  # the window unpacks it
    assert tile.content == b"Malaysia"  # httpx, as the window, unpacks it
    # Where no pack of that depth has it, nothing; and nothing else at all.
    assert (await client.get("/api/map/depth/6/5/0/0")).status_code == 204
    assert (await client.get("/api/map/depth/6/9/400/250")).status_code == 204
    assert (await client.get("/api/map/depth/6/2/4/0")).status_code == 204
    assert (await client.get("/api/map/depth/14/5/25/15")).status_code == 204  # not the world's
    assert (await client.get("/api/map/depth/14/10/800/500")).status_code == 204  # none here
    for wrong in ("/api/map/depth/narnia/1/0/0", "/api/map/depth/6/16/0/0"):
        assert (await client.get(wrong)).status_code == 422, wrong
    assert (await packs_now(client))["world"]["installed"]


async def test_a_pack_is_fetched_checked_and_removed(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The world pack, made up and pinned for the test: fetched in the background, as the
    map's first opening asks, then removed."""
    write_pack(settings.data_dir / "pack.tmp", TILES)
    content = (settings.data_dir / "pack.tmp").read_bytes()
    pinned = Pack(
        key="world",
        title="The world",
        minzoom=0,
        maxzoom=6,
        region=None,
        first=True,
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )
    monkeypatch.setitem(PACKS, "world", pinned)

    def release(request: Any, timeout: float) -> Any:
        assert request.full_url == pinned.url
        answer = io.BytesIO(content)
        answer.status = 200  # type: ignore[attr-defined]
        return answer

    monkeypatch.setattr("urllib.request.urlopen", release)

    started = await client.post("/api/map/packs/world")
    assert started.status_code == 202
    for _ in range(100):
        world = (await packs_now(client))["world"]
        if not world["fetching"]:
            break
        await asyncio.sleep(0.05)
    assert world["installed"], world
    assert world["error"] is None
    assert (settings.data_dir / "maps" / pinned.name).read_bytes() == content
    tile = await client.get("/api/map/depth/6/0/0/0")
    assert tile.content == b"the world"

    removed = await client.delete("/api/map/packs/world")
    assert removed.status_code == 200
    assert not {pack["key"]: pack for pack in removed.json()["packs"]}["world"]["installed"]
    assert not (settings.data_dir / "maps" / pinned.name).exists()
    assert (await client.get("/api/map/depth/6/0/0/0")).status_code == 204


async def test_a_pack_that_doesnt_match_is_refused_and_says_so(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The plan's check for the packs: one that isn't the one pinned is never kept, and never
    served."""
    monkeypatch.setitem(
        PACKS,
        "world",
        Pack("world", "The world", 0, 6, None, True, size=9, sha256="0" * 64),
    )

    def release(request: Any, timeout: float) -> Any:
        answer = io.BytesIO(b"not a map")
        answer.status = 200  # type: ignore[attr-defined]
        return answer

    monkeypatch.setattr("urllib.request.urlopen", release)

    await client.post("/api/map/packs/world")
    for _ in range(100):
        world = (await packs_now(client))["world"]
        if not world["fetching"]:
            break
        await asyncio.sleep(0.05)
    assert not world["installed"]
    assert world["error"] == "The world didn't match its fingerprint, so it wasn't kept"
    assert list((settings.data_dir / "maps").iterdir()) == []
    assert (await client.get("/api/map/depth/6/0/0/0")).status_code == 204


# The online extra, with OpenFreeMap made up.
KUALA_LUMPUR = (10, 801, 503)  # a tile Malaysia's pack has
BANGKOK = (10, 797, 472)  # one beyond the packs


class OpenFreeMap:
    """OpenFreeMap as the engine meets it, and what was asked of it."""

    def __init__(self) -> None:
        self.asked: list[str] = []
        self.reachable = True

    def urlopen(self, request: Any, timeout: float) -> Any:
        self.asked.append(request.full_url)
        if not self.reachable:
            raise urllib.error.URLError("no internet")
        if request.full_url == INDEX:
            index = {"tiles": [f"{SERVER}planet/20261004_113936_pt/{{z}}/{{x}}/{{y}}.pbf"]}
            answer = io.BytesIO(json.dumps(index).encode())
            answer.headers = {}  # type: ignore[attr-defined]
        else:
            answer = io.BytesIO(gzip.compress(b"Bangkok"))
            answer.headers = {"Content-Encoding": "gzip"}  # type: ignore[attr-defined]
        return answer


@asynccontextmanager
async def engine(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    """The app as the desktop engine runs it, with its pages' policy."""
    app = create_app(settings)
    app.add_middleware(PageHeaders)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


def tile_of(where: tuple[int, int, int]) -> str:
    return "/api/map/online/" + "/".join(map(str, where))


async def online_now(client: httpx.AsyncClient) -> bool:
    answer = await client.get("/api/map/packs")
    assert answer.status_code == 200, answer.text
    return bool(answer.json()["online"])


async def test_the_online_extra_asks_openfreemap_only_for_tiles_no_pack_here_has(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Off, the engine asks OpenFreeMap nothing. On, it fetches a tile only where no pack here has
    one, and the window's pages still may reach nothing outside this computer: the engine asks
    for them. The choice is kept as the app starts again."""
    openfreemap = OpenFreeMap()
    monkeypatch.setattr("urllib.request.urlopen", openfreemap.urlopen)
    settings.maps.mkdir(parents=True, exist_ok=True)
    write_pack(settings.maps / f"my-{BUILD}.pmtiles", {KUALA_LUMPUR: b"Kuala Lumpur"})

    async with engine(settings) as client:
        assert await online_now(client) is False
        off = await client.get(tile_of(BANGKOK))
        assert off.status_code == 404
        assert off.json()["detail"]["message"] == "The map's online extra is off"

        turned_on = await client.put("/api/map/online", json={"on": True})
        assert turned_on.status_code == 200, turned_on.text
        assert turned_on.json()["online"] is True
        assert (await client.put("/api/map/online", json={"on": "maybe"})).status_code == 422
        for where in (KUALA_LUMPUR, (6, 50, 30), (10, 2000, 0)):
            assert (await client.get(tile_of(where))).status_code == 204, where
        assert openfreemap.asked == []  # Malaysia's pack has it; the world's below zoom 7

        beyond = await client.get(tile_of(BANGKOK))
        assert beyond.status_code == 200
        assert beyond.headers["content-type"] == "application/vnd.mapbox-vector-tile"
        assert beyond.headers["content-encoding"] == "gzip"
        assert beyond.content == b"Bangkok"  # httpx, as the window, unpacks it
        assert openfreemap.asked == [INDEX, f"{SERVER}planet/20261004_113936_pt/10/797/472.pbf"]
        policy = beyond.headers["content-security-policy"]
        assert "connect-src 'self';" in policy
        assert "https:" not in policy
        assert (await client.get("/api/map/online/15/0/0")).status_code == 422

    async with engine(settings) as client:  # the app started again: still on
        assert await online_now(client) is True
        assert (await client.put("/api/map/online", json={"on": False})).json()["online"] is False
        asked = len(openfreemap.asked)
        assert (await client.get(tile_of(BANGKOK))).status_code == 404
        assert len(openfreemap.asked) == asked
    chosen = json.loads((settings.maps / CHOSEN).read_text(encoding="utf-8"))
    assert chosen == {"online": False, "lookup": "ask"}  # and the address lookup's


async def test_without_openfreemap_the_window_is_told_so(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The map then carries on from the packs alone."""
    openfreemap = OpenFreeMap()
    openfreemap.reachable = False
    monkeypatch.setattr("urllib.request.urlopen", openfreemap.urlopen)
    async with engine(settings) as client:
        await client.put("/api/map/online", json={"on": True})
        failed = await client.get(tile_of(BANGKOK))
    assert failed.status_code == 502
    assert failed.json()["detail"] == {
        "code": "openfreemap",
        "message": "OpenFreeMap couldn't be reached: no internet, or the connection broke",
    }


async def test_a_whole_country_is_fetched_and_removed(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Germany's one Download, its pack and places made up and pinned for the test; then
    Remove, which takes both. A country or pack that isn't on the list is not found, and one not
    cut yet says so."""
    write_pack(settings.data_dir / "pack.tmp", {(10, 550, 335): b"Berlin"}, (5.8, 47.2, 15.1, 55.1))
    content = (settings.data_dir / "pack.tmp").read_bytes()
    germany = PACKS["de"]
    pinned = Pack(
        key="de",
        title=germany.title,
        minzoom=7,
        maxzoom=13,
        region="de.geojson",
        first=False,
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        country="de",
    )
    monkeypatch.setitem(PACKS, "de", pinned)
    lines = b"DE\tBerlin\t\tP\tBerlin\t52.5244\t13.4105\t3426354\t\n"
    places = PlaceFile("de", "Germany's places", 100, hashlib.sha256(lines).hexdigest())
    monkeypatch.setitem(PLACE_FILES, "de", places)
    served = {pinned.url: content, places.url: gzip.compress(lines)}

    def release(request: Any, timeout: float) -> Any:
        answer = io.BytesIO(served[request.full_url])
        answer.status = 200  # type: ignore[attr-defined]
        return answer

    monkeypatch.setattr("urllib.request.urlopen", release)

    assert (await client.post("/api/map/countries/de")).status_code == 202
    for _ in range(100):
        answer = (await client.get("/api/map/packs")).json()
        packs = {pack["key"]: pack for pack in answer["packs"]}
        [de] = [each for each in answer["places"] if each["country"] == "de"]
        if not packs["de"]["fetching"] and not de["fetching"]:
            break
        await asyncio.sleep(0.05)
    assert packs["de"]["installed"], packs["de"]
    assert de["installed"], de
    berlin = await client.get("/api/map/depth/13/10/550/335")
    assert berlin.content == b"Berlin"
    assert (await client.get("/api/map/depth/14/10/550/335")).status_code == 204

    removed = await client.delete("/api/map/countries/de")
    assert removed.status_code == 200
    assert not {pack["key"]: pack for pack in removed.json()["packs"]}["de"]["installed"]
    [de] = [each for each in removed.json()["places"] if each["country"] == "de"]
    assert not de["installed"]
    assert (await client.get("/api/map/depth/13/10/550/335")).status_code == 204

    for wrong in ("/api/map/countries/narnia", "/api/map/packs/narnia"):
        assert (await client.post(wrong)).status_code == 404, wrong
    assert (await client.post("/api/map/countries/Not-A-Key!")).status_code == 422
    # Listed, but not cut yet, as every pack is between a newer build's listing and its pins.
    monkeypatch.setitem(PACKS, "fr", dataclasses.replace(PACKS["fr"], sha256=""))
    await client.post("/api/map/packs/fr")
    for _ in range(100):
        france = (await packs_now(client))["fr"]
        if not france["fetching"]:
            break
        await asyncio.sleep(0.05)
    assert france["error"] == "France isn't out yet, so it can't be fetched"
