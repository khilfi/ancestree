"""Loading and removing the test family. It is never mixed with real people."""

from dataclasses import dataclass

from neo4j import AsyncDriver

from ancestree.repo.people import (
    add_parent_links,
    add_spouse_links,
    count_people_by_source,
    delete_people_from_source,
    upsert_people,
)
from ancestree.seed.family import SEED_SOURCE, load_seed_family


class SeedRefusedError(Exception):
    """Raised instead of mixing the fictional family with real people."""


@dataclass(frozen=True)
class SeedResult:
    people: int
    parent_links: int
    spouse_links: int


async def load_seed(driver: AsyncDriver, database: str) -> SeedResult:
    """(Re)load the test family. Refuses if the database holds anyone else."""
    counts = await count_people_by_source(driver, database)
    others = sum(count for source, count in counts.items() if source != SEED_SOURCE)
    if others:
        raise SeedRefusedError(
            f"The database holds {others} people who are not part of the test family. "
            "Refusing to mix fictional and real data."
        )
    await delete_people_from_source(driver, database, SEED_SOURCE)

    family = load_seed_family()
    people = family.people_as_domain()
    parent_links = family.parent_links()
    spouse_links = family.spouse_links()
    await upsert_people(driver, database, people, source=SEED_SOURCE)
    written_parents = await add_parent_links(driver, database, parent_links)
    written_spouses = await add_spouse_links(driver, database, spouse_links)
    if (written_parents, written_spouses) != (len(parent_links), len(spouse_links)):
        raise RuntimeError("Some test-family links could not be written. Have migrations run?")
    return SeedResult(len(people), written_parents, written_spouses)


async def remove_seed(driver: AsyncDriver, database: str) -> list[str]:
    """Delete the test family and its links; return the ids of the people removed."""
    return await delete_people_from_source(driver, database, SEED_SOURCE)
