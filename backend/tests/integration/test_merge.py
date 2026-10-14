"""Merging two people: someone entered twice becomes one, over HTTP. Names are the
fictional family's."""

from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image

from ancestree.config import Settings
from tests.integration.conftest import create_person, get_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def parents_of(person: dict[str, Any]) -> set[str]:
    return {parent["id"] for parent in person["parents"]}


def picture(colour: tuple[int, int, int], kind: str = "JPEG") -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (600, 400), colour).save(buffer, kind)
    return buffer.getvalue()


async def give_photo(
    client: httpx.AsyncClient, person_id: str, colour: tuple[int, int, int]
) -> None:
    sent = {"file": ("photo.jpg", picture(colour), "image/jpeg")}
    response = await client.put(f"/api/persons/{person_id}/photo", files=sent)
    assert response.status_code == 200, response.text


async def give_story(client: httpx.AsyncClient, person_id: str, words: str) -> str:
    """A story with a picture in it; returns the story as saved."""
    added = await client.post(
        f"/api/persons/{person_id}/media",
        files={"file": ("x.png", picture((200, 80, 40), "PNG"), "image/png")},
    )
    assert added.status_code == 201, added.text
    story = f"{words}\n\n![At the kampung]({added.json()['src']})"
    saved = await client.put(
        f"/api/persons/{person_id}/biography",
        json={"story": story, "sources": [], "base_version": "none"},
    )
    assert saved.status_code == 200, saved.text
    return story


async def story_of(client: httpx.AsyncClient, person_id: str) -> str:
    return str((await client.get(f"/api/persons/{person_id}/biography")).json()["story"])


def own_files(folder: Path) -> set[str]:
    """A person's own files: their photo, story and its pictures."""
    return {
        path.relative_to(folder).as_posix()
        for path in folder.rglob("*")
        if path.is_file() and path.name not in ("person.json", "journal.json")
    }


async def test_someone_entered_twice_becomes_one(client: httpx.AsyncClient) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    aminah = await create_person(client, "Aminah binti Yusof", gender="female")
    ali = await create_person(client, "Ali bin Hassan", birth_date="1975", gender="male")
    twice = await create_person(
        client, "Ali Hassan", birth_date="1976", occupation="Teacher", nickname="Li"
    )
    assert (await link(client, hassan["id"], twice["id"], "parent")).status_code == 201
    assert (await link(client, twice["id"], aminah["id"], "spouse")).status_code == 201

    preview = (await client.get(f"/api/persons/{ali['id']}/merge/{twice['id']}")).json()
    assert preview["keep_name"] == "Ali bin Hassan"
    details = {detail["label"]: detail for detail in preview["details"]}
    assert details["Born"]["taken"] is False  # Ali's own stays
    assert (details["Occupation"]["taken"], details["Occupation"]["other"]) == (True, "Teacher")
    assert {(item["description"], item["outcome"]) for item in preview["links"]} == {
        ("Parent: Hassan bin Ismail", "moved"),
        ("Spouse: Aminah binti Yusof", "moved"),
    }
    assert (preview["photo"], preview["story"]) == ("none", "none")
    still = await get_person(client, ali["id"])
    assert still["occupation"] is None  # a preview writes nothing

    merged = await client.post(f"/api/persons/{ali['id']}/merge", json={"other": twice["id"]})
    assert merged.status_code == 200, merged.text
    ali_now = await get_person(client, ali["id"])
    assert (ali_now["occupation"], ali_now["nickname"]) == ("Teacher", "Li")
    assert ali_now["birth_date"]["value"]["year"] == 1975
    assert parents_of(ali_now) == {hassan["id"]}
    assert [spouse["id"] for spouse in ali_now["spouses"]] == [aminah["id"]]
    assert (await client.get(f"/api/persons/{twice['id']}")).status_code == 404
    trash = (await client.get("/api/trash")).json()
    assert [entry["full_name"] for entry in trash] == ["Ali Hassan"]

    undone = await client.post("/api/history/undo")
    assert undone.status_code == 200, undone.text
    ali_back = await get_person(client, ali["id"])
    assert ali_back["occupation"] is None
    assert parents_of(ali_back) == set()
    twice_back = await get_person(client, twice["id"])
    assert parents_of(twice_back) == {hassan["id"]}


async def test_a_link_the_rules_refuse_stays_with_the_other(client: httpx.AsyncClient) -> None:
    mother = await create_person(client, "Siti binti Ahmad", gender="female")
    father = await create_person(client, "Hassan bin Ismail", gender="male")
    other_father = await create_person(client, "Yusof bin Daud", gender="male")
    ali = await create_person(client, "Ali bin Hassan")
    twice = await create_person(client, "Ali")
    for parent in (mother, father):
        assert (await link(client, parent["id"], ali["id"], "parent")).status_code == 201
    assert (await link(client, other_father["id"], twice["id"], "parent")).status_code == 201
    assert (await link(client, ali["id"], twice["id"], "spouse")).status_code == 201  # wrongly

    preview = (await client.get(f"/api/persons/{ali['id']}/merge/{twice['id']}")).json()
    outcomes = {item["description"]: item for item in preview["links"]}
    assert outcomes["Parent: Yusof bin Daud"]["outcome"] == "left_out"
    assert "two biological parents" in outcomes["Parent: Yusof bin Daud"]["why"]
    assert outcomes["Spouse: Ali bin Hassan"]["outcome"] == "between"

    merged = await client.post(f"/api/persons/{ali['id']}/merge", json={"other": twice["id"]})
    assert merged.status_code == 200, merged.text
    ali_now = await get_person(client, ali["id"])
    assert parents_of(ali_now) == {mother["id"], father["id"]}
    assert ali_now["spouses"] == []

    same = await client.post(f"/api/persons/{ali['id']}/merge", json={"other": ali["id"]})
    assert same.status_code == 409


async def test_undo_takes_back_the_photo_and_story_a_merge_copied(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Merged: the one kept had neither; the other's photo and story, with its picture, are
    copied over, and Undo takes them back as Redo puts them there again."""
    ali = await create_person(client, "Ali bin Hassan", birth_date="1975")
    twice = await create_person(client, "Ali Hassan")
    await give_photo(client, twice["id"], (90, 120, 200))
    story = await give_story(client, twice["id"], "Ali kept chickens behind the house.")
    kept_folder = settings.data_dir / "people" / ali["id"]

    preview = (await client.get(f"/api/persons/{ali['id']}/merge/{twice['id']}")).json()
    assert (preview["photo"], preview["story"]) == ("taken", "taken")
    merged = await client.post(f"/api/persons/{ali['id']}/merge", json={"other": twice["id"]})
    assert merged.status_code == 200, merged.text
    copied = own_files(kept_folder)
    assert any(name.startswith("profile/") for name in copied)
    assert "biography.md" in copied
    assert any(name.startswith("media/") for name in copied)
    assert (await get_person(client, ali["id"]))["photo_version"] is not None
    assert await story_of(client, ali["id"]) == story

    undone = await client.post("/api/history/undo")
    assert undone.status_code == 200, undone.text
    assert own_files(kept_folder) == set()
    assert (await get_person(client, ali["id"]))["photo_version"] is None
    assert await story_of(client, ali["id"]) == ""
    # The other is back as they were, with their own photo and story.
    assert (await get_person(client, twice["id"]))["photo_version"] is not None
    assert await story_of(client, twice["id"]) == story

    redone = await client.post("/api/history/redo")
    assert redone.status_code == 200, redone.text
    assert own_files(kept_folder) == copied
    assert await story_of(client, ali["id"]) == story
    assert (await client.get(f"/api/persons/{twice['id']}")).status_code == 404


async def test_a_merge_where_both_have_their_own_is_undone_whole(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    """Merged: a photo and a story each; the one kept keeps theirs, the other's goes
    with them to the Trash, and Undo leaves the one kept's exactly as it was."""
    ali = await create_person(client, "Ali bin Hassan")
    twice = await create_person(client, "Ali Hassan")
    await give_photo(client, ali["id"], (10, 140, 60))
    mine = await give_story(client, ali["id"], "Ali taught at the village school.")
    await give_photo(client, twice["id"], (90, 120, 200))
    theirs = await give_story(client, twice["id"], "Ali kept chickens behind the house.")
    kept_folder = settings.data_dir / "people" / ali["id"]
    before = {name: (kept_folder / name).read_bytes() for name in own_files(kept_folder)}

    preview = (await client.get(f"/api/persons/{ali['id']}/merge/{twice['id']}")).json()
    assert (preview["photo"], preview["story"]) == ("kept", "both")
    merged = await client.post(f"/api/persons/{ali['id']}/merge", json={"other": twice["id"]})
    assert merged.status_code == 200, merged.text
    assert await story_of(client, ali["id"]) == mine

    assert (await client.post("/api/history/undo")).status_code == 200
    assert {name: (kept_folder / name).read_bytes() for name in own_files(kept_folder)} == before
    assert await story_of(client, twice["id"]) == theirs
    assert (await get_person(client, twice["id"]))["photo_version"] is not None


async def test_undo_never_overwrites_a_copied_photo_changed_since(
    client: httpx.AsyncClient,
) -> None:
    """Merged: the photo copied, replaced since; Undo refuses rather than lose it."""
    ali = await create_person(client, "Ali bin Hassan")
    twice = await create_person(client, "Ali Hassan")
    await give_photo(client, twice["id"], (90, 120, 200))
    merged = await client.post(f"/api/persons/{ali['id']}/merge", json={"other": twice["id"]})
    assert merged.status_code == 200, merged.text
    await give_photo(client, ali["id"], (10, 140, 60))  # a photo change isn't an Undo step

    refused = await client.post("/api/history/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "cant_undo"
    assert "photo or story" in refused.json()["detail"]["message"]
    assert (await get_person(client, ali["id"]))["photo_version"] is not None
