from typing import Any

import httpx
import pytest

from ancestree.config import Settings
from tests.integration.conftest import create_person, get_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def test_create_edit_and_find_a_person(client: httpx.AsyncClient) -> None:
    person = await create_person(
        client,
        "  Hassan   bin Ismail ",
        nickname="",
        gender="male",
        birth_date="14/3/1938",
        birth_place={"town": "Kota Bharu", "state": "Kelantan"},
        residence={"town": "", "state": ""},
    )

    assert person["full_name"] == "Hassan bin Ismail"
    assert person["nickname"] is None
    assert person["birth_date"]["text"] == "14/3/1938"
    assert person["birth_date"]["description"] == "14 March 1938"
    assert person["birth_place"] == {
        "town": "Kota Bharu",
        "state": "Kelantan",
        "country": "Malaysia",
    }
    assert person["residence"] is None

    response = await client.put(
        f"/api/persons/{person['id']}",
        json={
            "full_name": "Hassan bin Ismail",
            "gender": "male",
            "birth_date": "c. 1938",
            "death_date": "2011",
        },
    )
    updated = response.json()["person"]
    assert updated["birth_date"]["description"] == "about 1938"
    assert updated["is_living"] is False

    found = (await client.get("/api/persons", params={"q": "hass ism"})).json()
    assert [p["full_name"] for p in found] == ["Hassan bin Ismail"]


async def test_an_unreadable_date_is_refused_on_its_field(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/persons", json={"full_name": "X", "birth_date": "30/2/1950"})

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "birth_date"]
    assert "no day 30" in error["msg"]


async def test_dates_arrive_as_parts_from_the_date_picker(client: httpx.AsyncClient) -> None:
    person = await create_person(
        client,
        "Hassan bin Ismail",
        birth_date={"year": 1938, "month": 3, "day": 14, "qualifier": "exact", "year_to": None},
        death_date={"year": 2010, "year_to": 2012, "qualifier": "between"},
    )

    assert person["birth_date"]["description"] == "14 March 1938"
    assert person["birth_date"]["text"] == "14/3/1938"
    assert person["death_date"]["description"] == "between 2010 and 2012"

    response = await client.post(
        "/api/persons", json={"full_name": "X", "birth_date": {"year": 1950, "month": 2, "day": 30}}
    )
    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "birth_date"]
    assert "no day 30" in error["msg"]


async def test_a_possible_duplicate_is_pointed_out(client: httpx.AsyncClient) -> None:
    await create_person(client, "Ali bin Rosli", birth_date="1980")

    response = await client.post("/api/persons", json={"full_name": "ali bin rosli"})

    assert response.status_code == 201
    assert [n["code"] for n in response.json()["notices"]] == ["possible_duplicate"]


async def test_the_date_reader_explains_itself(client: httpx.AsyncClient) -> None:
    good = (await client.get("/api/dates/read", params={"text": "sekitar 1920"})).json()
    bad = (await client.get("/api/dates/read", params={"text": "12/3/50"})).json()

    assert good["description"] == "about 1920"
    assert bad["date"] is None
    assert "4-digit year" in bad["error"]


async def test_delete_to_the_trash_and_restore_with_links_and_files(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    father = await create_person(client, "Hassan bin Ismail", gender="male")
    daughter = await create_person(client, "Aminah binti Hassan", gender="female")
    assert (await link(client, father["id"], daughter["id"], "parent")).status_code == 201
    folder = settings.data_dir / "people" / father["id"]
    assert (folder / "person.json").exists()

    entry = (await client.delete(f"/api/persons/{father['id']}")).json()

    assert entry["link_count"] == 1
    assert not folder.exists()
    assert (await client.get(f"/api/persons/{father['id']}")).status_code == 404
    assert (await get_person(client, daughter["id"]))["parents"] == []
    trash = (await client.get("/api/trash")).json()
    assert [item["full_name"] for item in trash] == ["Hassan bin Ismail"]

    restored = (await client.post(f"/api/trash/{entry['entry']}/restore")).json()

    assert (restored["restored_links"], restored["skipped_links"]) == (1, 0)
    parents = (await get_person(client, daughter["id"]))["parents"]
    assert [(p["full_name"], p["label"]) for p in parents] == [("Hassan bin Ismail", "Father")]
    assert (folder / "person.json").exists()
    assert (await client.get("/api/trash")).json() == []


async def test_children_come_in_families_and_in_birth_order(client: httpx.AsyncClient) -> None:
    rahman = await create_person(client, "Rahman bin Ismail", gender="male")
    zainab = await create_person(client, "Zainab binti Hamzah", gender="female")
    halimah = await create_person(client, "Halimah binti Omar", gender="female")

    async def add_child(name: str, gender: str, born: str, mother: str | None) -> dict[str, Any]:
        response = await client.post(
            f"/api/persons/{rahman['id']}/relatives",
            json={
                "relation": "child",
                "person": {"full_name": name, "gender": gender, "birth_date": born},
                "other_parent": mother,
            },
        )
        assert response.status_code == 201, response.text
        added: dict[str, Any] = response.json()
        return added

    siti = await add_child("Siti binti Rahman", "female", "1970", zainab["id"])
    await add_child("Hafiz bin Rahman", "male", "1978", halimah["id"])
    nur = await add_child("Nur binti Rahman", "female", "1965", zainab["id"])

    detail = await get_person(client, rahman["id"])
    families = [
        (
            [p["full_name"] for p in group["other_parents"]],
            [c["full_name"] for c in group["children"]],
        )
        for group in detail["child_groups"]
    ]
    assert families == [
        (["Zainab binti Hamzah"], ["Nur binti Rahman", "Siti binti Rahman"]),
        (["Halimah binti Omar"], ["Hafiz bin Rahman"]),
    ]
    assert [s["message"] for s in nur["suggestions"]] == [
        "Are Rahman bin Ismail and Zainab binti Hamzah married?"
    ]
    siti_detail = await get_person(client, siti["person"]["id"])
    assert siti_detail["sibling_position"] == (
        "Younger daughter of Rahman bin Ismail & Zainab binti Hamzah"
    )
    labels = {s["full_name"]: s["label"] for s in siti_detail["siblings"]}
    assert labels == {
        "Nur binti Rahman": "Elder sister",
        "Hafiz bin Rahman": "Younger half-brother",
    }
    # With only her father recorded, she isn't "the only child of Rahman bin Ismail".
    aina = await add_child("Aina binti Rahman", "female", "1972", None)
    assert (await get_person(client, aina["person"]["id"]))["sibling_position"] == (
        "Daughter of Rahman bin Ismail"
    )


async def test_a_manual_order_decides_when_dates_cannot(client: httpx.AsyncClient) -> None:
    tok = await create_person(client, "Tok Ismail", gender="male")
    ids = []
    for name in ("Aida", "Aina"):
        response = await client.post(
            f"/api/persons/{tok['id']}/relatives",
            json={"relation": "child", "person": {"full_name": name, "gender": "female"}},
        )
        ids.append(response.json()["person"]["id"])
    assert not (await get_person(client, tok["id"]))["child_groups"][0]["order_decided"]

    response = await client.put(
        f"/api/persons/{tok['id']}/children/order", json={"child_ids": [ids[1], ids[0]]}
    )

    [group] = response.json()["child_groups"]
    assert group["order_decided"]
    assert [c["full_name"] for c in group["children"]] == ["Aina", "Aida"]
    assert (await get_person(client, ids[1]))["sibling_position"] == "Elder daughter of Tok Ismail"
    [sister] = (await get_person(client, ids[0]))["siblings"]
    assert (sister["full_name"], sister["label"]) == ("Aina", "Elder sister")


async def test_siblings_are_listed_in_birth_order(client: httpx.AsyncClient) -> None:
    tok = await create_person(client, "Tok Ismail", gender="male")
    ids = {}
    for name, born in (("Busu", "1960"), ("Long", "1950"), ("Ngah", None), ("Alang", "1955")):
        response = await client.post(
            f"/api/persons/{tok['id']}/relatives",
            json={"relation": "child", "person": {"full_name": name, "birth_date": born}},
        )
        ids[name] = response.json()["person"]["id"]
    await client.put(
        f"/api/persons/{tok['id']}/children/order",
        json={"child_ids": [ids[n] for n in ("Long", "Ngah", "Alang", "Busu")]},
    )

    siblings = (await get_person(client, ids["Alang"]))["siblings"]

    assert [s["full_name"] for s in siblings] == ["Long", "Ngah", "Busu"]
