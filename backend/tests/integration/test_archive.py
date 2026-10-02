"""Backups and restoring them: export → restore → export
gives an identical result, and a bad archive changes nothing."""

import hashlib
import json
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid7
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pytest
from neo4j import AsyncDriver
from PIL import Image

from ancestree.config import Settings
from ancestree.exchange.backup import create_backup
from ancestree.services.context import Context
from tests.integration.conftest import create_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (400, 300), (40, 120, 90)).save(buffer, "PNG")
    return buffer.getvalue()


async def snapshot(ctx: Context) -> tuple[dict[str, Any], dict[str, str]]:
    """Everything, as a backup holds it: the graph, and a checksum for every file."""
    backup = await create_backup(ctx.driver, ctx.database, ctx.data_dir, ctx.data_dir / "exports")
    with ZipFile(backup.path) as archive:
        graph = json.loads(archive.read("graph.json"))
        manifest = json.loads(archive.read("manifest.json"))
    backup.path.unlink()  # only taken to compare
    files = {name: digest for name, digest in manifest["sha256"].items() if name != "graph.json"}
    return graph, files


async def build_tree(client: httpx.AsyncClient) -> dict[str, str]:
    """A small tree made through the app: links, a photo, a story, settings and the Trash."""
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", birth_date="12/3/1938")
    mariam = await create_person(client, "Mariam binti Salleh", gender="female")
    yusof = await create_person(client, "Yusof bin Hassan", gender="male")
    zul = await create_person(client, "Zul")
    assert (await link(client, hassan["id"], mariam["id"], "spouse")).status_code == 201
    for parent in (hassan, mariam):
        assert (await link(client, parent["id"], yusof["id"], "parent")).status_code == 201
    photo = await client.put(
        f"/api/persons/{hassan['id']}/photo", files={"file": ("h.png", png(), "image/png")}
    )
    assert photo.status_code == 200, photo.text
    story = {"story": "He worked on the railway.", "sources": ["A letter"], "base_version": "none"}
    assert (await client.put(f"/api/persons/{hassan['id']}/biography", json=story)).is_success
    centre = {"centre": hassan["id"], "colours": "generation"}
    assert (await client.put("/api/settings", json=centre)).is_success
    assert (await client.delete(f"/api/persons/{zul['id']}")).is_success
    return {"hassan": hassan["id"], "mariam": mariam["id"], "yusof": yusof["id"]}


async def test_restoring_a_backup_brings_back_exactly_what_it_holds(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ctx = Context(driver, settings.neo4j_database, settings.data_dir)
    ids = await build_tree(client)
    made = await client.post("/api/exports", json={"format": "archive"})
    assert made.status_code == 201, made.text
    before = await snapshot(ctx)
    # Then everything changes: someone new, a story rewritten, a link gone, other settings.
    await create_person(client, "Aminah")
    version = (await client.get(f"/api/persons/{ids['hassan']}/biography")).json()["version"]
    rewrite = {"story": "Rewritten.", "sources": [], "base_version": version}
    await client.put(f"/api/persons/{ids['hassan']}/biography", json=rewrite)
    [spouse] = (await client.get(f"/api/persons/{ids['hassan']}")).json()["spouses"]
    await client.delete(f"/api/relationships/{spouse['link_id']}")
    await client.put("/api/settings", json={"centre": None, "colours": "off"})
    changed = await snapshot(ctx)
    assert changed != before

    restored = await client.post(f"/api/backups/{made.json()['name']}/restore")

    assert restored.status_code == 200, restored.text
    after = await snapshot(ctx)
    assert after[0] == before[0]  # people, links and kinds, timestamps included
    assert after[1] == before[1]  # every file, byte for byte
    body = restored.json()
    assert (body["people"], body["links"]) == (len(before[0]["people"]), len(before[0]["links"]))
    # What was replaced is kept: the backup made just before holds the changed tree.
    with ZipFile(settings.data_dir / "exports" / body["backup"]) as archive:
        graph = json.loads(archive.read("graph.json"))
    assert "Aminah" in {person["full_name"] for person in graph["people"]}
    leftovers = [p.name for p in settings.data_dir.iterdir() if p.name.startswith(".")]
    assert leftovers == []
    # And the app works on it: the story reads back, the photo is served.
    story = (await client.get(f"/api/persons/{ids['hassan']}/biography")).json()
    assert story["story"] == "He worked on the railway."
    avatar = await client.get(f"/api/persons/{ids['hassan']}/photo/avatar?size=128")
    assert avatar.status_code == 200


async def test_a_backup_with_copies_to_edit_restores_without_their_records(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Backups made while there were copies to edit hold copies/, what each started from.
    They restore as ever, and the records are left out: nothing reads them now."""
    good = await a_backup(client, settings)
    older = good.with_name("ancestree-backup-with-copies.zip")
    name = f"copies/{uuid7()}/about.json"
    record = json.dumps({"for": "Mak Long"}).encode()
    with ZipFile(good) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    manifest["sha256"][name] = hashlib.sha256(record).hexdigest()
    rezip(good, older, {name: record, "manifest.json": json.dumps(manifest).encode()})

    restored = await client.post(f"/api/backups/{older.name}/restore")

    assert restored.status_code == 200, restored.text
    assert not (settings.data_dir / "copies").exists()


async def test_restoring_into_an_empty_tree_backs_nothing_up(
    client: httpx.AsyncClient, settings: Settings, driver: AsyncDriver
) -> None:
    good = await a_backup(client, settings)
    async with driver.session(database=settings.neo4j_database) as session:
        await session.run("MATCH (p:Person) DETACH DELETE p")
    before = sorted(p.name for p in (settings.data_dir / "exports").glob("*.zip"))

    restored = await client.post(f"/api/backups/{good.name}/restore")

    assert restored.status_code == 200, restored.text
    assert restored.json()["backup"] == ""  # nothing to keep
    assert sorted(p.name for p in (settings.data_dir / "exports").glob("*.zip")) == before


def rezip(source: Path, target: Path, change: dict[str, bytes | None]) -> None:
    """A copy of an archive with some entries replaced, added, or (None) left out."""
    with ZipFile(source) as old, ZipFile(target, "w", compression=ZIP_DEFLATED) as new:
        for info in old.infolist():
            if info.filename not in change:
                new.writestr(info.filename, old.read(info.filename))
        for name, data in change.items():
            if data is not None:
                new.writestr(name, data)


async def refused(client: httpx.AsyncClient, settings: Settings, archive: Path) -> str:
    """Restore `archive` (in the exports folder); it must be refused with nothing changed.
    Returns the message."""
    zips_before = sorted(p.name for p in (settings.data_dir / "exports").glob("*.zip"))
    graph_before = (await client.get("/api/graph")).json()

    response = await client.post(f"/api/backups/{archive.name}/restore")

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "bad_archive"
    assert (await client.get("/api/graph")).json() == graph_before
    # Refused before anything was backed up, replaced or unpacked.
    assert sorted(p.name for p in (settings.data_dir / "exports").glob("*.zip")) == zips_before
    assert [p.name for p in settings.data_dir.iterdir() if p.name.startswith(".")] == []
    message: str = response.json()["detail"]["message"]
    return message


async def a_backup(client: httpx.AsyncClient, settings: Settings) -> Path:
    await build_tree(client)
    made = (await client.post("/api/exports", json={"format": "archive"})).json()
    return settings.data_dir / "exports" / str(made["name"])


async def test_a_damaged_archive_changes_nothing(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    good = await a_backup(client, settings)
    with ZipFile(good) as archive:
        story = next(n for n in archive.namelist() if n.endswith("biography.md"))
    damaged = good.with_name("damaged.zip")
    rezip(good, damaged, {story: b"Not what was saved."})

    assert "doesn't match its checksum" in await refused(client, settings, damaged)


async def test_an_archive_cannot_put_files_outside_the_data_folder(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    good = await a_backup(client, settings)
    with ZipFile(good) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    evil = b"not yours"
    manifest["sha256"]["people/../../outside.txt"] = hashlib.sha256(evil).hexdigest()
    crafted = good.with_name("crafted.zip")
    rezip(
        good,
        crafted,
        {"people/../../outside.txt": evil, "manifest.json": json.dumps(manifest).encode()},
    )

    assert "unexpected place" in await refused(client, settings, crafted)
    assert not (settings.data_dir.parent / "outside.txt").exists()


async def test_an_archive_that_doesnt_hang_together_is_refused(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    good = await a_backup(client, settings)
    with ZipFile(good) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        graph = json.loads(archive.read("graph.json"))
    graph["links"][0]["target"] = "01a0e0c2-0000-7000-8000-000000000000"  # nobody
    data = json.dumps(graph).encode()
    manifest["sha256"]["graph.json"] = hashlib.sha256(data).hexdigest()
    broken = good.with_name("broken.zip")
    rezip(good, broken, {"graph.json": data, "manifest.json": json.dumps(manifest).encode()})

    assert "points to someone who isn't there" in await refused(client, settings, broken)


async def test_an_archive_from_a_newer_ancestree_is_refused(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    good = await a_backup(client, settings)
    with ZipFile(good) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    manifest["schema_version"] = 99
    newer = good.with_name("newer.zip")
    rezip(good, newer, {"manifest.json": json.dumps(manifest).encode()})

    assert "newer AncesTree" in await refused(client, settings, newer)
