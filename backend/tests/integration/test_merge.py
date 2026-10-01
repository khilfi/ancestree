"""Merging two people: someone entered twice becomes one, over HTTP. Names are the
fictional family's."""

from typing import Any

import httpx
import pytest

from tests.integration.conftest import create_person, get_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def parents_of(person: dict[str, Any]) -> set[str]:
    return {parent["id"] for parent in person["parents"]}


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
