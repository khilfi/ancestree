import asyncio
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image

from ancestree.config import Settings
from ancestree.storage import biography as storage
from tests.integration.conftest import create_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

FIVE_PARAGRAPHS = """## Early life

Hassan was born in Kota Bharu in 1938, the eldest of four children.

He went to school in the town, walking there with his brothers **every morning**.

## Work

He worked on the railway for thirty years, from *1958* until he retired.

- Station master at Kuala Krai
- Then at Gemas

> "The trains were never late when Acan was on duty," his friends used to say.

He died in 2011, surrounded by his family.
"""


def png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (2400, 1600), (90, 120, 200)).save(buffer, "PNG")
    return buffer.getvalue()


async def save(
    client: httpx.AsyncClient, person_id: str, story: str, sources: list[str], base: str
) -> httpx.Response:
    return await client.put(
        f"/api/persons/{person_id}/biography",
        json={"story": story, "sources": sources, "base_version": base},
    )


async def test_a_five_paragraph_story_with_a_picture_saves_and_reads_back(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    person = await create_person(client, "Hassan bin Ismail")
    folder = settings.data_dir / "people" / person["id"]
    empty = (await client.get(f"/api/persons/{person['id']}/biography")).json()
    assert empty == {"story": "", "sources": [], "version": "none"}

    added = await client.post(
        f"/api/persons/{person['id']}/media", files={"file": ("x.png", png(), "image/png")}
    )
    assert added.status_code == 201, added.text
    src = added.json()["src"]
    story = FIVE_PARAGRAPHS + f"\n![Hassan at Gemas]({src})\n"
    saved = await save(
        client, person["id"], story, ["Birth certificate", "Talk with Nor, 2019"], "none"
    )

    assert saved.status_code == 200, saved.text
    # Plain Markdown on disk, readable in Notepad: the story, then the Sources.
    on_disk = (folder / "biography.md").read_text(encoding="utf-8")
    assert on_disk == (
        story.strip() + "\n\n## Sources\n\n- Birth certificate\n- Talk with Nor, 2019\n"
    )
    again = (await client.get(f"/api/persons/{person['id']}/biography")).json()
    assert again["story"] == story.strip()
    assert again["sources"] == ["Birth certificate", "Talk with Nor, 2019"]
    assert again["version"] == saved.json()["version"]
    picture = await client.get(f"/api/persons/{person['id']}/{src}")
    assert picture.headers["content-type"] == "image/webp"
    assert max(Image.open(BytesIO(picture.content)).size) == 1600


async def test_a_file_changed_outside_the_app_is_not_overwritten_unseen(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    person = await create_person(client, "Aminah binti Hassan")
    first = (await save(client, person["id"], "First words.", [], "none")).json()
    path = settings.data_dir / "people" / person["id"] / "biography.md"
    path.write_text("Edited in Obsidian.\n", encoding="utf-8")

    stale = await save(client, person["id"], "My typing.", [], first["version"])

    assert stale.status_code == 409
    detail: dict[str, Any] = stale.json()["detail"]
    assert detail["code"] == "changed_outside"
    assert detail["story"] == "Edited in Obsidian."
    assert path.read_text(encoding="utf-8") == "Edited in Obsidian.\n"
    # Keeping one's own version is a save based on the file as it is now.
    kept = await save(client, person["id"], "My typing.", [], detail["version"])
    assert kept.status_code == 200
    assert path.read_text(encoding="utf-8") == "My typing.\n"


async def test_emptying_a_story_removes_the_file(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    person = await create_person(client, "Zul")
    first = (await save(client, person["id"], "Something.", [], "none")).json()

    emptied = await save(client, person["id"], "", [], first["version"])

    assert emptied.json()["version"] == "none"
    assert not (settings.data_dir / "people" / person["id"] / "biography.md").exists()


async def test_stories_need_a_real_person(client: httpx.AsyncClient) -> None:
    missing = await client.get("/api/persons/01a0e019-0000-7000-8000-000000000000/biography")
    assert missing.status_code == 404
    child = await create_person(client, "Umar")
    sister = await create_person(client, "Hana")
    await link(client, child["id"], sister["id"], "sibling")  # an unknown parent joins them
    graph = (await client.get("/api/graph")).json()
    unknown = next(p for p in graph["people"] if p["placeholder"])

    refused = await save(client, unknown["id"], "A story.", [], "none")

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "placeholder"


async def test_only_the_storys_own_pictures_are_served(client: httpx.AsyncClient) -> None:
    person = await create_person(client, "Siti")
    base = f"/api/persons/{person['id']}/media"

    assert (await client.get(f"{base}/nothing.webp")).status_code == 404
    assert (await client.get(f"{base}/..%2Fperson.json")).status_code == 404
    bad = await client.post(base, files={"file": ("x.png", b"not a picture", "image/png")})
    assert bad.status_code == 422


async def test_a_story_saved_as_its_person_goes_to_the_trash_goes_with_them(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Closing the panel saves what was typed, just as "Move to Trash" moves the folder away.
    person = await create_person(client, "Latif")
    first = (await save(client, person["id"], "Started.", [], "none")).json()
    write_story = storage.write_story

    def slow_write(data_dir: Path, person_id: str, text: str) -> None:
        time.sleep(0.3)
        write_story(data_dir, person_id, text)

    monkeypatch.setattr(storage, "write_story", slow_write)
    saving = asyncio.create_task(save(client, person["id"], "Finished.", [], first["version"]))
    await asyncio.sleep(0.05)  # the save is writing

    deleted = await client.delete(f"/api/persons/{person['id']}")

    assert (await saving).status_code == 200
    # Nothing written back into people/ after the folder left for the Trash...
    assert not (settings.data_dir / "people" / person["id"]).exists()
    # ...and restoring brings back the story as last saved.
    await client.post(f"/api/trash/{deleted.json()['entry']}/restore")
    back = (await client.get(f"/api/persons/{person['id']}/biography")).json()
    assert back["story"] == "Finished."


async def test_the_story_goes_to_the_trash_and_comes_back(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    person = await create_person(client, "Rahman")
    await save(client, person["id"], "His story.", ["A letter"], "none")

    entry = (await client.delete(f"/api/persons/{person['id']}")).json()["entry"]
    assert not (settings.data_dir / "people" / person["id"] / "biography.md").exists()
    await client.post(f"/api/trash/{entry}/restore")

    back = (await client.get(f"/api/persons/{person['id']}/biography")).json()
    assert (back["story"], back["sources"]) == ("His story.", ["A letter"])
