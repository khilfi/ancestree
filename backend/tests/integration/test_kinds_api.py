import httpx
import pytest

from tests.integration.conftest import create_person, get_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

GUARDIAN = {
    "label": "Guardian",
    "parent_label": {"neutral": "guardian"},
    "child_label": {"neutral": "ward"},
}


async def test_a_new_kind_can_be_used_hidden_renamed_and_deleted_when_unused(
    client: httpx.AsyncClient,
) -> None:
    created = await client.post("/api/relationship-kinds", json=GUARDIAN)
    kind = created.json()
    assert created.status_code == 201
    assert (kind["key"], kind["blood"], kind["builtin"], kind["usage"]) == (
        "guardian",
        False,
        False,
        0,
    )

    uncle = await create_person(client, "Kassim", gender="male")
    ward = await create_person(client, "Zul", gender="male")
    assert (
        await link(client, uncle["id"], ward["id"], "parent", kind="guardian")
    ).status_code == 201
    assert [p["label"] for p in (await get_person(client, ward["id"]))["parents"]] == ["Guardian"]

    in_use = await client.delete("/api/relationship-kinds/guardian")
    assert in_use.status_code == 409
    assert in_use.json()["detail"]["code"] == "kind_in_use"

    await client.patch("/api/relationship-kinds/guardian", json={"active": False})
    another = await create_person(client, "Ali", gender="male")
    hidden = await link(client, uncle["id"], another["id"], "parent", kind="guardian")
    assert hidden.json()["detail"]["code"] == "hidden_kind"

    renamed = await client.patch(
        "/api/relationship-kinds/guardian", json={"label": "Legal guardian"}
    )
    assert renamed.json()["label"] == "Legal guardian"

    link_id = (await get_person(client, ward["id"]))["parents"][0]["link_id"]
    await client.delete(f"/api/relationships/{link_id}")
    assert (await client.delete("/api/relationship-kinds/guardian")).status_code == 204


async def test_a_guardian_is_shown_but_makes_no_brothers_or_sisters(
    client: httpx.AsyncClient,
) -> None:
    await client.post("/api/relationship-kinds", json={**GUARDIAN, "in_layout": False})
    father = await create_person(client, "Rahman", gender="male")
    mother = await create_person(client, "Zainab", gender="female")
    uncle = await create_person(client, "Hassan", gender="male")
    aina = await create_person(client, "Aina", gender="female", birth_date="1972")
    karim = await create_person(client, "Karim", gender="male", birth_date="1965")
    await link(client, father["id"], mother["id"], "spouse")
    await link(client, father["id"], aina["id"], "parent")
    await link(client, mother["id"], aina["id"], "parent")
    await link(client, uncle["id"], karim["id"], "parent")

    guardian = await link(client, uncle["id"], aina["id"], "parent", kind="guardian")

    assert guardian.json()["suggestions"] == []  # no "Are Rahman and Hassan married?"
    detail = await get_person(client, aina["id"])
    assert {(p["full_name"], p["label"]) for p in detail["parents"]} == {
        ("Rahman", "Father"),
        ("Zainab", "Mother"),
        ("Hassan", "Guardian"),
    }
    assert detail["siblings"] == []  # Hassan's son isn't her brother
    assert detail["sibling_position"] == "Only child of Rahman & Zainab"
    hassan = await get_person(client, uncle["id"])
    groups = [(g["kind"], [c["label"] for c in g["children"]]) for g in hassan["child_groups"]]
    assert groups == [(None, ["Son"]), ("guardian", ["Ward"])]
    refused = await client.put(
        f"/api/persons/{uncle['id']}/children/order", json={"child_ids": [aina["id"]]}
    )
    assert refused.json()["detail"]["code"] == "not_by_birth"


async def test_adopted_children_are_brothers_and_sisters_by_adoption(
    client: httpx.AsyncClient,
) -> None:
    father = await create_person(client, "Hassan", gender="male")
    son = await create_person(client, "Karim", gender="male", birth_date="1965")
    adopted = await create_person(client, "Salmah", gender="female", birth_date="1968")
    await link(client, father["id"], son["id"], "parent")
    await link(client, father["id"], adopted["id"], "parent", kind="adoptive")

    karim = await get_person(client, son["id"])
    salmah = await get_person(client, adopted["id"])

    assert [(s["full_name"], s["label"]) for s in karim["siblings"]] == [
        ("Salmah", "Younger adoptive sister")
    ]
    assert [(s["full_name"], s["label"]) for s in salmah["siblings"]] == [
        ("Karim", "Elder adoptive brother")
    ]
    assert salmah["sibling_position"] is None  # her birth parents aren't recorded
    hassan = await get_person(client, father["id"])
    groups = [(g["kind"], [c["label"] for c in g["children"]]) for g in hassan["child_groups"]]
    assert groups == [(None, ["Son"]), ("adoptive", ["Adopted daughter"])]


async def test_the_same_name_twice_is_refused(client: httpx.AsyncClient) -> None:
    await client.post("/api/relationship-kinds", json=GUARDIAN)

    again = await client.post("/api/relationship-kinds", json={**GUARDIAN, "label": "guardian"})

    assert again.json()["detail"]["code"] == "duplicate_kind"


async def test_biological_is_built_in_and_locked(client: httpx.AsyncClient) -> None:
    renamed = await client.patch("/api/relationship-kinds/biological", json={"label": "Blood"})
    deleted = await client.delete("/api/relationship-kinds/biological")

    assert renamed.json()["detail"]["code"] == "builtin_kind"
    assert deleted.json()["detail"]["code"] == "builtin_kind"
