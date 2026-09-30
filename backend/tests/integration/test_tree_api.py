import json
import time

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from tests.integration.conftest import create_person, link, load_generated_family

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def test_dragged_positions_are_remembered_until_rearranged(
    client: httpx.AsyncClient,
) -> None:
    tok = await create_person(client, "Tok")
    ali = await create_person(client, "Ali")
    await link(client, tok["id"], ali["id"], "parent")

    saved = await client.put(
        "/api/layout/positions", json={"positions": [{"id": tok["id"], "x": 10.5, "y": -3}]}
    )

    assert saved.status_code == 204
    people = {p["id"]: p for p in (await client.get("/api/graph")).json()["people"]}
    assert (people[tok["id"]]["x"], people[tok["id"]]["y"]) == (10.5, -3)
    assert people[ali["id"]]["x"] is None
    assert (await client.delete("/api/layout/positions")).status_code == 204
    people = {p["id"]: p for p in (await client.get("/api/graph")).json()["people"]}
    assert people[tok["id"]]["x"] is None


async def test_the_centre_can_be_chosen_and_given_back(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    tok = await create_person(client, "Tok")
    hassan = await create_person(client, "Hassan")
    amin = await create_person(client, "Amin")
    await link(client, tok["id"], hassan["id"], "parent")
    await link(client, hassan["id"], amin["id"], "parent")

    before = (await client.get("/api/graph")).json()["layout"]
    chosen = await client.put("/api/settings", json={"centre": hassan["id"], "colours": "off"})
    after = (await client.get("/api/graph")).json()["layout"]

    assert before["units"][0]["centre"] == [tok["id"]]
    assert not before["centre_chosen"]
    assert chosen.json() == {"centre": hassan["id"], "colours": "off"}
    assert after["units"][0]["centre"] == [hassan["id"]]
    assert after["centre_chosen"]
    assert after["units"][1]["anchor"] == hassan["id"]  # Tok hangs off Hassan now
    saved = json.loads((settings.data_dir / "settings" / "app.json").read_text("utf-8"))
    assert saved["tree"]["centre"] == hassan["id"]
    await client.put("/api/settings", json={"centre": None, "colours": "branch"})
    assert (await client.get("/api/graph")).json()["layout"]["units"][0]["centre"] == [tok["id"]]


async def test_two_thousand_people_load_within_a_second(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    await load_generated_family(driver, settings.neo4j_database, 2000)
    await client.get("/api/graph")  # warm up the query plans

    started = time.perf_counter()
    graph = (await client.get("/api/graph")).json()
    elapsed = time.perf_counter() - started

    assert len(graph["people"]) == 2000
    assert len(graph["layout"]["seats"]) == 2000
    assert elapsed < 1.0, f"loading 2,000 people took {elapsed:.2f}s"  # D10


async def test_a_sample_family_can_be_generated_without_storing_it(
    client: httpx.AsyncClient,
) -> None:
    sample = (await client.get("/api/sample/graph", params={"people": 50})).json()

    assert len(sample["people"]) == 50
    assert (await client.get("/api/graph")).json()["people"] == []
