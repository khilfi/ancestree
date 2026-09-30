from typing import Any

import httpx
import pytest

from tests.integration.conftest import create_person, get_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def error_code(response: httpx.Response) -> str:
    assert response.status_code == 409, response.text
    code: str = response.json()["detail"]["code"]
    return code


async def test_a_parent_link_is_stored_parent_to_child_however_it_was_said(
    client: httpx.AsyncClient,
) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", birth_date="1938")
    aminah = await create_person(client, "Aminah binti Hassan", gender="female", birth_date="1962")

    response = await link(client, aminah["id"], hassan["id"], "child")

    assert response.status_code == 201
    [stored] = response.json()["links"]
    assert (stored["source"], stored["target"]) == (hassan["id"], aminah["id"])
    assert response.json()["notices"] == []
    parents = (await get_person(client, aminah["id"]))["parents"]
    assert [p["label"] for p in parents] == ["Father"]


async def test_impossible_links_are_refused_with_a_reason(client: httpx.AsyncClient) -> None:
    grandfather = await create_person(client, "Ismail", gender="male")
    father = await create_person(client, "Hassan", gender="male")
    son = await create_person(client, "Karim", gender="male")
    await link(client, grandfather["id"], father["id"], "parent")
    await link(client, father["id"], son["id"], "parent")

    assert error_code(await link(client, son["id"], son["id"], "parent")) == "self_link"
    assert error_code(await link(client, father["id"], son["id"], "parent")) == "already_linked"
    assert error_code(await link(client, son["id"], grandfather["id"], "parent")) == "cycle"
    assert error_code(await link(client, father["id"], son["id"], "spouse")) == "parent_and_spouse"

    mother = await create_person(client, "Mariam", gender="female")
    other = await create_person(client, "Suraya", gender="female")
    assert (await link(client, mother["id"], son["id"], "parent")).status_code == 201
    assert error_code(await link(client, other["id"], son["id"], "parent")) == "third_parent"
    adoptive = await link(client, other["id"], son["id"], "parent", kind="adoptive")
    assert adoptive.status_code == 201


async def test_unlikely_links_are_kept_with_notices(client: httpx.AsyncClient) -> None:
    father = await create_person(client, "Rosli bin Hamid", gender="male", birth_date="1958")
    child = await create_person(client, "Ali bin Daud", gender="male", birth_date="1965")

    response = await link(client, father["id"], child["id"], "parent")

    assert response.status_code == 201
    codes = [n["code"] for n in response.json()["notices"]]
    assert codes == ["parent_too_young", "patronymic_mismatch"]


async def test_siblings_share_parents_or_an_unknown_parent(client: httpx.AsyncClient) -> None:
    mariam = await create_person(client, "Mariam", gender="female")
    salmah = await create_person(client, "Salmah", gender="female")

    joined = await link(client, mariam["id"], salmah["id"], "sibling")

    assert joined.status_code == 201
    unknown = {stored["source"] for stored in joined.json()["links"]}
    assert len(unknown) == 1
    detail = await get_person(client, mariam["id"])
    assert [(p["full_name"], p["label"]) for p in detail["parents"]] == [
        ("Unknown parent", "Parent (unknown)")
    ]
    assert [(s["full_name"], s["label"]) for s in detail["siblings"]] == [("Salmah", "Sister")]

    kassim = await create_person(client, "Kassim", gender="male")
    choose = await link(client, kassim["id"], mariam["id"], "sibling")
    assert error_code(choose) == "choose_shared_parents"
    candidates = [c["id"] for c in choose.json()["detail"]["candidates"]]
    assert candidates == list(unknown)

    chosen = await link(client, kassim["id"], mariam["id"], "sibling", shared_parents=candidates)
    assert chosen.status_code == 201
    siblings = (await get_person(client, mariam["id"]))["siblings"]
    assert sorted(s["full_name"] for s in siblings) == ["Kassim", "Salmah"]


async def test_an_unknown_parent_can_be_filled_in(client: httpx.AsyncClient) -> None:
    mariam = await create_person(client, "Mariam", gender="female")
    salmah = await create_person(client, "Salmah", gender="female")
    joined = await link(client, mariam["id"], salmah["id"], "sibling")
    [unknown] = {stored["source"] for stored in joined.json()["links"]}

    filled = await client.post(
        f"/api/persons/{unknown}/fill-in",
        json={"person": {"full_name": "Daud bin Musa", "gender": "male"}},
    )

    assert filled.status_code == 200, filled.text
    daud = filled.json()["person"]
    assert sorted(c["full_name"] for g in daud["child_groups"] for c in g["children"]) == [
        "Mariam",
        "Salmah",
    ]
    assert (await client.get(f"/api/persons/{unknown}")).status_code == 404
    siblings = (await get_person(client, mariam["id"]))["siblings"]
    assert [(s["full_name"], s["label"]) for s in siblings] == [("Salmah", "Sister")]
    again = await client.post(f"/api/persons/{daud['id']}/fill-in", json={"existing": daud["id"]})
    assert error_code(again) == "not_unknown"


async def test_an_unknown_parent_can_be_someone_already_in_the_tree(
    client: httpx.AsyncClient,
) -> None:
    umar = await create_person(client, "Umar", gender="male")
    hana = await create_person(client, "Hana", gender="female")
    aisyah = await create_person(client, "Aisyah", gender="female")
    joined = await link(client, umar["id"], hana["id"], "sibling")
    [unknown] = {stored["source"] for stored in joined.json()["links"]}

    filled = await client.post(f"/api/persons/{unknown}/fill-in", json={"existing": aisyah["id"]})

    assert filled.json()["person"]["id"] == aisyah["id"]
    parents = (await get_person(client, hana["id"]))["parents"]
    assert [(p["full_name"], p["label"]) for p in parents] == [("Aisyah", "Mother")]


async def test_marriages_are_suggested_and_can_end(client: httpx.AsyncClient) -> None:
    hassan = await create_person(client, "Hassan", gender="male")
    mariam = await create_person(client, "Mariam", gender="female")
    aminah = await create_person(client, "Aminah", gender="female")
    await link(client, hassan["id"], aminah["id"], "parent")

    second_parent = await link(client, mariam["id"], aminah["id"], "parent")
    [suggestion] = second_parent.json()["suggestions"]
    assert suggestion["type"] == "marry"

    married = await link(client, suggestion["person_a"], suggestion["person_b"], "spouse")
    assert married.status_code == 201
    assert [s["label"] for s in (await get_person(client, hassan["id"]))["spouses"]] == ["Wife"]

    marriage_id = married.json()["links"][0]["id"]
    await client.patch(f"/api/relationships/{marriage_id}", json={"status": "divorced"})
    spouses: list[dict[str, Any]] = (await get_person(client, hassan["id"]))["spouses"]
    assert [s["label"] for s in spouses] == ["Former wife"]


async def test_a_link_can_change_kind_or_direction_and_be_removed(
    client: httpx.AsyncClient,
) -> None:
    parent = await create_person(client, "Yusof", gender="male")
    child = await create_person(client, "Lina", gender="female")
    link_id = (await link(client, parent["id"], child["id"], "parent")).json()["links"][0]["id"]

    await client.patch(f"/api/relationships/{link_id}", json={"kind": "adoptive"})
    assert [p["label"] for p in (await get_person(client, child["id"]))["parents"]] == [
        "Adoptive father"
    ]

    swapped = await client.patch(f"/api/relationships/{link_id}", json={"swap": True})
    assert swapped.json()["links"][0]["source"] == child["id"]

    assert (await client.delete(f"/api/relationships/{link_id}")).status_code == 204
    assert (await get_person(client, parent["id"]))["link_count"] == 0
