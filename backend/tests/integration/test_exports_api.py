"""Exports as downloads, and backups."""

import csv
import io
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.exchange.spreadsheet import COLUMNS
from ancestree.main import create_app
from tests.integration.conftest import create_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


@asynccontextmanager
async def app_with(settings: Settings, **changes: object) -> AsyncIterator[httpx.AsyncClient]:
    """The app with other settings, e.g. a backup folder of its own."""
    app = create_app(settings.model_copy(update=changes))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


async def small_family(client: httpx.AsyncClient) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", birth_date="1938")
    mariam = await create_person(client, "Mariam binti Salleh", gender="female")
    yusof = await create_person(client, "Yusof bin Hassan", gender="male", birth_date="1965")
    await link(client, hassan["id"], mariam["id"], "spouse")
    for parent in (hassan, mariam):
        await link(client, parent["id"], yusof["id"], "parent")


async def make(client: httpx.AsyncClient, export_format: str) -> httpx.Response:
    made = await client.post("/api/exports", json={"format": export_format})
    assert made.status_code == 201, made.text
    download = await client.get(f"/api/exports/{made.json()['name']}")
    assert download.status_code == 200
    assert download.headers["content-disposition"].startswith("attachment;")
    assert int(made.json()["size"]) == len(download.content)
    return download


async def test_gedcom_downloads_with_the_family_in_it(client: httpx.AsyncClient) -> None:
    await small_family(client)

    text = (await make(client, "gedcom")).content.decode("utf-8")

    assert text.startswith("0 HEAD\r\n")
    assert text.endswith("0 TRLR\r\n")
    assert text.count(" INDI\r\n") == 3
    assert text.count(" FAM\r\n") == 1
    assert "1 NAME Yusof bin Hassan\r\n" in text


async def test_the_spreadsheet_downloads_for_excel(client: httpx.AsyncClient) -> None:
    await small_family(client)

    data = (await make(client, "csv")).content

    assert data.startswith(b"\xef\xbb\xbf")  # the byte-order mark Excel looks for
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"), newline="")))
    assert rows[0] == list(COLUMNS)
    yusof = next(row for row in rows if row[1] == "Yusof bin Hassan")
    assert yusof[COLUMNS.index("Parents")] == (
        "Hassan bin Ismail (father); Mariam binti Salleh (mother)"
    )


async def test_backups_are_listed_and_can_be_brought_in_from_elsewhere(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    await small_family(client)
    archive = await make(client, "archive")
    [listed] = (await client.get("/api/backups")).json()["backups"]
    assert (listed["people"], listed["links"]) == (3, 3)
    # A copy from another disk: the same archive isn't kept twice...
    again = await client.post(
        "/api/backups", files={"file": ("copy.zip", archive.content, "application/zip")}
    )
    assert again.status_code == 201, again.text
    assert again.json()["name"] == listed["name"]
    assert len((await client.get("/api/backups")).json()["backups"]) == 1
    # ...and other exports aren't backups.
    await make(client, "gedcom")
    assert len((await client.get("/api/backups")).json()["backups"]) == 1


async def test_a_backup_counts_people_as_the_app_does(client: httpx.AsyncClient) -> None:
    umar = await create_person(client, "Umar")
    hana = await create_person(client, "Hana")
    await link(client, umar["id"], hana["id"], "sibling")  # an unknown parent joins them

    await make(client, "archive")

    [backup] = (await client.get("/api/backups")).json()["backups"]
    assert backup["people"] == 2  # the unknown parent isn't one of them


async def test_backups_go_to_the_backup_folder_and_older_ones_stay_listed(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    folder = tmp_path / "second disk" / "AncesTree-backups"
    async with app_with(settings) as before:  # no backup folder set: DATA_DIR/exports
        await small_family(before)
        older = await make(before, "archive")
    async with app_with(settings, backup_dir=folder) as client:
        made = await client.post("/api/exports", json={"format": "archive"})
        gedcom = await client.post("/api/exports", json={"format": "gedcom"})

        listing = (await client.get("/api/backups")).json()
        # The safety copy made before a restore goes there too.
        restored = await client.post(f"/api/backups/{made.json()['name']}/restore")

    assert (folder / made.json()["name"]).is_file()
    assert (settings.data_dir / "exports" / gedcom.json()["name"]).is_file()  # not a backup
    assert (listing["folder"], listing["reachable"]) == (str(folder), True)
    assert [b["folder"] for b in listing["backups"]] == [
        str(folder),
        str(settings.data_dir / "exports"),
    ]
    assert older.headers["content-disposition"]
    assert restored.status_code == 200, restored.text
    assert (folder / restored.json()["backup"]).is_file()


async def test_a_backup_folder_that_cant_be_reached_is_said_so(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    blocker = tmp_path / "not a folder"
    blocker.write_text("a file where the folder should be", encoding="utf-8")
    async with app_with(settings, backup_dir=blocker / "backups") as client:
        refused = await client.post("/api/exports", json={"format": "archive"})
        listing = (await client.get("/api/backups")).json()

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "backup_folder"
    assert "can't be reached" in refused.json()["detail"]["message"]
    assert listing["reachable"] is False


async def test_only_backup_archives_are_taken_in(client: httpx.AsyncClient) -> None:
    for data in (b"not a zip", b"PK\x05\x06" + bytes(18)):  # the second: an empty zip
        response = await client.post(
            "/api/backups", files={"file": ("x.zip", data, "application/zip")}
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "bad_archive"
    assert (await client.get("/api/backups")).json()["backups"] == []


async def test_nothing_but_exports_can_be_downloaded(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    (settings.data_dir / "secret.csv").write_text("not an export", encoding="utf-8")

    for name in ("..%2Fsecret.csv", "nothing.zip", "..", ".env"):
        assert (await client.get(f"/api/exports/{name}")).status_code == 404
    assert (await client.post("/api/backups/secret.csv/restore")).status_code == 404
