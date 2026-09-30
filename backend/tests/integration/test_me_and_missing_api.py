""" "Me" and What's missing's quick fixes, M12."""

from typing import Any

import httpx
import pytest

from tests.integration.conftest import create_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def test_a_quick_fix_changes_only_what_it_gives(client: httpx.AsyncClient) -> None:
    person = await create_person(
        client, "Hassan bin Ismail", birth_date="14/3/1938", birth_place={"town": "Kota Bharu"}
    )

    response = await client.patch(f"/api/persons/{person['id']}", json={"gender": "male"})

    assert response.status_code == 200, response.text
    saved = response.json()["person"]
    assert saved["gender"] == "male"
    assert saved["birth_date"]["description"] == "14 March 1938"  # untouched
    assert saved["birth_place"]["town"] == "Kota Bharu"
    history = (await client.get("/api/history")).json()
    assert history["undo"]["label"] == "Set Hassan bin Ismail's gender"

    dated = await client.patch(
        f"/api/persons/{person['id']}", json={"birth_date": {"year": 1939, "qualifier": "about"}}
    )
    assert dated.json()["person"]["birth_date"]["description"] == "about 1939"
    assert dated.json()["person"]["gender"] == "male"


async def test_a_quick_fix_is_one_undo_step(client: httpx.AsyncClient) -> None:
    person = await create_person(client, "Aminah binti Hassan")
    await client.patch(f"/api/persons/{person['id']}", json={"gender": "female"})

    step = (await client.get("/api/history")).json()["undo"]
    undone = await client.post("/api/history/undo", params={"step": step["id"]})

    assert undone.status_code == 200, undone.text
    again = (await client.get(f"/api/persons/{person['id']}")).json()
    assert again["gender"] == "unknown"


async def test_an_empty_quick_fix_is_refused(client: httpx.AsyncClient) -> None:
    person = await create_person(client, "Karim bin Hassan")

    response = await client.patch(f"/api/persons/{person['id']}", json={})

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "nothing_to_change"


async def me(client: httpx.AsyncClient) -> dict[str, Any]:
    body: dict[str, Any] = (await client.get("/api/family/me")).json()
    return body


async def test_me_is_no_one_until_chosen_then_kept(client: httpx.AsyncClient) -> None:
    assert await me(client) == {"person": None}
    ali = await create_person(client, "Ali bin Rosli")

    chosen = await client.put("/api/family/me", json={"person": ali["id"]})

    assert chosen.status_code == 200, chosen.text
    assert await me(client) == {"person": ali["id"]}
    # Not a change to the tree: the last thing to undo is still adding Ali.
    assert (await client.get("/api/history")).json()["undo"]["label"] == "Add Ali bin Rosli"
    await client.put("/api/family/me", json={"person": None})
    assert await me(client) == {"person": None}


async def test_me_must_be_someone_real(client: httpx.AsyncClient) -> None:
    missing = await client.put(
        "/api/family/me", json={"person": "01a0dff5-0000-7000-8000-000000000000"}
    )
    assert missing.status_code == 404

    child = await create_person(client, "Siti binti Rahman")
    sister = await create_person(client, "Nor binti Rahman")
    # Two siblings with no recorded parents: an unknown parent joins them.
    await link(client, child["id"], sister["id"], "sibling")
    detail = (await client.get(f"/api/persons/{child['id']}")).json()
    [unknown] = detail["parents"]
    assert unknown["placeholder"]

    refused = await client.put("/api/family/me", json={"person": unknown["id"]})
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "not_a_person"
