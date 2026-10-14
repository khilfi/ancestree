"""The example family filling a family of its own as it
first opens, with a real database: everyone there, with their portraits, stories and places;
Me and the family's birth-order titles set; every view answering; and never mixed with anyone
already in a family."""

import json
from pathlib import Path

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.main import create_app
from ancestree.seed.example import ExampleRefusedError, load_example_family, write_example
from ancestree.services.context import Context
from tests.integration.conftest import create_person

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

FAMILY = load_example_family()


def pid(key: str) -> str:
    return str(FAMILY.person_id(key))


async def test_the_example_family_fills_a_family_of_its_own_as_it_first_opens(
    driver: AsyncDriver, settings: Settings
) -> None:
    app = create_app(settings.model_copy(update={"example_first": True}))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            graph = (await client.get("/api/graph")).json()
            people = {person["id"]: person for person in graph["people"]}
            assert len(people) == 65
            assert sum(1 for person in people.values() if person["photo_version"]) == 64
            told = {p.key for p in FAMILY.people if people[pid(p.key)]["has_story"]}
            assert told == {"hassan", "mariam", "ismail", "fatimah", "painem", "hamid"} | {
                "rashid",
                "hafiz",
                "rahman",
                "ahmad",
                "aminah",
            }

            # Their portraits, as the app shows photos.
            avatar = await client.get(
                f"/api/persons/{pid('hassan')}/photo/avatar", params={"size": 128}
            )
            assert avatar.status_code == 200
            assert avatar.headers["content-type"] == "image/webp"

            # Hassan's life story: every part, what people say, and its pictures.
            life = (await client.get(f"/api/persons/{pid('hassan')}/biography")).json()
            assert len(life["parts"]) == 11
            assert [words["writer"] for words in life["said"]] == [
                "Zulkifli bin Hassan",
                "Danial bin Karim",
                "Nor binti Hassan",
            ]
            assert [words["yours"] for words in life["said"]] == [False, True, False]
            pictures = [line for line in life["parts"]["early"].split("\n") if "](media/" in line]
            name = pictures[0].split("](")[1].rstrip(")")
            assert (await client.get(f"/api/persons/{pid('hassan')}/{name}")).status_code == 200

            # Me, a grandchild, and what everyone is to them.
            me = (await client.get("/api/family/me")).json()
            assert me["person"] == pid("danial")
            kin = await client.get(
                "/api/kinship", params={"from": pid("danial"), "to": pid("hassan")}
            )
            assert kin.status_code == 200
            assert "grandfather" in json.dumps(kin.json())
            titles = (await client.get("/api/kinship/settings")).json()
            assert titles["titles"][:3] == ["long", "ngah", "alang"]

            # Every person answers; the map has them at both levels; the family's facts.
            for person in people:
                assert (await client.get(f"/api/persons/{person}")).status_code == 200
            shown = (await client.get("/api/map")).json()
            assert len(shown["people"]) == 64
            assert (await client.get("/api/family/facts")).status_code == 200

    # Opened again, it isn't filled twice: it refuses, as anyone's there.
    ctx = Context(driver, settings.neo4j_database, settings.data_dir)
    with pytest.raises(ExampleRefusedError):
        await write_example(ctx)


async def test_the_example_family_never_mixes_with_anyone(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    await create_person(client, "Ali bin Hassan")
    ctx = Context(driver, settings.neo4j_database, settings.data_dir)
    with pytest.raises(ExampleRefusedError):
        await write_example(ctx)
    graph = (await client.get("/api/graph")).json()
    assert [person["full_name"] for person in graph["people"]] == ["Ali bin Hassan"]
    assert not (settings.data_dir / "settings" / "app.json").exists() or "me" not in json.loads(
        (settings.data_dir / "settings" / "app.json").read_text(encoding="utf-8")
    )
