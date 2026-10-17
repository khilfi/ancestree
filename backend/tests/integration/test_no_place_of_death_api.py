"""The place of death, kept but shown nowhere, through the
API on a real Neo4j. One is saved while the switch is on, as before 0.8.2; then, with it off, as
it ships: no answer holds it, the form's save and a quick fix that send one leave it as it is,
the map, a merge's list and a view-only copy say nothing of it, and a backup restores it whole.
The fictional family's names; the places are real."""

import base64
import io
import json
from typing import Any
from zipfile import ZipFile

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.domain import person as person_model
from ancestree.exchange.copies import CopyOptions, family_snapshot
from ancestree.services.context import Context
from tests.integration.conftest import create_person, get_person

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

DIED_AT = {
    "address": "Lot 12, Kampung Laut",
    "town": "Tumpat",
    "state": "Kelantan",
    "country": "Malaysia",
}


async def kept(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch, pid: str) -> Any:
    """Where they died, as the database keeps it: read with the switch on, for a moment."""
    monkeypatch.setattr(person_model, "DEATH_PLACES", True)
    try:
        return (await get_person(client, pid))["death_place"]
    finally:
        monkeypatch.setattr(person_model, "DEATH_PLACES", False)


async def hassan(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Hassan bin Ismail, who died in 2011 at a house in Tumpat: saved as 0.8.1 saved him."""
    monkeypatch.setattr(person_model, "DEATH_PLACES", True)
    saved = await create_person(
        client,
        "Hassan bin Ismail",
        gender="male",
        birth_date="1938",
        death_date="2011",
        death_place=DIED_AT,
        burial_place="Tanah Perkuburan Islam Kg. Laut",
        living=False,
    )
    monkeypatch.setattr(person_model, "DEATH_PLACES", False)
    return saved


async def test_no_answer_holds_it_but_the_date_and_where_they_rest_stay(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    him = await hassan(client, monkeypatch)

    shown = await get_person(client, him["id"])
    assert shown["death_place"] is None
    assert shown["death_date"]["value"]["year"] == 2011
    assert shown["burial_place"] == "Tanah Perkuburan Islam Kg. Laut"
    assert (await client.get("/api/health")).json()["death_places"] is False
    family = (await client.get("/api/map")).json()
    [placed] = [p for p in family["people"] if p["id"] == him["id"]]
    assert placed["died"] is None
    assert "Tumpat" not in json.dumps(family)
    held = await kept(client, monkeypatch, him["id"])  # kept, all the same
    assert (held["address"], held["town"]) == ("Lot 12, Kampung Laut", "Tumpat")


async def test_a_save_or_a_quick_fix_that_sends_one_leaves_it_as_it_is(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    him = await hassan(client, monkeypatch)
    before = await kept(client, monkeypatch, him["id"])
    assert before["town"] == "Tumpat"

    # The form's save, as the app sends it with no Where they died: null. Then another place.
    form = {"full_name": "Hassan bin Ismail", "gender": "male", "death_date": "2011"}
    for sent in (None, {"town": "Klang", "state": "Selangor", "country": "Malaysia"}):
        saved = await client.put(f"/api/persons/{him['id']}", json={**form, "death_place": sent})
        assert saved.status_code == 200, saved.text
        assert saved.json()["person"]["death_place"] is None
        assert await kept(client, monkeypatch, him["id"]) == before

    # A quick fix with only a place of death changes nothing at all; with more, only the more.
    alone = await client.patch(f"/api/persons/{him['id']}", json={"death_place": None})
    assert alone.json()["detail"]["code"] == "nothing_to_change", alone.text
    home = {"town": "Kota Bharu", "state": "Kelantan", "country": "Malaysia"}
    both = await client.patch(
        f"/api/persons/{him['id']}", json={"residence": home, "death_place": None}
    )
    assert both.status_code == 200, both.text
    assert (await get_person(client, him["id"]))["residence"]["town"] == "Kota Bharu"
    assert await kept(client, monkeypatch, him["id"]) == before


@pytest.mark.usefixtures("more_exports")  # the copy's archive, too
async def test_a_merge_takes_it_unseen_and_a_copy_holds_none(
    client: httpx.AsyncClient,
    driver: AsyncDriver,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    twice = await hassan(client, monkeypatch)
    him = await create_person(client, "Hassan Ismail", gender="male", death_date="2011")

    preview = (await client.get(f"/api/persons/{him['id']}/merge/{twice['id']}")).json()
    assert "Death place" not in [detail["label"] for detail in preview["details"]]
    merged = await client.post(f"/api/persons/{him['id']}/merge", json={"other": twice["id"]})
    assert merged.status_code == 200, merged.text
    assert (await kept(client, monkeypatch, him["id"]))["town"] == "Tumpat"

    # His person.json, on this computer, keeps it as the database does; the one merged into
    # him is in the Trash, with it in its tombstone.
    snapshot = settings.data_dir / "people" / him["id"] / "person.json"
    assert json.loads(snapshot.read_text("utf-8"))["death_place"]["town"] == "Tumpat"
    assert any(b"Tumpat" in path.read_bytes() for path in settings.data_dir.rglob("*.json"))

    ctx = Context(driver, settings.neo4j_database, settings.data_dir)
    for options in (CopyOptions(), CopyOptions(hide_living=True)):
        copy = await family_snapshot(ctx, options)
        assert "Tumpat" not in json.dumps(copy)
        assert "Kampung Laut" not in json.dumps(copy)
    assert copy["health"]["death_places"] is False
    # The full archive among the copy's exports, which a relative can open: none in any file,
    # the Trash's too, though it's a backup in every other way.
    shown = await family_snapshot(ctx, CopyOptions())
    archive = ZipFile(io.BytesIO(base64.b64decode(shown["exports"]["archive"]["data"])))
    assert "trash/" in "".join(archive.namelist())
    for name in archive.namelist():
        assert b"Tumpat" not in archive.read(name), name
    graph = json.loads(archive.read("graph.json"))
    [merged_him] = [p for p in graph["people"] if p["id"] == him["id"]]
    assert merged_him["death_town"] is None
    assert merged_him["death_year"] == 2011


async def test_a_backup_restores_it_whole(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    him = await hassan(client, monkeypatch)
    before = await kept(client, monkeypatch, him["id"])
    made = await client.post("/api/exports", json={"format": "archive"})
    assert made.status_code == 201, made.text
    monkeypatch.setattr(person_model, "DEATH_PLACES", True)
    cleared = await client.patch(f"/api/persons/{him['id']}", json={"death_place": None})
    assert cleared.status_code == 200, cleared.text
    monkeypatch.setattr(person_model, "DEATH_PLACES", False)
    assert await kept(client, monkeypatch, him["id"]) is None

    restored = await client.post(f"/api/backups/{made.json()['name']}/restore")

    assert restored.status_code == 200, restored.text
    assert await kept(client, monkeypatch, him["id"]) == before
