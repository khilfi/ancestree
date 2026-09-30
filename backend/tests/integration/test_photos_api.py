import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from ancestree.config import Settings
from tests.integration.conftest import create_person, get_person

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def jpeg(size: tuple[int, int] = (600, 400)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", size, (90, 120, 200)).save(buffer, "JPEG")
    return buffer.getvalue()


async def upload(
    client: httpx.AsyncClient, person_id: str, crop: dict[str, float] | None = None
) -> httpx.Response:
    data = {"crop": json.dumps(crop)} if crop else {}
    files = {"file": ("photo.jpg", jpeg(), "image/jpeg")}
    return await client.put(f"/api/persons/{person_id}/photo", files=files, data=data)


async def test_upload_serve_replace_recrop_and_remove(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    person = await create_person(client, "Hassan bin Ismail")
    profile = settings.data_dir / "people" / person["id"] / "profile"

    uploaded = await upload(client, person["id"], {"x": 10, "y": 10, "width": 50, "height": 75})

    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["photo_version"] == 1
    names = {p.name for p in profile.iterdir()}
    assert names >= {
        "original.jpg",
        "crop.json",
        "display.webp",
        "avatar-128.webp",
        "avatar-512.webp",
    }
    avatar = await client.get(
        f"/api/persons/{person['id']}/photo/avatar", params={"size": 512, "v": 1}
    )
    assert avatar.headers["content-type"] == "image/webp"
    assert "immutable" in avatar.headers["cache-control"]
    assert Image.open(BytesIO(avatar.content)).size == (512, 512)
    graph = (await client.get("/api/graph")).json()
    assert [p["photo_version"] for p in graph["people"]] == [1]
    crop = await client.get(f"/api/persons/{person['id']}/photo/crop")
    assert crop.json() == {"x": 10, "y": 10, "width": 50, "height": 75}

    replaced = await upload(client, person["id"])
    assert replaced.json()["photo_version"] == 2
    assert len(list((profile / "previous").glob("*-original.jpg"))) == 1  # the old one is kept

    recropped = await client.put(
        f"/api/persons/{person['id']}/photo/crop",
        json={"x": 0, "y": 0, "width": 100, "height": 100},
    )
    assert recropped.json()["photo_version"] == 3

    removed = await client.delete(f"/api/persons/{person['id']}/photo")
    assert removed.json()["photo_version"] is None
    gone = await client.get(f"/api/persons/{person['id']}/photo/avatar")
    assert gone.status_code == 404
    assert (await client.get(f"/api/persons/{person['id']}/photo/crop")).status_code == 404
    assert len(list((profile / "previous").glob("*-original.jpg"))) == 2


async def test_a_file_that_is_not_a_photo_is_refused(client: httpx.AsyncClient) -> None:
    person = await create_person(client, "Hassan bin Ismail")

    response = await client.put(
        f"/api/persons/{person['id']}/photo",
        files={"file": ("notes.jpg", b"this is not a picture", "image/jpeg")},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "bad_photo"
    assert (await get_person(client, person["id"]))["photo_version"] is None
