"""The template and its example, checked against the app: the
template has the columns an import reads, and the example, brought into an empty family, gives
every person, link and detail as the example family has them, but what no spreadsheet carries:
photos, life stories and sources, Me, the place of death while it's unshown, the order of
a second marriage, a birth order set by hand, and where on the map a place was found rather
than put by hand."""

import json
from typing import Any

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.domain.person import Place
from ancestree.importing.sheet import READ
from ancestree.repo.export import export_graph
from ancestree.repo.mapping import person_from_props
from ancestree.seed.example import load_example_family
from ancestree.services.detail import is_living

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def where(place: Place | None, hand: bool = False) -> tuple[Any, ...] | None:
    """A place as a spreadsheet carries it: its town, state and country; to the house where
    they live; and its location only where it was put there by hand."""
    if place is None or place.is_empty:
        return None
    house = (place.address, place.postcode, place.district) if hand else ()
    pinned = (place.lat, place.lon) if hand and place.exact == "hand" else ()
    return (place.town, place.state, place.country, *house, *pinned)


async def test_the_example_brought_into_an_empty_family_is_the_example_family(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    template = await client.get("/api/imports/template")
    header = template.content.decode("utf-8-sig").splitlines()[0]
    assert json.loads(f"[{header}]") == [
        column for column in READ if column not in ("Version", "Death place")
    ]
    example = (await client.get("/api/imports/template", params={"example": "true"})).content

    files = {"file": ("ancestree-import-example.csv", example, "text/csv")}
    preview = (await client.post("/api/imports/preview", files=files)).json()
    assert preview["left_out"] == []
    assert preview["questions"] == []
    done = await client.post("/api/imports", files=files)
    assert done.status_code == 201, done.text

    family = load_example_family()
    wanted = {
        person.full_name: person for person in family.people_as_domain() if not person.placeholder
    }
    graph = await export_graph(driver, settings.neo4j_database)
    found = {
        props["full_name"]: person_from_props(props)
        for props in graph["people"]
        if not props.get("placeholder")
    }
    assert found.keys() == wanted.keys()
    for name, person in wanted.items():
        got = found[name]
        assert (got.nickname, got.title, got.name_jawi, got.gender) == (
            person.nickname,
            person.title,
            person.name_jawi,
            person.gender,
        ), name
        assert (got.birth_date, got.death_date) == (person.birth_date, person.death_date), name
        assert where(got.birth_place) == where(person.birth_place), name
        assert where(got.residence, hand=True) == where(person.residence, hand=True), name
        assert (got.burial_place, got.occupation, got.notes) == (
            person.burial_place,
            person.occupation,
            person.notes,
        ), name
        assert is_living(got) == is_living(person), name
        if person.residence and person.residence.exact == "hand":
            assert got.residence is not None
            assert got.residence.exact == "hand", name  # so they're a pin

    ids = {props["id"]: props["full_name"] for props in graph["people"]}
    keys = {each.key: each.full_name for each in family.people if not each.placeholder}
    parents_found = {
        (ids[link["source"]], ids[link["target"]], link["properties"]["kind"])
        for link in graph["links"]
        if link["type"] == "PARENT_OF" and link["source"] in ids and link["target"] in ids
    }
    parents_wanted = {
        (keys[parent], keys[child], unit.kind)
        for unit in family.families
        for parent in unit.parents
        for child in unit.children
        if parent in keys
    }
    assert {link for link in parents_found if link[0] in keys.values()} == parents_wanted
    spouses_found = {
        (frozenset((ids[link["source"]], ids[link["target"]])), link["properties"]["status"])
        for link in graph["links"]
        if link["type"] == "SPOUSE_OF"
    }
    spouses_wanted = {
        (frozenset((keys[a], keys[b])), marriage.status.value)
        for marriage in family.marriages
        for a, b in [marriage.spouses]
    }
    assert spouses_found == spouses_wanted
