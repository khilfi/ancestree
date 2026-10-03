"""The family folder over HTTP: its status, and a relative's computer keeping the family
as the keeper sends it, with only its own choices open to change."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from ancestree.familyfolder.computers import Member
from ancestree.familyfolder.google import Client
from ancestree.familyfolder.invitations import Invitation
from ancestree.services.familyfolder import Setup
from tests.integration.conftest import create_person

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


@pytest.fixture(autouse=True)
def no_google_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """None named while developing: the family has its own, or none (0.4.0), and the tests
    never reach Google."""
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
    leave = await client.post("/api/family-folder/leave")
    assert (leave.status_code, leave.json()["detail"]["code"]) == (409, "no_family_folder")
    code = await client.post("/api/family-folder/new-recovery-code")
    assert (code.status_code, code.json()["detail"]["code"]) == (409, "signed_out")
    assert body["may_leave"] is False


CLIENT_FILE = json.dumps(
    {
        "installed": {
            "client_id": "123456789012-ourclient.apps.googleusercontent.com",
            "project_id": "keluarga-contoh",
            "client_secret": "made-up-secret",
        }
    }
)


async def test_the_familys_own_project_and_an_invitation(client: httpx.AsyncClient) -> None:
    """A family's Google project, from its client's file, or a keeper's invitation (0.4.0)."""
    refused = await client.post("/api/family-folder/project", json={"client": "{}"})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "not_a_client_file")
    body = (await client.post("/api/family-folder/project", json={"client": CLIENT_FILE})).json()
    assert (body["available"], body["project"], body["project_invited"]) == (
        True,
        "keluarga-contoh",
        False,
    )
    asked = await client.get("/api/family-folder/invitation")
    assert (asked.status_code, asked.json()["detail"]["code"]) == (409, "not_the_keeper")

    pasted = await client.post("/api/family-folder/invitation", json={"invitation": "Hello"})
    assert (pasted.status_code, pasted.json()["detail"]["code"]) == (409, "not_an_invitation")
    invitation = Invitation(
        Client("987654321098-theirs.apps.googleusercontent.com", "s", "keluarga-lain"),
        "3f9c0a1b2c3d4e5f",
    )
    body = (
        await client.post("/api/family-folder/invitation", json={"invitation": invitation.text()})
    ).json()
    assert (body["project"], body["project_invited"], body["invited"]) == (
        "keluarga-lain",
        True,
        True,
    )
    join = await client.post("/api/family-folder/join", json={"computer": "Mak Long's laptop"})
    assert (join.status_code, join.json()["detail"]["code"]) == (409, "signed_out")


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


async def test_the_familys_titles_are_the_keepers_and_the_language_each_computers(
    client: httpx.AsyncClient,
) -> None:
    """On a relative's computer, the Malay titles arrive from the keeper, as the family's;
    the kinship language is its own (0.3.1)."""
    app_folder(client).setup = Setup(
        "member", "folder-id", "Keluarga Contoh", "PC", "x@example.com"
    )
    now = (await client.get("/api/kinship/settings")).json()
    titles = await client.put(
        "/api/kinship/settings", json={**now, "titles": ["long", "ngah", "andak"]}
    )
    assert (titles.status_code, titles.json()["detail"]["code"]) == (409, "kept_by_the_keeper")
    language = await client.put("/api/kinship/settings", json={**now, "language": "ms"})
    assert (language.status_code, language.json()["language"]) == (200, "ms")

    app_folder(client).setup = None  # the keeper's, or no family folder: the titles are its own
    titles = await client.put(
        "/api/kinship/settings", json={**now, "titles": ["long", "ngah", "andak"]}
    )
    assert titles.status_code == 200
