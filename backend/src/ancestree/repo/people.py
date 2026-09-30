"""People: bulk writes for seeding and importing, and per-request queries.

Per-request functions take a transaction (`tx`), so a service can check its rules and
write in one consistent transaction.
"""

from collections.abc import Sequence
from typing import Any

from neo4j import AsyncDriver, AsyncManagedTransaction, RoutingControl

from ancestree.domain.person import Person
from ancestree.domain.relationship import ParentLink, SpouseLink
from ancestree.repo.mapping import person_to_props


async def upsert_people(
    driver: AsyncDriver, database: str, people: Sequence[Person], *, source: str | None = None
) -> None:
    """Create or update people by id; `source` records where they came from."""
    rows = [{"id": str(p.id), "props": person_to_props(p) | {"source": source}} for p in people]
    await driver.execute_query(
        """
        UNWIND $rows AS row
        MERGE (p:Person {id: row.id})
        ON CREATE SET p.created_at = datetime()
        SET p += row.props, p.updated_at = datetime()
        """,
        rows=rows,
        database_=database,
    )


async def add_parent_links(driver: AsyncDriver, database: str, links: Sequence[ParentLink]) -> int:
    """Write parent -> child links; return how many were written.

    A link is skipped if either person or its relationship kind doesn't exist.
    """
    rows = [
        {
            "id": str(link.id),
            "parent_id": str(link.parent_id),
            "child_id": str(link.child_id),
            "kind": link.kind,
        }
        for link in links
    ]
    records, _, _ = await driver.execute_query(
        """
        UNWIND $rows AS row
        MATCH (parent:Person {id: row.parent_id}), (child:Person {id: row.child_id}),
              (:RelationshipKind {key: row.kind})
        MERGE (parent)-[r:PARENT_OF {id: row.id}]->(child)
        SET r.kind = row.kind
        RETURN count(r) AS written
        """,
        rows=rows,
        database_=database,
    )
    return int(records[0]["written"])


async def add_spouse_links(driver: AsyncDriver, database: str, links: Sequence[SpouseLink]) -> int:
    """Write spouse links; return how many were written."""
    rows = [
        {
            "id": str(link.id),
            "a": str(link.person_a),
            "b": str(link.person_b),
            "status": link.status.value,
            "order": link.order,
        }
        for link in links
    ]
    records, _, _ = await driver.execute_query(
        """
        UNWIND $rows AS row
        MATCH (a:Person {id: row.a}), (b:Person {id: row.b})
        MERGE (a)-[r:SPOUSE_OF {id: row.id}]->(b)
        SET r.status = row.status, r.order = row.order
        RETURN count(r) AS written
        """,
        rows=rows,
        database_=database,
    )
    return int(records[0]["written"])


async def count_people_by_source(driver: AsyncDriver, database: str) -> dict[str | None, int]:
    records, _, _ = await driver.execute_query(
        "MATCH (p:Person) RETURN p.source AS source, count(*) AS people",
        database_=database,
        routing_=RoutingControl.READ,
    )
    return {record["source"]: int(record["people"]) for record in records}


async def delete_people_from_source(driver: AsyncDriver, database: str, source: str) -> list[str]:
    """Delete everyone from one source, with their links; return their ids."""
    records, _, _ = await driver.execute_query(
        """
        MATCH (p:Person {source: $source})
        WITH p, p.id AS id
        DETACH DELETE p
        RETURN collect(id) AS deleted
        """,
        source=source,
        database_=database,
    )
    return [str(person_id) for person_id in records[0]["deleted"]]


# --- Per-request queries --------------------------------------------------------------------

Tx = AsyncManagedTransaction


async def fetch_person(tx: Tx, person_id: str) -> dict[str, Any] | None:
    result = await tx.run("MATCH (p:Person {id: $id}) RETURN properties(p) AS person", id=person_id)
    record = await result.single()
    return dict(record["person"]) if record else None


async def fetch_people(tx: Tx, person_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
    result = await tx.run(
        "MATCH (p:Person) WHERE p.id IN $ids RETURN properties(p) AS person", ids=list(person_ids)
    )
    return {row["person"]["id"]: dict(row["person"]) for row in await result.data()}


async def create_person(tx: Tx, props: dict[str, Any]) -> None:
    await tx.run(
        "CREATE (p:Person) SET p = $props, p.created_at = datetime(), p.updated_at = datetime()",
        props=props,
    )


async def update_person(tx: Tx, person_id: str, props: dict[str, Any]) -> bool:
    result = await tx.run(
        "MATCH (p:Person {id: $id}) SET p += $props, p.updated_at = datetime() RETURN p.id AS id",
        id=person_id,
        props=props,
    )
    return await result.single() is not None


async def delete_person(tx: Tx, person_id: str) -> None:
    await tx.run("MATCH (p:Person {id: $id}) DETACH DELETE p", id=person_id)


async def set_photo(tx: Tx, person_id: str, *, has_photo: bool) -> int:
    """Record whether there's a photo and bump the version that busts browser caches."""
    result = await tx.run(
        """
        MATCH (p:Person {id: $id})
        SET p.has_photo = $has_photo, p.photo_version = coalesce(p.photo_version, 0) + 1,
            p.updated_at = datetime()
        RETURN p.photo_version AS version
        """,
        id=person_id,
        has_photo=has_photo,
    )
    record = await result.single()
    return int(record["version"]) if record else 0


async def set_birth_orders(tx: Tx, orders: dict[str, int]) -> None:
    await tx.run(
        "UNWIND $rows AS row MATCH (p:Person {id: row.id}) SET p.birth_order = row.position",
        rows=[{"id": person_id, "position": position} for person_id, position in orders.items()],
    )


async def fetch_parents(tx: Tx, person_id: str) -> list[dict[str, Any]]:
    result = await tx.run(
        """
        MATCH (parent:Person)-[link:PARENT_OF]->(:Person {id: $id})
        RETURN properties(parent) AS person, properties(link) AS link
        """,
        id=person_id,
    )
    return await result.data()


async def fetch_spouses(tx: Tx, person_id: str) -> list[dict[str, Any]]:
    result = await tx.run(
        """
        MATCH (:Person {id: $id})-[link:SPOUSE_OF]-(spouse:Person)
        RETURN properties(spouse) AS person, properties(link) AS link
        """,
        id=person_id,
    )
    return await result.data()


async def fetch_children(tx: Tx, person_id: str) -> list[dict[str, Any]]:
    """Each child, the link to them, and all their parents as {id, kind}, to group families."""
    result = await tx.run(
        """
        MATCH (:Person {id: $id})-[link:PARENT_OF]->(child:Person)
        MATCH (parent:Person)-[parent_link:PARENT_OF]->(child)
        RETURN properties(child) AS person, properties(link) AS link,
               collect({id: parent.id, kind: coalesce(parent_link.kind, 'biological')}) AS parents
        """,
        id=person_id,
    )
    return await result.data()


async def fetch_siblings(tx: Tx, person_id: str) -> list[dict[str, Any]]:
    """Everyone sharing a parent: each shared parent with both links' kinds, and all theirs."""
    result = await tx.run(
        """
        MATCH (me:Person {id: $id})<-[mine:PARENT_OF]-(shared:Person)
              -[theirs:PARENT_OF]->(sibling:Person)
        WHERE sibling <> me
        WITH sibling, collect({
            id: shared.id,
            mine: coalesce(mine.kind, 'biological'),
            theirs: coalesce(theirs.kind, 'biological')
        }) AS shared
        MATCH (parent:Person)-[link:PARENT_OF]->(sibling)
        RETURN properties(sibling) AS person, shared,
               collect({id: parent.id, kind: coalesce(link.kind, 'biological')}) AS parents
        """,
        id=person_id,
    )
    return await result.data()


async def fetch_links_of(tx: Tx, person_id: str) -> list[dict[str, Any]]:
    result = await tx.run(
        """
        MATCH (:Person {id: $id})-[link:PARENT_OF|SPOUSE_OF]-(:Person)
        RETURN type(link) AS type, startNode(link).id AS source, endNode(link).id AS target,
               properties(link) AS props
        """,
        id=person_id,
    )
    return await result.data()


async def find_by_name(tx: Tx, full_name: str) -> list[dict[str, Any]]:
    result = await tx.run(
        """
        MATCH (p:Person)
        WHERE toLower(p.full_name) = toLower($name) AND NOT coalesce(p.placeholder, false)
        RETURN properties(p) AS person
        """,
        name=full_name,
    )
    return [row["person"] for row in await result.data()]


async def searchable(tx: Tx) -> list[dict[str, Any]]:
    """Everyone a search can find, with what a search result shows. The finding itself is
    domain/search.py's, so a view-only copy can find people the same way."""
    result = await tx.run(
        """
        MATCH (p:Person) WHERE NOT coalesce(p.placeholder, false)
        RETURN p {.id, .full_name, .nickname, .gender, .birth_year, .death_year,
                  .photo_version, .has_photo, .placeholder} AS person
        """
    )
    return [dict(row["person"]) for row in await result.data()]
