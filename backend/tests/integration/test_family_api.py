import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.seed.loader import load_seed

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def test_family_facts_hold_the_counts_and_name_their_people(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    await load_seed(driver, settings.neo4j_database)

    response = await client.get("/api/family/facts")
    graph = (await client.get("/api/graph")).json()

    assert response.status_code == 200, response.text
    facts = response.json()
    people = {p["id"] for p in graph["people"] if not p["placeholder"]}
    # The counts the tree's toolbar used to show, from the same family.
    assert facts["counts"]["people"] == len(people)
    assert facts["counts"]["links"] == len(graph["links"])
    assert facts["counts"]["unlinked"] == len(graph["layout"]["unlinked"])
    assert sum(g["people"] for g in facts["generations"]) <= len(people)
    # Each fact names its people, so the app can open them.
    named = [
        facts["oldest"]["person"],
        facts["youngest"]["person"],
        facts["longest_chain"]["a"],
        facts["longest_chain"]["b"],
        *facts["biggest_family"]["parents"],
        *facts["most_descendants"]["people"],
    ]
    assert {p["id"] for p in named} <= people
    # The test family has cousins who married: Azman and Nor.
    assert [(c["a"]["name"], c["b"]["name"], c["term"]) for c in facts["cousins_married"]] == [
        ("Azman", "Nor", "first cousin")
    ]
