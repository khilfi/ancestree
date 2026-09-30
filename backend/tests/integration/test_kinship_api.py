import json
import time
from typing import Any

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.seed.family import seed_id
from ancestree.seed.loader import load_seed
from tests.integration.conftest import create_person, load_generated_family

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def person(key: str) -> str:
    return str(seed_id(f"person:{key}"))


async def kinship(client: httpx.AsyncClient, a: str, b: str) -> dict[str, Any]:
    response = await client.get("/api/kinship", params={"from": a, "to": b})
    assert response.status_code == 200, response.text
    answer: dict[str, Any] = response.json()
    return answer


async def test_the_answer_names_both_ways_round_with_the_path(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    await load_seed(driver, settings.neo4j_database)

    answer = await kinship(client, person("ali"), person("siti"))

    [relation] = answer["relations"]
    assert relation["type"] == "blood"
    assert relation["forward"] == {
        "term": "first cousin once removed",
        "sentence": "Siti is Ali's first cousin once removed",
        "detail": "his mother's first cousin; one generation above him",
        # Every kinship language at once, so switching needs no new answer.
        "words": {
            "en": {
                "term": "first cousin once removed",
                "sentence": "Siti is Ali's first cousin once removed",
                "english": False,
            },
            "ms": {
                "term": "sepupu emak",
                "sentence": "Siti is Ali's sepupu emak",
                "english": False,
            },
            "jv": {
                "term": "misanané ibu",
                "sentence": "Siti is Ali's misanané ibu",
                "english": False,
            },
        },
        "entry": "cousin-of-parent",
    }
    assert relation["reverse"]["sentence"] == "Ali is Siti's first cousin once removed"
    assert relation["generations"] == 1
    names = {p["id"]: p["name"] for p in answer["people"]}
    assert [names[p] for p in relation["path"]] == [
        "Ali",
        "Aminah",
        "Acan",
        "Tok Ismail",
        "Rahman",
        "Siti",
    ]
    assert [names[p] for p in relation["shared_ancestors"]] == ["Tok Ismail", "Nenek Fatimah"]
    # "What does this mean?": with the people, and where the lines meet for the ladder.
    assert relation["explanation"] == {
        "sentences": [
            "Aminah and Siti are first cousins: they share grandparents, "
            "Tok Ismail & Nenek Fatimah.",
            "Ali is Aminah's son, one generation below Siti: that's what \"once removed\" means.",
        ],
        "top": 3,
        "pair": "first cousins",
        "removed": "once removed",
        "rule": (
            "Cousins are counted by the ancestors they share: grandparents for first cousins, "
            'great-grandparents for second cousins. "Removed" counts the generations between them.'
        ),
    }
    # The path's links are the stored ones, for the tree to highlight.
    stored, _, _ = await driver.execute_query(
        "MATCH ()-[r:PARENT_OF]->() RETURN collect(r.id) AS ids",
        database_=settings.neo4j_database,
    )
    assert set(relation["links"]) <= set(stored[0]["ids"])
    assert answer["message"] is None


async def test_a_couple_who_are_also_cousins_get_both(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    await load_seed(driver, settings.neo4j_database)

    answer = await kinship(client, person("azman"), person("nor"))

    assert [r["forward"]["sentence"] for r in answer["relations"]] == [
        "Nor is Azman's wife",
        "Nor is Azman's first cousin",
    ]


async def test_nothing_to_say_is_said_plainly(client: httpx.AsyncClient) -> None:
    ali = await create_person(client, "Ali bin Rosli")
    kamal = await create_person(client, "Kamal bin Musa")

    unlinked = await kinship(client, ali["id"], kamal["id"])
    same = await kinship(client, ali["id"], ali["id"])

    assert unlinked["relations"] == []
    assert unlinked["message"] == "No recorded link between Ali and Kamal yet."
    assert same["message"] == "That's Ali again: pick someone else."
    missing = await client.get(
        "/api/kinship", params={"from": ali["id"], "to": "01a0e019-0000-7000-8000-000000000000"}
    )
    assert missing.status_code == 404


async def test_the_malay_titles_are_the_familys_own(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    await load_seed(driver, settings.neo4j_database)
    # Hassan is the eldest of Tok Ismail's four children: Pak Long to his brother's Siti.
    before = await kinship(client, person("siti"), person("hassan"))
    assert before["relations"][0]["forward"]["words"]["ms"]["term"] == "pak long"

    saved = await client.put(
        "/api/kinship/settings",
        json={"language": "ms", "titles": ["sulung", "ngah", "alang"], "youngest": "busu"},
    )

    assert saved.status_code == 200, saved.text
    assert (await client.get("/api/kinship/settings")).json()["titles"][0] == "sulung"
    after = await kinship(client, person("siti"), person("hassan"))
    assert after["relations"][0]["forward"]["words"]["ms"]["term"] == "pak sulung"


async def test_the_dictionary_has_every_language_and_its_words(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/kinship/dictionary")
    assert response.status_code == 200, response.text
    dictionary = response.json()

    assert [language["code"] for language in dictionary["languages"]] == ["en", "ms", "jv"]
    rows = {row["id"]: row for section in dictionary["sections"] for row in section["rows"]}
    assert rows["uncle-elder"]["words"]["jv"]["word"] == "pakdhé"
    assert rows["uncle-elder"]["words"]["ms"]["address"] == ["Pak Long", "Pak Ngah", "Pak Cik"]
    assert rows["father"]["words"]["jv"]["krama_inggil"] == "rama"
    # Kinds take their words from Settings: the starting ones have them from the migration.
    assert rows["adopted-child"]["words"]["jv"]["word"] == "anak pupon"
    assert rows["foster-mother"]["words"]["jv"]["word"] == "ibu asuh"


async def test_the_relatives_tab_follows_the_kinship_language(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    await load_seed(driver, settings.neo4j_database)

    async def labels(key: str) -> list[str]:
        detail = (await client.get(f"/api/persons/{person(key)}")).json()
        return [r["label"] for r in detail["parents"] + detail["spouses"] + detail["siblings"]]

    english = await labels("hassan")
    await client.put("/api/kinship/settings", json={"language": "jv"})
    javanese = await labels("hassan")

    assert "Father" in english
    assert "Bapak" in javanese
    assert all(label not in javanese for label in ("Father", "Mother"))
    # person.json keeps its English labels, whatever the setting.
    await client.put(f"/api/persons/{person('hassan')}", json={"full_name": "Hassan bin Ismail"})
    snapshot = json.loads(
        (settings.data_dir / "people" / person("hassan") / "person.json").read_text("utf-8")
    )
    assert [p["label"] for p in snapshot["parents"]][:1] == ["Father"]


async def test_a_kinds_words_can_be_set(client: httpx.AsyncClient) -> None:
    words = {
        "ms": {
            "label": "jagaan",
            "parent_label": {"neutral": "penjaga"},
            "child_label": {"neutral": "anak jagaan"},
        }
    }
    created = await client.post(
        "/api/relationship-kinds",
        json={
            "label": "Guardian",
            "parent_label": {"neutral": "guardian"},
            "child_label": {"neutral": "ward"},
            "in_layout": False,
            "words": words,
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["words"]["ms"]["parent_label"]["neutral"] == "penjaga"

    cleared = await client.patch(
        f"/api/relationship-kinds/{created.json()['key']}", json={"words": {}}
    )

    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["words"] == {}


async def test_an_answer_among_two_thousand_people_takes_under_300_ms(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    ids = await load_generated_family(driver, settings.neo4j_database, 2000)
    await kinship(client, ids[0], ids[1])  # warm up the query plans

    started = time.perf_counter()
    answer = await kinship(client, ids[5], ids[1400])
    elapsed = time.perf_counter() - started

    assert answer["relations"]
    assert elapsed < 0.3, f"the answer took {elapsed * 1000:.0f} ms"  # the aim: 300 ms
