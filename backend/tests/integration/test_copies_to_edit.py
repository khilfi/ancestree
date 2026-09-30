"""Copies to edit: a copy carries the family itself, as the app
holds it, for whom it was made and with what they may do; and the app keeps what the copy
started from, to compare with what comes back."""

import gzip
from datetime import date
from uuid import UUID

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.exchange.copies import read_page, unseal
from ancestree.exchange.records import in_tree_order, tree_row
from ancestree.services.graph import build_graph
from ancestree.storage.copies import read_copy
from tests.integration.test_copies import (
    LIVING_PLACES,
    copy_app,  # noqa: F401 - the copy's app stands in here too
    copy_page,
    family,
    strings,
)

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

PASSWORD = "kunci rahsia keluarga"
MAY = {"add": True, "change": True, "remove": False, "stories": True, "photos": False}


async def test_a_copy_to_edit_carries_the_family_itself(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await family(client, driver, settings)
    hassan, aminah, ali = ids["Hassan bin Ismail"], ids["Aminah binti Hassan"], ids["Ali bin Rosli"]

    name, download = await copy_page(
        client, title="Keluarga Contoh", editable=True, for_name="  Mak   Long ", may=MAY
    )
    copy = unseal(read_page(download.text))

    # Named for whom it's for, and saying so; what they may do in it.
    assert name == f"ancestree-keluarga-contoh-for-mak-long-{date.today():%Y-%m-%d}.html"
    editing = copy["about"]["editing"]
    assert UUID(editing["id"]).version == 7
    assert editing == {
        "id": editing["id"],
        "for": "Mak Long",
        "may": MAY,
        "made_at": copy["about"]["made_at"],
        "saved_at": None,
        "hidden": [],
    }

    # The family itself, as the app holds it: the copy works out the rest (src/copyedit), and
    # seats everyone as the app does.
    for worked_out in ("graph", "layouts", "persons", "search"):
        assert worked_out not in copy
    graph = (await client.get("/api/graph")).json()
    people, links = copy["family"]["people"], copy["family"]["links"]
    assert {person["id"] for person in people} == {person["id"] for person in graph["people"]}
    in_layout = {kind["key"]: kind["in_layout"] for kind in copy["kinds"]}
    rows = in_tree_order(tree_row(person) for person in people)
    assert build_graph(rows, links, in_layout, None).model_dump(mode="json") == graph
    records = {person["id"]: person for person in people}
    assert (records[ali]["occupation"], records[ali]["notes"]) == (
        "Jurutera",
        "Plays badminton on Sundays.",
    )
    assert records[hassan]["has_photo"] is True
    assert set(copy["stories"]) == {hassan, aminah}
    assert f"/api/persons/{aminah}/photo/avatar?size=512" in copy["files"]
    assert (copy["photos"], copy["trash"]) == ({}, [])
    # The middle of each state and country, to place a new place roughly.
    assert copy["places"]["state:penang"]["name"] == "Pulau Pinang"
    assert copy["places"]["country:singapura"]["country"] == "Singapore"
    # No exports: they'd be out of date after its first change. It saves itself instead.
    exports = copy["exports"]
    assert exports["gedcom"] is exports["csv"] is exports["archive"] is None
    assert exports["template"]["name"] == "ancestree-import-template.csv"
    assert copy["about"]["archive"] is False
    assert str(settings.data_dir) not in download.text

    # What it started from, kept by the app.
    about, start = read_copy(settings.data_dir, editing["id"])
    assert start == {"family": copy["family"], "stories": copy["stories"]}
    assert about == {
        "id": editing["id"],
        "for": "Mak Long",
        "title": "Keluarga Contoh",
        "file": name,
        "made_at": copy["about"]["made_at"],
        "version": copy["about"]["version"],
        "people": len(ids),
        "may": MAY,
        "hidden_living": False,
        "hidden": [],
        "locked": False,
    }

    # A view-only copy is kept nowhere.
    await copy_page(client)
    assert [path.name for path in (settings.data_dir / "copies").iterdir()] == [editing["id"]]


async def test_a_copy_to_edit_leaves_out_living_peoples_details_when_asked(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await family(client, driver, settings)
    hassan, aminah, ali = ids["Hassan bin Ismail"], ids["Aminah binti Hassan"], ids["Ali bin Rosli"]

    _, download = await copy_page(
        client, editable=True, for_name="Mak Long", hide_living=True, password=PASSWORD
    )
    copy = unseal(read_page(download.text), PASSWORD)

    texts = list(strings(copy))
    for place in LIVING_PLACES:
        assert not [text for text in texts if place in text], place
    assert not [text for text in texts if "Jurutera" in text or "badminton" in text]
    records = {person["id"]: person for person in copy["family"]["people"]}
    assert records[ali]["birth_year"] == 1980
    assert not {"birth_month", "birth_day", "occupation", "notes"} & set(records[ali])
    assert (records[hassan]["birth_month"], records[hassan]["birth_day"]) == (3, 14)
    # They can't be changed in the copy: their details aren't there to change.
    hidden = copy["about"]["editing"]["hidden"]
    assert {ali, aminah} <= set(hidden)
    assert hassan not in hidden
    assert set(copy["stories"]) == {hassan}

    # Locked, and kept as it started, with no password anywhere.
    about, start = read_copy(settings.data_dir, copy["about"]["editing"]["id"])
    assert (about["locked"], about["hidden_living"], about["hidden"]) == (True, True, hidden)
    assert start["family"] == copy["family"]
    folder = settings.data_dir / "copies" / about["id"]
    for path in folder.iterdir():
        data = path.read_bytes()
        assert b"kunci" not in (gzip.decompress(data) if path.suffix == ".gz" else data)


async def test_a_copy_to_edit_says_whom_its_for(client: httpx.AsyncClient) -> None:
    refused = await client.post(
        "/api/exports", json={"format": "copy", "editable": True, "for_name": "   "}
    )

    assert refused.status_code == 422
