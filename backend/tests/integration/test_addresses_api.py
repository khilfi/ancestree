"""Addresses over HTTP: a whole address kept and shown,
its district as written; someone with no place of their own shown at their parents', whose as
chosen, and on the map beside them; the suggestions as an address is typed; and addresses in
GEDCOM only when chosen. The people are made up; the places are real."""

from typing import Any

import httpx
import pytest

from tests.integration.conftest import create_person, get_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

HOME = {
    "address": "No. 12, Jalan Melati 3",
    "town": "Kajang",
    "district": "Hulu Langat",
    "state": "Selangor",
    "postcode": "43000",
    "country": "Malaysia",
    "lat": 2.993,
    "lon": 101.788,
    "exact": "postcode",
}
KOTA_BHARU = {"town": "Kota Bharu", "state": "Kelantan", "country": "Malaysia"}


async def edit(client: httpx.AsyncClient, person: dict[str, Any], **fields: Any) -> dict[str, Any]:
    body = {"full_name": person["full_name"], "gender": person["gender"], **fields}
    response = await client.put(f"/api/persons/{person['id']}", json=body)
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()["person"]
    return found


async def test_a_whole_address_is_kept_and_its_district_said_as_written(
    client: httpx.AsyncClient,
) -> None:
    aina = await create_person(client, "Aina binti Hassan", residence=HOME)
    shown = await get_person(client, aina["id"])
    assert shown["residence"] == HOME
    assert shown["residence_district"] == "Hulu Langat"
    wrong = await client.post(
        "/api/persons", json={"full_name": "Someone", "residence": {**HOME, "lon": None}}
    )
    assert wrong.status_code == 422  # a location is both its numbers


async def test_a_child_with_no_place_lives_at_their_parents_as_chosen(
    client: httpx.AsyncClient,
) -> None:
    """When the parents live apart, the one they sit under on the tree, here their mother, whose
    family it is; the father's when chosen; none elsewhere, nor once they've died; never
    the grandparents', for their own child; and on the map with the parent whose place it is."""
    father = await create_person(client, "Hassan bin Ismail", gender="male", residence=KOTA_BHARU)
    mother = await create_person(client, "Siti binti Ali", gender="female", residence=HOME)
    grandmother = await create_person(client, "Fatimah binti Yusof", gender="female")
    assert (await link(client, grandmother["id"], mother["id"], "parent")).status_code == 201
    aina = await create_person(client, "Aina binti Hassan", gender="female", birth_date="2010")
    for parent in (father, mother):
        assert (await link(client, parent["id"], aina["id"], "parent")).status_code == 201

    shown = await get_person(client, aina["id"])
    assert shown["residence"] is None
    assert shown["parents_apart"] is True
    at = shown["residence_at_parents"]
    assert (at["whose"], at["place"]["town"], at["district"]) == ("mother", "Kajang", "Hulu Langat")

    await edit(client, aina, birth_date="2010", lives_with="father")
    at = (await get_person(client, aina["id"]))["residence_at_parents"]
    assert (at["whose"], at["place"]["town"]) == ("father", "Kota Bharu")
    family = (await client.get("/api/map")).json()
    [on_map] = [person for person in family["people"] if person["id"] == aina["id"]]
    assert on_map["at_parents"] == "father"
    assert on_map["lives"]["name"] == "Kota Bharu"

    child = await create_person(client, "Nur binti Aina", gender="female", birth_date="2030")
    assert (await link(client, aina["id"], child["id"], "parent")).status_code == 201
    assert (await get_person(client, child["id"]))["residence_at_parents"] is None  # one step

    await edit(client, aina, birth_date="2010", lives_with="elsewhere")
    assert (await get_person(client, aina["id"]))["residence_at_parents"] is None
    await edit(client, aina, birth_date="2010", death_date="2025")
    assert (await get_person(client, aina["id"]))["residence_at_parents"] is None
    family = (await client.get("/api/map")).json()
    [on_map] = [person for person in family["people"] if person["id"] == aina["id"]]
    assert (on_map["lives"], on_map["at_parents"]) == (None, None)


async def test_parents_apart_show_them_with_the_one_they_sit_under(
    client: httpx.AsyncClient,
) -> None:
    """The review's #10, by the user's answer of 19 Nov 2026: it was always the
    mother, whatever the facts. It's the parent they sit under on the tree laid out from the
    oldest ancestor: here the father, whose family it is; and so whatever the centre now."""
    grandfather = await create_person(client, "Ismail bin Ahmad", gender="male")
    father = await create_person(client, "Hassan bin Ismail", gender="male", residence=KOTA_BHARU)
    assert (await link(client, grandfather["id"], father["id"], "parent")).status_code == 201
    mother = await create_person(client, "Mariam binti Daud", gender="female", residence=HOME)
    karim = await create_person(client, "Karim bin Hassan", gender="male", birth_date="2008")
    for parent in (father, mother):
        assert (await link(client, parent["id"], karim["id"], "parent")).status_code == 201
    # Centred on the mother now, whose family hangs off it: still where the oldest seats them.
    assert (await client.put("/api/settings", json={"centre": mother["id"]})).is_success

    at = (await get_person(client, karim["id"]))["residence_at_parents"]
    assert (at["whose"], at["place"]["town"]) == ("father", "Kota Bharu")
    family = (await client.get("/api/map")).json()
    [on_map] = [person for person in family["people"] if person["id"] == karim["id"]]
    assert (on_map["at_parents"], on_map["lives"]["name"]) == ("father", "Kota Bharu")

    await edit(client, karim, birth_date="2008", lives_with="mother")  # as chosen on the form
    at = (await get_person(client, karim["id"]))["residence_at_parents"]
    assert (at["whose"], at["place"]["town"]) == ("mother", "Kajang")


async def test_at_their_parents_takes_only_living_parents_by_birth_or_adoption(
    client: httpx.AsyncClient,
) -> None:
    """The review's #10: a living adult was shown at their late mother's last
    address, and a foster parent's or a guardian's place could be taken as their parents'."""
    father = await create_person(client, "Hassan bin Ismail", gender="male", residence=KOTA_BHARU)
    mother = await create_person(
        client, "Siti binti Ali", gender="female", residence=HOME, death_date="2020"
    )
    aina = await create_person(client, "Aina binti Hassan", gender="female", birth_date="1990")
    for parent in (father, mother):
        assert (await link(client, parent["id"], aina["id"], "parent")).status_code == 201

    shown = await get_person(client, aina["id"])
    assert shown["parents_apart"] is False  # only one of them can be lived with
    at = shown["residence_at_parents"]
    assert (at["whose"], at["place"]["town"]) == ("father", "Kota Bharu")
    family = (await client.get("/api/map")).json()
    [on_map] = [person for person in family["people"] if person["id"] == aina["id"]]
    assert (on_map["at_parents"], on_map["lives"]["name"]) == ("father", "Kota Bharu")

    # A foster parent's place isn't their parents'; an adoptive parent's is.
    zul = await create_person(client, "Zul bin Karim", gender="male", birth_date="2012")
    foster = await create_person(client, "Rokiah binti Salleh", gender="female", residence=HOME)
    made = await link(client, foster["id"], zul["id"], "parent", kind="foster")
    assert made.status_code == 201, made.text
    assert (await get_person(client, zul["id"]))["residence_at_parents"] is None
    adoptive = await create_person(client, "Karim bin Osman", gender="male", residence=KOTA_BHARU)
    made = await link(client, adoptive["id"], zul["id"], "parent", kind="adoptive")
    assert made.status_code == 201, made.text
    at = (await get_person(client, zul["id"]))["residence_at_parents"]
    assert (at["whose"], at["place"]["town"]) == ("father", "Kota Bharu")


async def test_an_address_typed_is_suggested_from_the_countrys_places(
    client: httpx.AsyncClient,
) -> None:
    """From the places that come with the app, before any download: the towns it names, each
    with its state; and whether the country's places are downloaded, to offer them."""
    answer = await client.get(
        "/api/places/suggest", params={"line": "Jalan Sultan, Kota Bharu", "country": "Malaysia"}
    )
    assert answer.status_code == 200, answer.text
    found = answer.json()
    assert (found["country"], found["downloaded"]) == ("my", False)
    first = found["suggestions"][0]
    assert (first["town"], first["state"], first["country"], first["exact"]) == (
        "Kota Bharu",
        "Kelantan",
        "Malaysia",
        "town",
    )
    nowhere = (
        await client.get("/api/places/suggest", params={"line": "x", "country": "Narnia"})
    ).json()
    assert nowhere == {"country": None, "downloaded": False, "suggestions": []}


async def test_gedcom_holds_addresses_only_when_chosen(client: httpx.AsyncClient) -> None:
    await create_person(client, "Aina binti Hassan", residence=HOME)

    async def gedcom(**choice: Any) -> str:
        made = await client.post("/api/exports", json={"format": "gedcom", **choice})
        assert made.status_code == 201, made.text
        return (await client.get(f"/api/exports/{made.json()['name']}")).text

    assert "No. 12, Jalan Melati 3" not in await gedcom()
    chosen = await gedcom(addresses=True)
    assert "2 ADDR No. 12, Jalan Melati 3" in chosen
    assert "3 POST 43000" in chosen


@pytest.mark.usefixtures("death_places")  # shown, its switch on
async def test_a_living_persons_address_saved_as_their_birth_and_death_moves_home_in_one_step(
    client: httpx.AsyncClient,
) -> None:
    """The mix-up a form made easy, an address and its pin saved as someone's place of
    birth and of death while where they live stayed their town. The map shows where they died,
    and one quick fix moves the address home, keeps the birthplace's town and clears the place
    of death; Undo puts it back as it was."""
    town = {"town": "Kajang", "state": "Selangor", "country": "Malaysia"}
    pinned = {**HOME, "lat": 2.9931, "lon": 101.7888, "exact": "hand"}
    aina = await create_person(
        client,
        "Aina binti Hassan",
        living=True,
        residence=town,
        birth_place=pinned,
        death_place=pinned,
    )
    family = (await client.get("/api/map")).json()
    [shown] = [p for p in family["people"] if p["id"] == aina["id"]]
    assert (shown["died"]["lat"], shown["died"]["exact"]) == (2.9931, "hand")
    assert shown["lives"]["place"]["address"] is None

    moved = await client.patch(
        f"/api/persons/{aina['id']}",
        json={"residence": pinned, "birth_place": town, "death_place": None},
    )
    assert moved.status_code == 200, moved.text
    person = await get_person(client, aina["id"])
    assert person["residence"]["address"] == HOME["address"]
    assert (person["residence"]["lat"], person["residence"]["exact"]) == (2.9931, "hand")
    assert person["birth_place"]["town"] == "Kajang"
    assert person["birth_place"]["address"] is None
    assert person["death_place"] is None
    family = (await client.get("/api/map")).json()
    [shown] = [p for p in family["people"] if p["id"] == aina["id"]]
    assert shown["died"] is None
    assert (shown["lives"]["lat"], shown["lives"]["exact"]) == (2.9931, "hand")

    assert (await client.post("/api/history/undo")).status_code == 200
    person = await get_person(client, aina["id"])
    assert person["death_place"]["address"] == HOME["address"]
    assert person["residence"]["address"] is None
