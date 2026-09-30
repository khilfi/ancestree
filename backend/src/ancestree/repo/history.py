"""Reading and writing exactly the people and links one change touched (undo).

Values stay as Neo4j gives them (date-times included), so writing one back puts back
exactly what was there.
"""

from collections.abc import Iterable, Mapping
from typing import Any, LiteralString

from neo4j import AsyncManagedTransaction as Tx

Props = dict[str, Any]
Link = dict[str, Any]  # {type, source, target, props}
POSITION = frozenset({"layout_x", "layout_y"})  # where someone sits on the tree canvas


async def clock(tx: Tx) -> Any:
    """The database's own time: new people and links are stamped with it."""
    record = await (await tx.run("RETURN datetime() AS now")).single()
    return record["now"] if record else None


async def neighbourhood(tx: Tx, ids: Iterable[str]) -> tuple[dict[str, Props], dict[str, Link]]:
    """The people `ids`, everyone linked to them, and every link they have."""
    result = await tx.run(
        """
        MATCH (p:Person) WHERE p.id IN $ids
        OPTIONAL MATCH (p)-[r:PARENT_OF|SPOUSE_OF]-(q:Person)
        WITH collect(DISTINCT p) + collect(DISTINCT q) AS people, collect(DISTINCT r) AS links
        RETURN [x IN people | properties(x)] AS people,
               [r IN links | {type: type(r), source: startNode(r).id, target: endNode(r).id,
                              props: properties(r)}] AS links
        """,
        ids=list(ids),
    )
    record = await result.single()
    if record is None:
        return {}, {}
    return _keyed(record["people"], record["links"])


def _keyed(
    people: Iterable[Mapping[str, Any]], links: Iterable[Mapping[str, Any]]
) -> tuple[dict[str, Props], dict[str, Link]]:
    return (
        {person["id"]: dict(person) for person in people},
        {
            link["props"]["id"]: {**link, "props": dict(link["props"])}
            for link in links
            if link["props"].get("id")
        },
    )


async def people_by_id(tx: Tx, ids: Iterable[str]) -> dict[str, Props]:
    result = await tx.run(
        "MATCH (p:Person) WHERE p.id IN $ids RETURN properties(p) AS person", ids=list(ids)
    )
    return {row["person"]["id"]: dict(row["person"]) for row in await result.data()}


async def properties(tx: Tx, ids: Iterable[str] | None, keys: Iterable[str]) -> dict[str, Props]:
    """Just these properties (None where one isn't set), of the people `ids` or everyone.
    Much quicker than all of them: the date-times cost most to read."""
    names = sorted(keys)
    query: LiteralString = (
        "MATCH (p:Person) RETURN p.id AS id, [k IN $keys | p[k]] AS values"
        if ids is None
        else "MATCH (p:Person) WHERE p.id IN $ids RETURN p.id AS id, [k IN $keys | p[k]] AS values"
    )
    result = await tx.run(query, ids=None if ids is None else list(ids), keys=names)
    return {row["id"]: dict(zip(names, row["values"], strict=True)) for row in await result.data()}


async def links_by_id(tx: Tx, ids: Iterable[str]) -> dict[str, Link]:
    result = await tx.run(
        """
        MATCH (a:Person)-[r:PARENT_OF|SPOUSE_OF]->(b:Person) WHERE r.id IN $ids
        RETURN type(r) AS type, a.id AS source, b.id AS target, properties(r) AS props
        """,
        ids=list(ids),
    )
    return {row["props"]["id"]: {**row, "props": dict(row["props"])} for row in await result.data()}


async def other_links(tx: Tx, people: Iterable[str], leaving: Iterable[str]) -> int:
    """How many links these people have besides the ones `leaving`."""
    result = await tx.run(
        """
        MATCH (p:Person)-[r:PARENT_OF|SPOUSE_OF]-() WHERE p.id IN $people AND NOT r.id IN $leaving
        RETURN count(DISTINCT r) AS links
        """,
        people=list(people),
        leaving=list(leaving),
    )
    record = await result.single()
    return int(record["links"]) if record else 0


async def kinds_present(tx: Tx, keys: Iterable[str]) -> set[str]:
    result = await tx.run(
        "MATCH (k:RelationshipKind) WHERE k.key IN $keys RETURN k.key AS key", keys=list(keys)
    )
    return {row["key"] for row in await result.data()}


async def delete_links(tx: Tx, ids: Iterable[str]) -> None:
    await tx.run("MATCH ()-[r:PARENT_OF|SPOUSE_OF]->() WHERE r.id IN $ids DELETE r", ids=list(ids))


async def delete_people(tx: Tx, ids: Iterable[str]) -> None:
    await tx.run("MATCH (p:Person) WHERE p.id IN $ids DELETE p", ids=list(ids))


async def create_people(tx: Tx, people: Iterable[Props]) -> None:
    await tx.run("UNWIND $rows AS row CREATE (p:Person) SET p = row", rows=list(people))


async def update_people(tx: Tx, changes: Mapping[str, Props]) -> None:
    """Set the given properties; None removes one. The time of the change is recorded,
    unless only where someone sits changed: like dragging them, that isn't a change to them."""
    await tx.run(
        """
        UNWIND $rows AS row
        MATCH (p:Person {id: row.id})
        SET p += row.props
        FOREACH (_ IN CASE WHEN row.stamp THEN [1] ELSE [] END | SET p.updated_at = datetime())
        """,
        rows=[
            {"id": pid, "props": props, "stamp": bool(props.keys() - POSITION)}
            for pid, props in changes.items()
        ],
    )


_CREATE: dict[str, LiteralString] = {
    "PARENT_OF": """
        UNWIND $rows AS row
        MATCH (a:Person {id: row.source}), (b:Person {id: row.target})
        CREATE (a)-[r:PARENT_OF]->(b) SET r = row.props
        """,
    "SPOUSE_OF": """
        UNWIND $rows AS row
        MATCH (a:Person {id: row.source}), (b:Person {id: row.target})
        CREATE (a)-[r:SPOUSE_OF]->(b) SET r = row.props
        """,
}


async def create_links(tx: Tx, links: Iterable[Link]) -> None:
    rows = list(links)
    for link_type, query in _CREATE.items():  # a type can't be a query parameter
        of_type = [link for link in rows if link["type"] == link_type]
        if of_type:
            await tx.run(query, rows=of_type)


async def update_links(tx: Tx, changes: Mapping[str, Props]) -> None:
    await tx.run(
        """
        UNWIND $rows AS row
        MATCH ()-[r:PARENT_OF|SPOUSE_OF {id: row.id}]->()
        SET r += row.props
        """,
        rows=[{"id": lid, "props": props} for lid, props in changes.items()],
    )
