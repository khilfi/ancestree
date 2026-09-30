"""The family in memory reads each person as the database does.

A copy to edit works out each person's view itself, from the family it carries. It follows
`FamilyRows`, whose golden files it's proven against; this proves `FamilyRows` against the
database queries the app itself uses (repo/people.py)."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.domain.person import Person
from ancestree.domain.relationship import ParentLink
from ancestree.kinship.terms import TermBook
from ancestree.migrations.runner import apply_migrations
from ancestree.repo import kinds as kinds_repo
from ancestree.repo.people import add_parent_links, upsert_people
from ancestree.seed.loader import load_seed
from ancestree.services.detail import FamilyRows, load_detail

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def test_the_family_in_memory_reads_each_person_as_the_database_does(
    driver: AsyncDriver, settings: Settings
) -> None:
    await apply_migrations(driver, settings.neo4j_database)  # the relationship kinds
    await load_seed(driver, settings.neo4j_database)
    async with driver.session(database=settings.neo4j_database) as session:

        async def everything(tx: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
            people = await (await tx.run("MATCH (p:Person) RETURN properties(p) AS p")).data()
            links = await (
                await tx.run(
                    """
                    MATCH (a:Person)-[r:PARENT_OF|SPOUSE_OF]->(b:Person)
                    RETURN CASE type(r) WHEN 'PARENT_OF' THEN 'parent' ELSE 'spouse' END AS type,
                           a.id AS source, b.id AS target, properties(r) AS props
                    """
                )
            ).data()
            return [row["p"] for row in people], links

        people, rows = await session.execute_read(everything)
        kinds = await session.execute_read(kinds_repo.fetch_kinds)
        links = [
            {
                "id": row["props"]["id"],
                "type": row["type"],
                "source": row["source"],
                "target": row["target"],
                "kind": row["props"].get("kind"),
                "status": row["props"].get("status"),
                "order": row["props"].get("order"),
            }
            for row in rows
        ]
        family = FamilyRows(people, links)

        checked = 0
        for props in people:
            for language in ("en", "ms"):
                expected = await session.execute_read(load_detail, props["id"], language)
                assert family.detail(props["id"], kinds, TermBook.load(language)) == expected
                checked += 1
    assert checked == 2 * len(people) > 80


async def test_two_parents_of_one_gender_are_listed_alike_whatever_the_database_gives(
    driver: AsyncDriver, settings: Settings
) -> None:
    """A restore can hand links back in another order: the view mustn't follow it."""
    database = settings.neo4j_database
    await apply_migrations(driver, database)
    first, second = (
        Person(id=uuid4(), full_name="Parent A"),
        Person(id=uuid4(), full_name="Parent B"),
    )
    children = [Person(id=uuid4(), full_name=f"Child {n}") for n in (1, 2)]
    await upsert_people(driver, database, [first, second, *children], source="test")
    # For one child the links are made in the order of their ids, for the other the other way.
    for child, order in zip(children, ((1, 2), (4, 3)), strict=True):
        for number in order:
            parent = first if number % 2 else second
            link = ParentLink(id=UUID(int=number), parent_id=parent.id, child_id=child.id)
            await add_parent_links(driver, database, [link])

    async with driver.session(database=database) as session:
        for child in children:
            detail = await session.execute_read(load_detail, str(child.id), "en")
            assert [parent.id for parent in detail.parents] == [first.id, second.id]
            assert detail.sibling_position == "Child of Parent A & Parent B"
