"""Data never left broken: every link that comes back passes the rules a new
one does, a stored loop of parents is listed to put right, Undo is all or nothing, and work in
the background never enters Undo. Names are the fictional family's; the places are real towns."""

import asyncio
from typing import Any
from uuid import uuid7

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.services import people as people_service
from ancestree.services import placing
from ancestree.services.context import Context
from tests.integration.conftest import create_person, get_person, link
from tests.integration.test_pins_api import DOWNLOADED, HOUSE, engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def ok(response: httpx.Response) -> dict[str, Any]:
    assert response.is_success, response.text
    return response.json() if response.content else {}


async def linked(client: httpx.AsyncClient, a: str, b: str, a_is: str) -> str:
    """Link them; the new link's id."""
    made = await ok(await link(client, a, b, a_is))
    return str(made["links"][0]["id"])


async def to_trash(client: httpx.AsyncClient, person: dict[str, Any]) -> str:
    return str((await ok(await client.delete(f"/api/persons/{person['id']}")))["entry"])


async def restore(client: httpx.AsyncClient, entry: str) -> dict[str, Any]:
    return await ok(await client.post(f"/api/trash/{entry}/restore"))


async def parents_of(client: httpx.AsyncClient, person: dict[str, Any]) -> set[str]:
    return {p["id"] for p in (await get_person(client, person["id"]))["parents"]}


async def history(client: httpx.AsyncClient) -> dict[str, Any]:
    view: dict[str, Any] = (await client.get("/api/history")).json()
    return view


def label(step: dict[str, Any] | None) -> str | None:
    return step["label"] if step else None


# --- #2: back from the Trash, through the rules -------------------------------------------------


async def test_a_link_from_the_trash_that_would_make_a_loop_stays_out_and_is_said(
    client: httpx.AsyncClient,
) -> None:
    tok = await create_person(client, "Ismail bin Ahmad", gender="male")
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    ali = await create_person(client, "Ali bin Hassan", gender="male")
    await linked(client, tok["id"], hassan["id"], "parent")
    await linked(client, hassan["id"], ali["id"], "parent")
    entry = await to_trash(client, hassan)
    # With Hassan away, nothing joins Ali and Ismail: Ali can be recorded as Ismail's father.
    await linked(client, ali["id"], tok["id"], "parent")

    back = await restore(client, entry)

    # One of his two links comes back; the other would close the loop.
    assert back["restored_links"] == 1
    assert back["skipped_links"] == 0
    [said] = back["left_out"]
    assert said.startswith("Hassan bin Ismail's link to ")
    assert "can't come back" in said
    assert "their own ancestor" in said
    graph = await ok(await client.get("/api/graph"))
    assert graph["layout"]["loops"] == []


async def test_a_link_from_the_trash_that_would_give_three_birth_parents_stays_out(
    client: httpx.AsyncClient,
) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    siti = await create_person(client, "Siti binti Ahmad", gender="female")
    yusof = await create_person(client, "Yusof bin Daud", gender="male")
    ali = await create_person(client, "Ali bin Hassan", gender="male")
    for parent in (hassan, siti):
        await linked(client, parent["id"], ali["id"], "parent")
    entry = await to_trash(client, hassan)
    await linked(client, yusof["id"], ali["id"], "parent")

    back = await restore(client, entry)

    assert back["restored_links"] == 0
    [said] = back["left_out"]
    assert "already has two biological parents" in said
    assert await parents_of(client, ali) == {siti["id"], yusof["id"]}


async def test_a_marriage_comes_back_from_the_trash_in_its_order(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    rahman = await create_person(client, "Rahman bin Yusof", gender="male")
    halimah = await create_person(client, "Halimah binti Omar", gender="female")
    marriage = await linked(client, rahman["id"], halimah["id"], "spouse")
    await driver.execute_query(  # his second wife, as a spreadsheet says it
        "MATCH ()-[r:SPOUSE_OF {id: $id}]->() SET r.order = 2",
        id=marriage,
        database_=settings.neo4j_database,
    )
    made = (await driver.execute_query(
        "MATCH ()-[r:SPOUSE_OF {id: $id}]->() RETURN r.created_at AS made",
        id=marriage,
        database_=settings.neo4j_database,
    )).records[0]["made"]  # fmt: skip

    await restore(client, await to_trash(client, halimah))

    found = await driver.execute_query(
        "MATCH ()-[r:SPOUSE_OF {id: $id}]->() RETURN r.order AS order, r.created_at AS made",
        id=marriage,
        database_=settings.neo4j_database,
    )
    assert found.records[0]["order"] == 2
    assert found.records[0]["made"] == made


async def test_an_imports_take_back_brings_people_back_through_the_rules(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    """Whoever an import removed comes back as the Trash brings them: a link the rules refuse
    stays out, and is said."""
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    siti = await create_person(client, "Siti binti Ahmad", gender="female")
    yusof = await create_person(client, "Yusof bin Daud", gender="male")
    ali = await create_person(client, "Ali bin Hassan", gender="male")
    for parent in (hassan, siti):
        await linked(client, parent["id"], ali["id"], "parent")
    await to_trash(client, hassan)
    await linked(client, yusof["id"], ali["id"], "parent")
    ctx = Context(driver, settings.neo4j_database, settings.data_dir)

    brought = await people_service.bring_back(ctx, [hassan["id"]])
    assert brought.people == 1
    [said] = brought.left_out
    assert "already has two biological parents" in said
    assert await parents_of(client, ali) == {siti["id"], yusof["id"]}


# --- #5: Undo all or nothing ---------------------------------------------------------------------


async def merge_leaving_a_link_out(client: httpx.AsyncClient) -> dict[str, dict[str, Any]]:
    """Ali entered twice, the second with another father, whose link the rules refuse."""
    mother = await create_person(client, "Siti binti Ahmad", gender="female")
    father = await create_person(client, "Hassan bin Ismail", gender="male")
    other_father = await create_person(client, "Yusof bin Daud", gender="male")
    ali = await create_person(client, "Ali bin Hassan", gender="male")
    twice = await create_person(client, "Ali", occupation="Teacher")
    for parent in (mother, father):
        await linked(client, parent["id"], ali["id"], "parent")
    await linked(client, other_father["id"], twice["id"], "parent")
    merged = await client.post(f"/api/persons/{ali['id']}/merge", json={"other": twice["id"]})
    assert merged.status_code == 200, merged.text
    assert (await get_person(client, ali["id"]))["occupation"] == "Teacher"
    return {"ali": ali, "twice": twice, "other_father": other_father}


async def test_a_merge_that_left_a_link_out_undoes_whole(client: httpx.AsyncClient) -> None:
    people = await merge_leaving_a_link_out(client)

    undone = await client.post("/api/history/undo")

    assert undone.status_code == 200, undone.text
    assert (await get_person(client, people["ali"]["id"]))["occupation"] is None
    twice = await get_person(client, people["twice"]["id"])
    assert {p["id"] for p in twice["parents"]} == {people["other_father"]["id"]}
    assert label((await history(client))["redo"]) == "Merge Ali into Ali bin Hassan"
    assert (await client.post("/api/history/redo")).status_code == 200


async def test_an_undo_refused_brings_no_one_back_from_the_trash(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    people = await merge_leaving_a_link_out(client)
    await driver.execute_query(  # changed another way, as from the command line
        "MATCH (p:Person {id: $id}) SET p.occupation = 'Headmaster'",
        id=people["ali"]["id"],
        database_=settings.neo4j_database,
    )

    refused = await client.post("/api/history/undo")

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "cant_undo"
    gone = await client.get(f"/api/persons/{people['twice']['id']}")
    assert gone.status_code == 404  # still in the Trash, as before the Undo was asked
    trash: list[dict[str, Any]] = (await client.get("/api/trash")).json()
    assert [item["person_id"] for item in trash] == [people["twice"]["id"]]


async def test_an_undo_that_would_put_back_a_loop_is_refused_before_anything(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    tok = await create_person(client, "Ismail bin Ahmad", gender="male")
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    ali = await create_person(client, "Ali bin Hassan", gender="male")
    await linked(client, tok["id"], hassan["id"], "parent")
    second = await linked(client, hassan["id"], ali["id"], "parent")
    await ok(await client.delete(f"/api/relationships/{second}"))
    await driver.execute_query(  # stored another way, closing a loop if the link came back
        """
        MATCH (a:Person {id: $ali}), (t:Person {id: $tok})
        CREATE (a)-[:PARENT_OF {id: $id, kind: 'biological', created_at: datetime()}]->(t)
        """,
        ali=ali["id"],
        tok=tok["id"],
        id="01a0e0c2-0000-7fff-8000-000000000002",
        database_=settings.neo4j_database,
    )

    refused = await client.post("/api/history/undo")

    assert refused.status_code == 409
    assert (
        "Ali bin Hassan is already an ancestor of Hassan bin Ismail"
        in (refused.json()["detail"]["message"])
    )
    assert await parents_of(client, ali) == set()


# --- A stored loop, listed ---------------------------------------------------------------------


async def test_a_family_with_a_stored_loop_opens_and_lists_it(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    tok = await create_person(client, "Ismail bin Ahmad", gender="male", birth_date="1920")
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", birth_date="1945")
    ali = await create_person(client, "Ali bin Hassan", gender="male", birth_date="1970")
    await linked(client, tok["id"], hassan["id"], "parent")
    await linked(client, hassan["id"], ali["id"], "parent")
    loop_id = str(uuid7())  # the newest in the loop: made last
    await driver.execute_query(  # as a restore before 0.8.7 could store it
        """
        MATCH (a:Person {id: $ali}), (t:Person {id: $tok})
        CREATE (a)-[:PARENT_OF {id: $id, kind: 'biological', created_at: datetime()}]->(t)
        """,
        ali=ali["id"],
        tok=tok["id"],
        id=loop_id,
        database_=settings.neo4j_database,
    )

    graph = await ok(await client.get("/api/graph"))  # never answered before this

    [loop] = graph["layout"]["loops"]
    assert loop["link"] == loop_id
    assert loop["people"] == [tok["id"], hassan["id"], ali["id"]]
    assert set(graph["layout"]["seats"]) == {tok["id"], hassan["id"], ali["id"]}
    relation = await client.get("/api/kinship", params={"from": ali["id"], "to": tok["id"]})
    assert relation.status_code == 200, relation.text
    facts = await client.get("/api/family/facts")
    assert facts.status_code == 200, facts.text

    await ok(await client.delete(f"/api/relationships/{loop_id}"))
    assert (await ok(await client.get("/api/graph")))["layout"]["loops"] == []


async def test_a_child_with_three_birth_parents_is_listed_with_the_link_to_take_out(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    """As the Trash could store one before 0.8.7: listed so the keeper can put it right, and a
    relative's computer is never left unable to take the family in (the user's answer of
    19 Nov 2026)."""
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    siti = await create_person(client, "Siti binti Ahmad", gender="female")
    yusof = await create_person(client, "Yusof bin Daud", gender="male")
    ali = await create_person(client, "Ali bin Hassan", gender="male")
    for parent in (hassan, siti):
        await linked(client, parent["id"], ali["id"], "parent")
    third = str(uuid7())  # the newest of the three
    await driver.execute_query(
        """
        MATCH (y:Person {id: $yusof}), (a:Person {id: $ali})
        CREATE (y)-[:PARENT_OF {id: $id, kind: 'biological', created_at: datetime()}]->(a)
        """,
        yusof=yusof["id"],
        ali=ali["id"],
        id=third,
        database_=settings.neo4j_database,
    )

    graph = await ok(await client.get("/api/graph"))

    [crowded] = graph["layout"]["three_birth_parents"]
    assert crowded["child"] == ali["id"]
    assert crowded["parents"] == [hassan["id"], siti["id"], yusof["id"]]
    assert crowded["link"] == third
    await ok(await client.delete(f"/api/relationships/{third}"))
    assert (await ok(await client.get("/api/graph")))["layout"]["three_birth_parents"] == []
    refused = await client.post("/api/history/undo")  # it would be three again
    assert refused.status_code == 409
    assert "already has two biological parents" in refused.json()["detail"]["message"]


# --- #15: a country's places, in the background -------------------------------------------------


async def test_a_countrys_places_arriving_never_enter_undo_nor_clear_redo(
    driver: object, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with engine(settings) as (client, app):
        aina = await create_person(
            client, "Aina binti Hassan", residence={**HOUSE, "postcode": "15050"}
        )
        await create_person(client, "Hassan bin Ismail")
        await ok(await client.post("/api/history/undo"))  # Hassan's adding, to redo
        monkeypatch.setattr(placing, "gazetteer", lambda: DOWNLOADED)  # Malaysia's, come

        app.state.map_packs.places_changed("my", True)
        for _ in range(100):
            if (await get_person(client, aina["id"]))["residence"]["exact"] == "postcode":
                break
            await asyncio.sleep(0.05)
        else:
            raise AssertionError("Aina's address wasn't placed more exactly")

        now = await history(client)
        assert label(now["undo"]) == "Add Aina binti Hassan"
        assert label(now["redo"]) == "Add Hassan bin Ismail"
        assert (await client.post("/api/history/redo")).status_code == 200
        assert (await client.post("/api/history/undo")).status_code == 200
        # Adding Aina still undoes, though where she lives was placed since.
        assert (await client.post("/api/history/undo")).status_code == 200, "Aina"
        assert (await client.get(f"/api/persons/{aina['id']}")).status_code == 404
