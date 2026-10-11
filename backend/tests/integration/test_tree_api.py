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
    assert chosen.json() == {"centre": hassan["id"], "colours": "off", "married_in": "fans"}
    assert after["units"][0]["centre"] == [hassan["id"]]
    assert after["centre_chosen"]
    assert after["units"][1]["anchor"] == hassan["id"]  # Tok hangs off Hassan now
    saved = json.loads((settings.data_dir / "settings" / "app.json").read_text("utf-8"))
    assert saved["tree"]["centre"] == hassan["id"]
    await client.put("/api/settings", json={"centre": None, "colours": "branch"})
    assert (await client.get("/api/graph")).json()["layout"]["units"][0]["centre"] == [tok["id"]]


async def test_married_in_families_are_placed_the_way_this_computer_chose(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Married-in families as fans until another way is chosen; the choice kept on
    this computer, like the colours, and an Undo step that says what it did."""
    assert (await client.get("/api/settings")).json()["married_in"] == "fans"

    chosen = await client.put(
        "/api/settings", json={"centre": None, "colours": "branch", "married_in": "tucked"}
    )

    assert chosen.json()["married_in"] == "tucked"
    saved = json.loads((settings.data_dir / "settings" / "app.json").read_text("utf-8"))
    assert saved["tree"]["married_in"] == "tucked"
    assert (await client.get("/api/history")).json()["undo"]["label"] == (
        "Married-in families tucked in"
    )
    await client.post("/api/history/undo")
    assert (await client.get("/api/settings")).json()["married_in"] == "fans"
    refused = await client.put(
        "/api/settings", json={"centre": None, "colours": "branch", "married_in": "spiral"}
    )
    assert refused.status_code == 422


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


async def test_made_up_families_with_married_in_families_are_seated_without_storing_them(
    client: httpx.AsyncClient,
) -> None:
    families = (await client.get("/api/sample/families")).json()

    assert [family["key"] for family in families] == [
        "planned",
        "neighbours",
        "six",
        "deep",
        "sizes",
        "generations",
    ]
    for family in families:
        assert family["title"]
        assert family["about"]
        assert any(unit["anchor"] for unit in family["graph"]["layout"]["units"])
    assert (await client.get("/api/graph")).json()["people"] == []


async def test_a_family_is_read_from_a_backup_without_restoring_it(
    client: httpx.AsyncClient,
) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", birth_date="1938")
    yusof = await create_person(client, "Yusof bin Hassan", gender="male", birth_date="1965")
    await link(client, hassan["id"], yusof["id"], "parent")
    made = await client.post("/api/exports", json={"format": "archive"})
    archive = (await client.get(f"/api/exports/{made.json()['name']}")).content
    await create_person(client, "Aminah binti Yusof")  # the family changes after its backup

    read = await client.post(
        "/api/sample/families/backup", files={"file": ("backup.zip", archive, "application/zip")}
    )

    assert read.status_code == 200, read.text
    names = sorted(person["full_name"] for person in read.json()["people"])
    assert names == ["Hassan bin Ismail", "Yusof bin Hassan"]
    assert len((await client.get("/api/graph")).json()["people"]) == 3  # nothing restored
    refused = await client.post(
        "/api/sample/families/backup",
        files={"file": ("x.zip", b"not a zip", "application/zip")},
    )
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "bad_archive"
