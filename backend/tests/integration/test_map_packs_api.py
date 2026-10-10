"""The map's packs over HTTP: how each stands on this computer,
fetching and removing one, and their tiles, served to the window gzipped as cut; and the online
extra. The downloads and OpenFreeMap are made up: nothing here reaches the internet."""

import asyncio
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
from ancestree.maps.packs import BUILD, CHOSEN, PACKS, Pack
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
    assert list(packs) == ["world", "malaysia", "indonesia"]
    world = packs["world"]
    assert (world["title"], world["first"], world["minzoom"], world["maxzoom"]) == (
        "The world",
        True,
        0,
        6,
    )
    assert world["size"] == PACKS["world"].size
    assert not any(pack["installed"] or pack["fetching"] for pack in packs.values())


async def test_a_packs_tiles_are_served_as_cut(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    (settings.data_dir / "maps").mkdir(parents=True, exist_ok=True)
    write_pack(settings.data_dir / "maps" / f"world-{BUILD}.pmtiles", TILES)

    tile = await client.get("/api/map/tiles/world/5/25/15")

    assert tile.status_code == 200
    assert tile.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert tile.headers["content-encoding"] == "gzip"  # the window unpacks it
    assert tile.content == b"Malaysia"  # httpx, as the window, unpacks it
    # Where the pack has nothing, nothing; a pack not here, not found; and nothing else at all.
    assert (await client.get("/api/map/tiles/world/5/0/0")).status_code == 204
    assert (await client.get("/api/map/tiles/world/9/400/250")).status_code == 204
    assert (await client.get("/api/map/tiles/world/2/4/0")).status_code == 204
    assert (await client.get("/api/map/tiles/malaysia/10/800/500")).status_code == 404
    for wrong in ("/api/map/tiles/narnia/1/0/0", "/api/map/tiles/world/16/0/0"):
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
    tile = await client.get("/api/map/tiles/world/0/0/0")
    assert tile.content == b"the world"

    removed = await client.delete("/api/map/packs/world")
    assert removed.status_code == 200
    assert not {pack["key"]: pack for pack in removed.json()["packs"]}["world"]["installed"]
    assert not (settings.data_dir / "maps" / pinned.name).exists()
    assert (await client.get("/api/map/tiles/world/0/0/0")).status_code == 404


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
    assert (await client.get("/api/map/tiles/world/0/0/0")).status_code == 404


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
    write_pack(settings.maps / f"malaysia-{BUILD}.pmtiles", {KUALA_LUMPUR: b"Kuala Lumpur"})

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
    assert json.loads((settings.maps / CHOSEN).read_text(encoding="utf-8")) == {"online": False}


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
