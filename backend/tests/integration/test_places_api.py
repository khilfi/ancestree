"""The map's answers: everyone's places found on the map,
places put on it by hand, and the quick fixes that give someone a place. The test family is
fictional; its places are real towns."""

import json
from typing import Any

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.seed.loader import load_seed

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def ok(response: httpx.Response) -> Any:
    assert response.is_success, response.text
    return response.json()


async def family(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> dict[str, str]:
    await load_seed(driver, settings.neo4j_database)
    graph = await ok(await client.get("/api/graph"))
    return {p["full_name"]: p["id"] for p in graph["people"] if not p["placeholder"]}


def by_id(answer: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {person["id"]: person for person in answer["people"]}


async def test_everyones_places_are_found_on_the_map(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await family(client, driver, settings)

    answer = await ok(await client.get("/api/map"))

    people = by_id(answer)
    assert set(people) == set(ids.values())  # everyone but unknown parents
    assert answer["pins"] == []
    lives = [p["lives"] for p in people.values() if p["lives"]]
    assert lives, "the test family has places"
    for located in lives + [p["born"] for p in people.values() if p["born"]]:
        assert located["found"] == "town", located
        assert located["country"] == "Malaysia"
        assert located["state"]
        assert 0 < located["lat"] < 8  # Malaysia
        assert 99 < located["lon"] < 120


async def test_where_someone_lives_is_said_to_the_district(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    """ "Kampung Laut, Tumpat, Kelantan": on the map's places and in the person's
    details; never in person.json, which explains a folder without the app as before."""
    ids = await family(client, driver, settings)
    ali = ids["Ali bin Rosli"]
    place = {"town": "Kampung Laut", "state": "Kelantan", "country": "Malaysia"}
    await ok(await client.patch(f"/api/persons/{ali}", json={"residence": place}))

    detail = await ok(await client.get(f"/api/persons/{ali}"))
    assert detail["residence_district"] == "Tumpat"
    lives = by_id(await ok(await client.get("/api/map")))[ali]["lives"]
    assert (lives["name"], lives["district"], lives["state"]) == (
        "Kampong Laut",
        "Tumpat",
        "Kelantan",
    )
    written = settings.data_dir / "people" / ali / "person.json"
    assert "residence_district" not in json.loads(written.read_text(encoding="utf-8"))


async def test_towns_are_named_around_the_familys_places(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    """Towns of 1,000 people or more within 30 km, the biggest first; then the kampungs
    nearest each place. Never one of the family's own places: the map names those."""
    ids = await family(client, driver, settings)
    place = {"town": "Kampung Laut", "state": "Kelantan", "country": "Malaysia"}
    await ok(await client.patch(f"/api/persons/{ids['Ali bin Rosli']}", json={"residence": place}))

    towns = (await ok(await client.get("/api/map")))["towns"]

    names = [town["name"] for town in towns]
    assert "Pasir Mas" in names  # 15 km from Kampung Laut
    for own in ("Kampong Laut", "Kota Bharu", "Shah Alam", "Klang", "Ipoh"):
        assert own not in names, own
    big = [town["people"] for town in towns if town["people"] >= 1000]
    assert big == sorted(big, reverse=True)
    assert all(town["people"] >= 1000 for town in towns[: len(big)])
    assert len(towns) > len(big), "and the kampungs around them, nearest first"
    assert len(towns) == len({(t["name"], t["lat"], t["lon"]) for t in towns})  # each once


async def test_a_place_put_on_the_map_by_hand_is_one_undo_step(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await family(client, driver, settings)
    ali = ids["Ali bin Rosli"]
    somewhere = {"town": "Kampung Tiada Dalam Peta", "state": "Kelantan", "country": "Malaysia"}

    # A quick fix gives him a place the gazetteer doesn't know: its state's middle, for now.
    await ok(await client.patch(f"/api/persons/{ali}", json={"residence": somewhere}))
    step = (await ok(await client.get("/api/history")))["undo"]
    assert step["label"] == "Set Ali bin Rosli's place they live"
    rough = by_id(await ok(await client.get("/api/map")))[ali]["lives"]
    assert (rough["found"], rough["name"], rough["state"]) == ("state", "Kelantan", "Kelantan")

    # Put on the map by hand, it's his place; written another way, it's the same pin.
    pin = {"town": "Kg. Tiada Dalam Peta", "state": "kelantan", "lat": 5.91, "lon": 102.13}
    saved = await ok(await client.put("/api/places/pins", json=pin))
    assert len(saved["pins"]) == 1
    step = (await ok(await client.get("/api/history")))["undo"]
    assert step["label"] == "Put Kg. Tiada Dalam Peta on the map"
    placed = by_id(await ok(await client.get("/api/map")))[ali]["lives"]
    assert (placed["found"], placed["lat"], placed["lon"]) == ("pin", 5.91, 102.13)

    # Undo takes the pin off again.
    await ok(await client.post("/api/history/undo", params={"step": step["id"]}))
    assert (await ok(await client.get("/api/map")))["pins"] == []

    # So does taking it off.
    await ok(await client.post("/api/history/redo"))
    removed = await ok(await client.request("DELETE", "/api/places/pins", params=somewhere))
    assert removed["pins"] == []
    again = await client.request("DELETE", "/api/places/pins", params=somewhere)
    assert again.status_code == 409


async def test_a_quick_fix_can_clear_a_place_or_give_a_birthplace(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await family(client, driver, settings)
    ali = ids["Ali bin Rosli"]

    await ok(await client.patch(f"/api/persons/{ali}", json={"residence": None}))
    born = {"town": "Ipoh", "state": "Perak"}
    saved = await ok(await client.patch(f"/api/persons/{ali}", json={"birth_place": born}))

    assert saved["person"]["residence"] is None
    assert saved["person"]["birth_place"]["town"] == "Ipoh"
    mapped = by_id(await ok(await client.get("/api/map")))[ali]
    assert mapped["lives"] is None
    assert (mapped["born"]["found"], mapped["born"]["name"]) == ("town", "Ipoh")
    nothing = await client.patch(f"/api/persons/{ali}", json={})
    assert nothing.status_code == 409


async def test_the_made_up_family_is_spread_over_real_towns(client: httpx.AsyncClient) -> None:
    answer = await ok(await client.get("/api/sample/map", params={"people": 300}))

    placed = [p["lives"] for p in answer["people"] if p["lives"]]
    assert len(answer["people"]) >= 250
    assert len(placed) > len(answer["people"]) / 2
    assert all(located["found"] == "town" for located in placed)
    assert len({located["state"] for located in placed if located["country"] == "Malaysia"}) > 5
