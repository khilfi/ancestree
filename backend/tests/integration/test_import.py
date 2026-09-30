import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.importing.apply import (
    ImportRefusedError,
    apply_plan,
    latest_import,
    undo_import,
)
from ancestree.migrations.runner import apply_migrations
from ancestree.repo.people import count_people_by_source
from ancestree.seed.loader import load_seed, remove_seed
from ancestree.services.context import Context
from tests.import_fixtures import plan_for
from tests.integration.conftest import get_person

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def context(driver: AsyncDriver, settings: Settings) -> Context:
    return Context(driver, settings.neo4j_database, settings.data_dir)


async def test_an_import_lands_whole_and_can_be_taken_back_out(
    driver: AsyncDriver, settings: Settings, client: httpx.AsyncClient
) -> None:
    await apply_migrations(driver, settings.neo4j_database)
    ctx = context(driver, settings)

    result = await apply_plan(ctx, plan_for(), review_text="answers: {}\n", report="report")

    assert (result.people, result.placeholders, result.parent_links, result.marriages) == (
        22,
        2,
        28,
        5,
    )
    assert result.backup.exists()
    [rosli] = (await client.get("/api/persons", params={"q": "Rosli Bin Kamal"})).json()
    detail = await get_person(client, rosli["id"])
    # Salmah's and Ja'far's genders aren't in the files, so he's the eldest child, not son.
    assert detail["sibling_position"] == "Eldest child of Kamal Bin Daud & Kalsom Binti Yusof"
    assert [s["full_name"] for s in detail["siblings"]] == ["Salmah", "Ja'far"]
    assert detail["nickname"] == "Li"
    assert (settings.data_dir / "people" / rosli["id"] / "person.json").exists()
    assert (result.record / "people.json").exists()

    record = latest_import(settings.data_dir)
    assert record is not None
    assert record["tag"] == result.tag
    assert await undo_import(ctx, record) == 24
    assert await count_people_by_source(driver, settings.neo4j_database) == {}
    assert not (settings.data_dir / "people" / rosli["id"]).exists()
    assert latest_import(settings.data_dir) is None


async def test_an_import_neither_mixes_with_the_test_family_nor_runs_twice(
    driver: AsyncDriver, settings: Settings
) -> None:
    await apply_migrations(driver, settings.neo4j_database)
    ctx = context(driver, settings)
    await load_seed(driver, settings.neo4j_database)

    with pytest.raises(ImportRefusedError, match="unseed"):
        await apply_plan(ctx, plan_for(), review_text="", report="")

    await remove_seed(driver, settings.neo4j_database)
    await apply_plan(ctx, plan_for(), review_text="", report="")
    with pytest.raises(ImportRefusedError, match="already has 24 people"):
        await apply_plan(ctx, plan_for(), review_text="", report="")
