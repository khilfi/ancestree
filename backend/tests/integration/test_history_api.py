"""Undo and redo."""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from io import BytesIO
from typing import Any

import httpx
import pytest
from neo4j import AsyncDriver
from PIL import Image

from ancestree.config import Settings
from ancestree.repo.export import export_graph
from ancestree.storage.settings import read_tree_settings
from tests.integration.conftest import create_person, get_person, link, load_generated_family

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

State = tuple[dict[str, Any], dict[str, Any], Any]


async def state(driver: AsyncDriver, settings: Settings) -> State:
    """The tree as undo sees it: people, links and the tree's settings. The time of each
    change isn't part of it, nor when a link restored from the Trash was made again."""
    graph = await export_graph(driver, settings.neo4j_database)
    people = {p["id"]: {k: v for k, v in p.items() if k != "updated_at"} for p in graph["people"]}
    links = {
        link["properties"]["id"]: (
            link["type"],
            link["source"],
            link["target"],
            {k: v for k, v in link["properties"].items() if k != "created_at"},
        )
        for link in graph["links"]
    }
    return people, links, await asyncio.to_thread(read_tree_settings, settings.data_dir)


async def history(client: httpx.AsyncClient) -> dict[str, Any]:
    view: dict[str, Any] = (await client.get("/api/history")).json()
    return view


async def ok(response: httpx.Response) -> dict[str, Any]:
    assert response.is_success, response.text
    return response.json() if response.content else {}


async def test_everything_undoes_and_redoes_step_by_step(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    states = [await state(driver, settings)]
    labels: list[str] = []

    async def step(call: Awaitable[httpx.Response]) -> dict[str, Any]:
        """Make one change, then note the tree and the step's label."""
        body = await ok(await call)
        states.append(await state(driver, settings))
        labels.append((await history(client))["undo"]["label"])
        return body

    hassan = await step(client.post("/api/persons", json={"full_name": "Hassan"}))
    mariam = await step(client.post("/api/persons", json={"full_name": "Mariam"}))
    yusof = await step(client.post("/api/persons", json={"full_name": "Yusof"}))
    h, m, y = hassan["person"]["id"], mariam["person"]["id"], yusof["person"]["id"]
    parent = await step(link(client, h, y, "parent"))
    await step(link(client, h, m, "spouse"))
    await step(client.put(f"/api/persons/{y}", json={"full_name": "Yusof", "birth_date": "1965"}))
    first = await step(
        client.post(
            f"/api/persons/{h}/relatives",
            json={"relation": "child", "person": {"full_name": "Aminah"}, "other_parent": m},
        )
    )
    second = await step(
        client.post(
            f"/api/persons/{h}/relatives",
            json={"relation": "child", "person": {"full_name": "Nor"}, "other_parent": m},
        )
    )
    order = [second["person"]["id"], first["person"]["id"]]
    await step(client.put(f"/api/persons/{h}/children/order", json={"child_ids": order}))
    umar = await step(client.post("/api/persons", json={"full_name": "Umar"}))
    hana = await step(client.post("/api/persons", json={"full_name": "Hana"}))
    await step(link(client, umar["person"]["id"], hana["person"]["id"], "sibling"))
    graph = (await client.get("/api/graph")).json()
    unknown = next(p["id"] for p in graph["people"] if p["placeholder"])
    await step(
        client.post(f"/api/persons/{unknown}/fill-in", json={"person": {"full_name": "Latif"}})
    )
    moved = [{"id": h, "x": 10.5, "y": 20.0}, {"id": y, "x": -30.0, "y": 40.0}]
    await step(client.put("/api/layout/positions", json={"positions": moved}))
    await step(client.delete("/api/layout/positions"))
    await step(client.put("/api/settings", json={"centre": h, "colours": "generation"}))
    entry = await step(client.delete(f"/api/persons/{m}"))
    await step(client.post(f"/api/trash/{entry['entry']}/restore"))
    await step(client.patch(f"/api/relationships/{parent['links'][0]['id']}", json={"swap": True}))
    await step(client.delete(f"/api/relationships/{parent['links'][0]['id']}"))

    assert labels[:3] == ["Add Hassan", "Add Mariam", "Add Yusof"]
    assert labels[3] == "Link Hassan and Yusof"
    assert "Move Mariam to the Trash" in labels
    assert labels[-1] == "Remove the link between Yusof and Hassan"  # swapped just before

    for n in range(len(labels), 0, -1):
        done = await ok(await client.post("/api/history/undo"))
        assert done["done"]["label"] == labels[n - 1]
        assert await state(driver, settings) == states[n - 1], labels[n - 1]
    assert (await history(client))["undo"] is None
    assert list((settings.data_dir / "people").iterdir()) == []  # every folder went too

    for n in range(1, len(labels) + 1):
        done = await ok(await client.post("/api/history/redo"))
        assert done["done"]["label"] == labels[n - 1]
        assert await state(driver, settings) == states[n], labels[n - 1]
    assert (await history(client))["redo"] is None
    # People brought back are whole again: their folder is written anew.
    assert (settings.data_dir / "people" / y / "person.json").exists()


def snapshot(settings: Settings, person_id: str) -> dict[str, Any]:
    path = settings.data_dir / "people" / person_id / "person.json"
    found: dict[str, Any] = json.loads(path.read_text("utf-8"))
    return found


async def test_each_persons_folder_follows_undo_and_redo(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    h = (await create_person(client, "Hassan"))["id"]
    y = (await create_person(client, "Yusof"))["id"]
    await ok(await link(client, h, y, "parent"))

    await ok(await client.post("/api/history/undo"))
    assert snapshot(settings, y)["parents"] == []
    assert snapshot(settings, h)["child_groups"] == []

    await ok(await client.post("/api/history/redo"))
    assert [parent["id"] for parent in snapshot(settings, y)["parents"]] == [h]

    # Where someone sits isn't in their folder: taking a move back leaves it be.
    moved = {"positions": [{"id": h, "x": 1.0, "y": 2.0}]}
    await ok(await client.put("/api/layout/positions", json=moved))
    before = snapshot(settings, h)
    await ok(await client.post("/api/history/undo"))
    assert snapshot(settings, h) == before
    assert (await get_person(client, h))["updated_at"] == before["updated_at"]


async def test_rearranging_two_thousand_people_undoes_within_a_second(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await load_generated_family(driver, settings.neo4j_database, 2000)  # D10
    everyone = [{"id": pid, "x": float(n), "y": 0.0} for n, pid in enumerate(ids)]
    await ok(await client.put("/api/layout/positions", json={"positions": everyone}))

    calls: list[Callable[[], Awaitable[httpx.Response]]] = [
        lambda: client.delete("/api/layout/positions"),
        lambda: client.post("/api/history/undo"),
        lambda: client.post("/api/history/redo"),
    ]
    for call in calls:
        started = time.perf_counter()
        await ok(await call())
        elapsed = time.perf_counter() - started
        assert elapsed < 1.0, f"took {elapsed:.2f}s"

    assert (await history(client))["undo"]["label"] == "Rearrange"


async def test_undo_is_refused_if_what_it_changed_was_changed_another_way(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    siti = await create_person(client, "Siti")
    await ok(await client.put(f"/api/persons/{siti['id']}", json={"full_name": "Siti Aminah"}))
    # Changed outside the app, e.g. from the command line.
    await driver.execute_query(
        "MATCH (p:Person {id: $id}) SET p.full_name = 'Siti Hajar'",
        id=siti["id"],
        database_=settings.neo4j_database,
    )

    refused = await client.post("/api/history/undo")

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "cant_undo"
    assert "Siti Aminah has changed since" in refused.json()["detail"]["message"]
    assert (await get_person(client, siti["id"]))["full_name"] == "Siti Hajar"
    assert await history(client) == {"undo": None, "redo": None}  # nothing older either


async def test_adding_someone_who_now_has_a_photo_cant_be_undone(
    client: httpx.AsyncClient,
) -> None:
    zul = await create_person(client, "Zul")
    picture = BytesIO()
    Image.new("RGB", (300, 300), (10, 90, 160)).save(picture, "PNG")
    files = {"file": ("z.png", picture.getvalue(), "image/png")}
    await ok(await client.put(f"/api/persons/{zul['id']}/photo", files=files))

    refused = await client.post("/api/history/undo")

    assert refused.status_code == 409
    assert (await get_person(client, zul["id"]))["photo_version"]  # still there, photo too


async def test_a_new_change_ends_what_could_be_redone(client: httpx.AsyncClient) -> None:
    await create_person(client, "Rahman")
    await ok(await client.post("/api/history/undo"))
    assert (await history(client))["redo"]["label"] == "Add Rahman"

    await create_person(client, "Latif")

    assert await history(client) == {
        "undo": {**(await history(client))["undo"], "label": "Add Latif"},
        "redo": None,
    }


async def test_undo_says_when_theres_nothing_or_something_newer(client: httpx.AsyncClient) -> None:
    nothing = await client.post("/api/history/undo")
    assert (nothing.status_code, nothing.json()["detail"]["code"]) == (409, "nothing")

    await create_person(client, "Hana")
    newer = await client.post("/api/history/undo", params={"step": "an-older-one"})

    assert (newer.status_code, newer.json()["detail"]["code"]) == (409, "not_latest")
    step = (await history(client))["undo"]["id"]
    assert (await client.post("/api/history/undo", params={"step": step})).is_success


async def test_restoring_a_backup_ends_the_history(client: httpx.AsyncClient) -> None:
    await create_person(client, "Umar")
    made = await ok(await client.post("/api/exports", json={"format": "archive"}))
    await create_person(client, "Aishah")

    await ok(await client.post(f"/api/backups/{made['name']}/restore"))

    assert await history(client) == {"undo": None, "redo": None}
