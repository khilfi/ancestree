"""People pinned where they live, by themselves, over HTTP:
an address on the map with no other step; a pin put by hand moving the household's, one Undo
step; a pin put first filling the address in; the online lookup asked of a stand-in, and
refused where it's off; a country's places placing its addresses more exactly, only where no
review is needed and never one put by hand; and an import's addresses placed in its step. The
people are made up; the places are real towns, and a made-up postcode."""

import asyncio
import json
import threading
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, ClassVar

import httpx
import pytest
from fastapi import FastAPI

from ancestree.config import Settings
from ancestree.main import create_app
from ancestree.places.gazetteer import Gazetteer
from ancestree.services import placing
from ancestree.services.familyfolder import FamilyFolder
from tests.integration.conftest import create_person, get_person
from tests.integration.test_import_api import preview, run

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

HOUSE = {"address": "No. 3, Jalan Sultan", "town": "Kota Bharu", "state": "Kelantan"}
BY_HAND = {"lat": 6.1301, "lon": 102.2402, "exact": "hand"}


@asynccontextmanager
async def engine(settings: Settings) -> AsyncIterator[tuple[httpx.AsyncClient, FastAPI]]:
    """The whole app, and its state, as the client fixture runs it."""
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, app


async def edit(client: httpx.AsyncClient, person: dict[str, Any], **fields: Any) -> dict[str, Any]:
    body = {"full_name": person["full_name"], "gender": person["gender"], **fields}
    response = await client.put(f"/api/persons/{person['id']}", json=body)
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()["person"]
    return found


async def test_an_address_typed_is_placed_and_on_the_map_with_no_other_step(
    client: httpx.AsyncClient,
) -> None:
    """Placed at its town with no internet; a pin put by hand is where the map puts them."""
    aina = await create_person(client, "Aina binti Hassan", residence=HOUSE)
    home = (await get_person(client, aina["id"]))["residence"]
    assert home["exact"] == "town"
    assert home["lat"] == pytest.approx(6.12, abs=0.05)
    await edit(client, aina, residence={**HOUSE, **BY_HAND})
    family = (await client.get("/api/map")).json()
    [lives] = [p["lives"] for p in family["people"] if p["id"] == aina["id"]]
    assert (lives["lat"], lives["lon"], lives["exact"]) == (6.1301, 102.2402, "hand")
    assert lives["name"] == "Kota Bharu"  # still counted in its town


async def test_a_pin_moved_by_hand_moves_its_household_in_one_undo_step(
    client: httpx.AsyncClient,
) -> None:
    aina = await create_person(client, "Aina binti Hassan", residence=HOUSE)
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", residence=HOUSE)
    other = await create_person(client, "Siti binti Ali", residence={**HOUSE, "address": "No. 5"})
    await edit(client, aina, residence={**HOUSE, "address": "NO.3 jalan sultan", **BY_HAND})
    for person in (aina, hassan):
        home = (await get_person(client, person["id"]))["residence"]
        assert (home["lat"], home["lon"], home["exact"]) == (6.1301, 102.2402, "hand")
    assert (await get_person(client, other["id"]))["residence"]["exact"] == "town"
    # Someone added there later joins them.
    zul = await create_person(client, "Zulkifli bin Hassan", gender="male", residence=HOUSE)
    assert (await get_person(client, zul["id"]))["residence"]["exact"] == "hand"

    step = (await client.get("/api/history")).json()["undo"]
    assert step["label"] == "Add Zulkifli bin Hassan"
    await client.post("/api/history/undo", params={"step": step["id"]})
    step = (await client.get("/api/history")).json()["undo"]
    assert step["label"] == "Edit Aina binti Hassan"
    await client.post("/api/history/undo", params={"step": step["id"]})
    for person in (aina, hassan):
        assert (await get_person(client, person["id"]))["residence"]["exact"] == "town"


async def test_a_pin_put_first_fills_the_address_in(client: httpx.AsyncClient) -> None:
    near = await client.get(
        "/api/places/near", params={"lat": 6.13, "lon": 102.24, "country": "Malaysia"}
    )
    assert near.status_code == 200, near.text
    found = near.json()
    assert (found["town"], found["state"], found["country"], found["exact"]) == (
        "Kota Bharu",
        "Kelantan",
        "Malaysia",
        "hand",
    )
    sea = await client.get(
        "/api/places/near", params={"lat": 0.0, "lon": 80.0, "country": "Malaysia"}
    )
    assert sea.json() is None


class _Photon(BaseHTTPRequestHandler):
    asked: ClassVar[list[str]] = []

    def do_GET(self) -> None:
        type(self).asked.append(self.path)
        feature = {
            "geometry": {"coordinates": [102.2402, 6.1301]},
            "properties": {
                "type": "house",
                "housenumber": "3",
                "street": "Jalan Sultan",
                "city": "Kota Bharu",
                "state": "Kelantan",
                "countrycode": "MY",
            },
        }
        body = json.dumps({"features": [feature]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: Any) -> None:
        pass


@pytest.fixture
def stand_in() -> Iterator[tuple[str, type[_Photon]]]:
    """A made-up Photon on this computer: nothing leaves it."""
    handler = type("Answers", (_Photon,), {"asked": []})
    server = HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/api/", handler
    finally:
        server.shutdown()
        server.server_close()


async def test_an_address_is_looked_up_online_only_where_allowed(
    driver: object, settings: Settings, stand_in: tuple[str, type[_Photon]]
) -> None:
    """Asked of Photon (here a stand-in) once, with what was typed; refused, and nothing
    asked, once this computer looks nothing up online, even asked straight."""
    url, handler = stand_in
    async with engine(settings.model_copy(update={"photon_url": url})) as (client, _):
        asked = {"line": "No. 3, Jalan Sultan, Kota Bharu", "country": "Malaysia"}
        found = await client.post("/api/places/lookup", json=asked)
        assert found.status_code == 200, found.text
        [house] = found.json()["suggestions"]
        assert (house["address"], house["town"], house["exact"]) == (
            "3 Jalan Sultan",
            "Kota Bharu",
            "spot",
        )
        assert house["country"] == "Malaysia"
        assert len(handler.asked) == 1

        chosen = await client.put("/api/map/lookup", json={"lookup": "never"})
        assert chosen.json()["lookup"] == "never"
        refused = await client.post("/api/places/lookup", json=asked)
        assert refused.status_code == 409
        assert refused.json()["detail"]["code"] == "lookup_off"
        assert len(handler.asked) == 1  # nothing went
    async with engine(settings) as (client, _):  # kept, as the app starts again
        assert (await client.get("/api/map/packs")).json()["lookup"] == "never"


async def test_photon_unreachable_is_said(driver: object, settings: Settings) -> None:
    gone = settings.model_copy(update={"photon_url": "http://127.0.0.1:9/api/"})
    async with engine(gone) as (client, _):
        answer = await client.post("/api/places/lookup", json={"line": "Kota Bharu"})
        assert answer.status_code == 502
        assert answer.json()["detail"]["code"] == "photon"


DOWNLOADED = Gazetteer([
    "MY\t\t\tN\tMalaysia\t3.1\t101.7\t30000000\t",
    "MY\tKelantan\tKota Bharu\tP\tKota Bharu\t6.1254\t102.2386\t568900\t",
    "MY\tKelantan\t\tZ\t15050\t6.1188\t102.2501\t0\tKota Bharu",
])  # fmt: skip


async def wait_for(client: httpx.AsyncClient, label: str) -> None:
    for _ in range(100):
        step = (await client.get("/api/history")).json()["undo"]
        if step is not None and step["label"] == label:
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"no step {label!r}")


async def test_a_countrys_places_coming_place_its_addresses_more_exactly(
    driver: object, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with engine(settings) as (client, app):
        aina = await create_person(
            client, "Aina binti Hassan", residence={**HOUSE, "postcode": "15050"}
        )
        hassan = await create_person(
            client, "Hassan bin Ismail", residence={**HOUSE, "address": "No. 9", **BY_HAND}
        )
        assert (await get_person(client, aina["id"]))["residence"]["exact"] == "town"
        monkeypatch.setattr(placing, "gazetteer", lambda: DOWNLOADED)  # Malaysia's, come

        app.state.map_packs.places_changed("my", True)
        await wait_for(client, "1 address in Malaysia placed more exactly")
        home = (await get_person(client, aina["id"]))["residence"]
        assert (home["lat"], home["lon"], home["exact"]) == (6.1188, 102.2501, "postcode")
        assert (await get_person(client, hassan["id"]))["residence"]["exact"] == "hand"
        assert (await client.get("/api/map/packs")).json()["placed"] == {"my": 1}


async def test_a_relatives_computer_leaves_its_pins_to_the_keepers(
    driver: object, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """There, it would be a change for the keeper to review, from every relative."""
    async with engine(settings) as (client, app):
        aina = await create_person(
            client, "Aina binti Hassan", residence={**HOUSE, "postcode": "15050"}
        )
        monkeypatch.setattr(placing, "gazetteer", lambda: DOWNLOADED)
        monkeypatch.setattr(FamilyFolder, "editing", property(lambda self: False))
        app.state.map_packs.places_changed("my", True)
        await asyncio.sleep(0.5)
        assert (await get_person(client, aina["id"]))["residence"]["exact"] == "town"
        assert (await client.get("/api/history")).json()["undo"]["label"] == "Add Aina binti Hassan"


async def test_an_imports_addresses_are_placed_in_its_step(client: httpx.AsyncClient) -> None:
    rows = (
        "Full name,Lives in,Address,Postcode\r\n"
        'Aina binti Hassan,"Kota Bharu, Kelantan","No. 3, Jalan Sultan",15050\r\n'
        'Siti binti Ali,"Kampung Tiada Dalam Peta, Kelantan",Lot 5,\r\n'
    ).encode("utf-8-sig")
    seen = await preview(client, rows)
    assert seen["placed"] == {"postcode": 0, "town": 1, "not_found": 1}
    assert "Address" not in seen["columns_not_read"]
    done = await run(client, rows)
    assert done["placed"] == {"postcode": 0, "town": 1, "not_found": 1}
    people = {p["full_name"]: p["id"] for p in (await client.get("/api/graph")).json()["people"]}
    home = (await get_person(client, people["Aina binti Hassan"]))["residence"]
    assert (home["address"], home["postcode"], home["exact"]) == (
        "No. 3, Jalan Sultan",
        "15050",
        "town",
    )
