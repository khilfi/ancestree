import json
from uuid import uuid7
from zipfile import ZipFile

import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.domain.person import Person
from ancestree.exchange.backup import create_backup
from ancestree.migrations.runner import apply_migrations
from ancestree.repo.kinds import list_relationship_kinds
from ancestree.repo.people import upsert_people
from ancestree.seed.family import load_seed_family
from ancestree.seed.loader import SeedRefusedError, load_seed, remove_seed
from ancestree.services.graph import load_graph

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def test_migrations_apply_once_and_create_the_default_kinds(
    driver: AsyncDriver, settings: Settings
) -> None:
    first = await apply_migrations(driver, settings.neo4j_database)
    second = await apply_migrations(driver, settings.neo4j_database)
    kinds = await list_relationship_kinds(driver, settings.neo4j_database)

    assert [m.version for m in first] == [1, 2, 3]
    assert second == []
    assert [(k.key, k.blood, k.builtin) for k in kinds] == [
        ("biological", True, True),
        ("adoptive", False, False),
        ("foster", False, False),
    ]
    # The starting kinds have their Malay and Javanese words.
    words = {k.key: {code: w.child_label.neutral for code, w in k.words.items()} for k in kinds}
    assert words["adoptive"] == {"ms": "anak angkat", "jv": "anak pupon"}
    assert words["foster"] == {"ms": "anak angkat", "jv": "anak asuh"}
    assert words["biological"] == {}


async def test_seed_loads_the_whole_test_family(driver: AsyncDriver, settings: Settings) -> None:
    await apply_migrations(driver, settings.neo4j_database)

    result = await load_seed(driver, settings.neo4j_database)
    again = await load_seed(driver, settings.neo4j_database)  # reloading replaces, never doubles
    graph = await load_graph(driver, settings.neo4j_database, None)

    family = load_seed_family()
    assert result == again
    assert len(graph.people) == result.people == len(family.people)
    assert sum(link.type == "parent" for link in graph.links) == len(family.parent_links())
    assert sum(link.type == "spouse" for link in graph.links) == len(family.spouse_links())
    assert {link.kind for link in graph.links if link.type == "parent"} == {
        "biological",
        "adoptive",
    }


async def test_seed_refuses_to_mix_with_real_people(
    driver: AsyncDriver, settings: Settings
) -> None:
    await apply_migrations(driver, settings.neo4j_database)
    await upsert_people(driver, settings.neo4j_database, [Person(id=uuid7(), full_name="Real")])

    with pytest.raises(SeedRefusedError, match="1 people who are not part of the test family"):
        await load_seed(driver, settings.neo4j_database)


async def test_unseed_removes_only_the_test_family(driver: AsyncDriver, settings: Settings) -> None:
    await apply_migrations(driver, settings.neo4j_database)
    await load_seed(driver, settings.neo4j_database)
    real = Person(id=uuid7(), full_name="Real")
    await upsert_people(driver, settings.neo4j_database, [real])

    removed = await remove_seed(driver, settings.neo4j_database)
    graph = await load_graph(driver, settings.neo4j_database, None)

    assert len(removed) == len(load_seed_family().people)
    assert [p.id for p in graph.people] == [real.id]
    assert graph.links == []


async def test_backup_holds_the_graph_the_files_and_valid_checksums(
    driver: AsyncDriver, settings: Settings
) -> None:
    await apply_migrations(driver, settings.neo4j_database)
    seeded = await load_seed(driver, settings.neo4j_database)
    story = settings.data_dir / "people" / "some-person" / "biography.md"
    story.parent.mkdir(parents=True)
    story.write_text("# A life\n\nBorn in Kota Bharu.\n", encoding="utf-8")

    result = await create_backup(
        driver, settings.neo4j_database, settings.data_dir, settings.data_dir / "exports"
    )

    assert result.path.name.startswith("ancestree-backup-")
    assert result.path.suffix == ".zip"
    with ZipFile(result.path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        graph = json.loads(archive.read("graph.json"))
        assert set(archive.namelist()) == {
            "graph.json",
            "manifest.json",
            "README.txt",
            "people/some-person/biography.md",
        }
        assert archive.read("people/some-person/biography.md").decode().startswith("# A life")
    assert manifest["schema_version"] == 3
    unknown = sum(1 for person in graph["people"] if person.get("placeholder"))
    assert manifest["counts"] == {
        "people": seeded.people - unknown,  # as the app counts them
        "unknown_parents": unknown,
        "links": seeded.parent_links + seeded.spouse_links,
        "files": 1,
    }
    assert unknown == 1
    assert len(graph["people"]) == seeded.people
    assert set(manifest["sha256"]) == {"graph.json", "people/some-person/biography.md"}
