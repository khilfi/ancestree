"""The family folder over HTTP: its status, and a relative's computer keeping the family
as the keeper sends it, with only its own choices open to change."""

from pathlib import Path
from typing import Any

import httpx
import pytest

from ancestree.familyfolder import google
from ancestree.familyfolder.computers import Member
from ancestree.services.familyfolder import Setup
from tests.integration.conftest import create_person

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


@pytest.fixture(autouse=True)
def no_google_client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """None of the maintainer's own: the tests never reach Google."""
    monkeypatch.setattr(google, "BUILT_IN", tmp_path / "none.json")
    monkeypatch.setattr(google, "OWN_COPY", tmp_path / "none.json")
    monkeypatch.delenv("ANCESTREE_GOOGLE_CLIENT", raising=False)


def app_folder(client: httpx.AsyncClient) -> Any:
    transport: Any = client._transport
    return transport.app.state.family_folder


async def test_a_new_computer_takes_part_in_no_family_folder(client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/family-folder")).json()
    assert body["setup"] is None
    assert body["email"] is None
    assert body["available"] is False
    refused = await client.post("/api/family-folder/sign-in")
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "no_google_client"
    start = await client.post(
        "/api/family-folder/start", json={"family": "Keluarga Contoh", "computer": "PC"}
    )
    assert start.json()["detail"]["code"] == "signed_out"


async def test_a_relatives_computer_changes_only_its_own_choices(
    client: httpx.AsyncClient,
) -> None:
    ali = await create_person(client, "Ali bin Hassan")
    app_folder(client).setup = Setup(
        "member", "folder-id", "Keluarga Contoh", "PC", "x@example.com"
    )

    refused = [
        await client.post("/api/persons", json={"full_name": "Someone new"}),
        await client.patch(f"/api/persons/{ali['id']}", json={"nickname": "Li"}),
        await client.post("/api/history/undo"),
        await client.put("/api/places/pins", json={"pins": []}),
        await client.post("/api/relationship-kinds", json={"label": "Guardian"}),
        await client.post("/api/backups/ancestree-backup-x.zip/restore"),
    ]
    assert [r.status_code for r in refused] == [409] * len(refused)
    assert {r.json()["detail"]["code"] for r in refused} == {"kept_by_the_keeper"}

    allowed = [
        await client.get("/api/persons"),
        await client.put("/api/family/me", json={"person": ali["id"]}),
        await client.get(f"/api/persons/{ali['id']}"),
    ]
    assert [r.status_code for r in allowed] == [200, 200, 200]
    preview = await client.post("/api/imports/preview")
    assert preview.status_code != 409  # a preview changes nothing

    app_folder(client).setup = None  # the keeper's, or no family folder: everything opens
    assert (await client.post("/api/persons", json={"full_name": "Someone new"})).status_code == 201


async def test_a_relatives_computer_that_sends_changes_makes_them_here(
    client: httpx.AsyncClient, tmp_path: Path
) -> None:
    """People, links, Undo and the Trash change here and wait for the keeper; the
    family's own settings, imports and restoring a backup stay the keeper's."""
    ali = await create_person(client, "Ali bin Hassan")
    folder = app_folder(client)
    folder.setup = Setup("member", "folder-id", "Keluarga Contoh", "PC", "x@example.com")
    member = Member(tmp_path / "folder", tmp_path / "computer")
    member.role = "contributor"
    folder.computer = member

    allowed = [
        await client.post("/api/persons", json={"full_name": "Aminah binti Ali"}),
        await client.patch(f"/api/persons/{ali['id']}", json={"gender": "male"}),
        await client.post("/api/history/undo"),
    ]
    assert [r.status_code for r in allowed] == [201, 200, 200]
    refused = [
        await client.put("/api/places/pins", json={"pins": []}),
        await client.post("/api/relationship-kinds", json={"label": "Guardian"}),
        await client.post("/api/backups/ancestree-backup-x.zip/restore"),
        await client.post("/api/imports"),
    ]
    assert [r.status_code for r in refused] == [409] * len(refused)
    assert {r.json()["detail"]["code"] for r in refused} == {"kept_by_the_keeper"}

    member.role = "viewer"  # a viewer's computer changes nothing
    viewer = await client.post("/api/persons", json={"full_name": "Someone new"})
    assert viewer.status_code == 409


async def test_who_changed_someone_is_in_their_journal(client: httpx.AsyncClient) -> None:
    """With no family folder, this computer's changes are its own."""
    ali = await create_person(client, "Ali bin Hassan")
    await client.put(
        f"/api/persons/{ali['id']}", json={"full_name": "Ali bin Hassan", "nickname": "Li"}
    )
    lines = (await client.get(f"/api/persons/{ali['id']}/journal")).json()
    assert len(lines) == 2
    assert all(line["by"] == "" and line["from_computer"] is None for line in lines)
    await client.post("/api/history/undo")
    lines = (await client.get(f"/api/persons/{ali['id']}/journal")).json()
    assert lines[0]["what"].startswith("Undid: ")
