"""What an import reads of the tree, in its own transaction."""

from collections.abc import Iterable
from typing import Any

from neo4j import AsyncManagedTransaction as Tx


async def read_tree(tx: Tx) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Everyone, with all they hold, and every link as {type, source, target}."""
    people = await tx.run("MATCH (p:Person) RETURN properties(p) AS person")
    person_rows = [dict(row["person"]) for row in await people.data()]
    links = await tx.run(
        """
        MATCH (a:Person)-[r:PARENT_OF|SPOUSE_OF]->(b:Person)
        RETURN CASE type(r) WHEN 'PARENT_OF' THEN 'parent' ELSE 'spouse' END AS type,
               a.id AS source, b.id AS target
        """
    )
    return person_rows, await links.data()


async def read_whole_tree(tx: Tx) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Everyone, with all they hold, unknown parents too; and every link as {id, type, source,
    target, kind, status}: what a relative's changes are compared with (M26)."""
    people = await tx.run("MATCH (p:Person) RETURN properties(p) AS person")
    person_rows = [dict(row["person"]) for row in await people.data()]
    links = await tx.run(
        """
        MATCH (a:Person)-[r:PARENT_OF|SPOUSE_OF]->(b:Person)
        RETURN r.id AS id, CASE type(r) WHEN 'PARENT_OF' THEN 'parent' ELSE 'spouse' END AS type,
               a.id AS source, b.id AS target, r.kind AS kind, r.status AS status
        """
    )
    return person_rows, await links.data()


async def people_present(tx: Tx, ids: Iterable[str]) -> set[str]:
    """Which of these people are still in the tree."""
    result = await tx.run("MATCH (p:Person) WHERE p.id IN $ids RETURN p.id AS id", ids=list(ids))
    return {str(row["id"]) for row in await result.data()}
