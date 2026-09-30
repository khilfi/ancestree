"""The two stored relationships: PARENT_OF (parent -> child) and SPOUSE_OF."""

from typing import Any

from neo4j import AsyncManagedTransaction as Tx


async def links_between(tx: Tx, a: str, b: str) -> list[dict[str, Any]]:
    result = await tx.run(
        """
        MATCH (:Person {id: $a})-[link:PARENT_OF|SPOUSE_OF]-(:Person {id: $b})
        RETURN type(link) AS type, startNode(link).id AS source, properties(link) AS props
        """,
        a=a,
        b=b,
    )
    return await result.data()


async def is_ancestor(tx: Tx, ancestor: str, descendant: str) -> bool:
    result = await tx.run(
        """
        RETURN EXISTS {
            MATCH (:Person {id: $ancestor})-[:PARENT_OF*1..]->(:Person {id: $descendant})
        } AS found
        """,
        ancestor=ancestor,
        descendant=descendant,
    )
    record = await result.single()
    return bool(record and record["found"])


async def blood_parents(tx: Tx, child_id: str) -> list[dict[str, Any]]:
    result = await tx.run(
        """
        MATCH (parent:Person)-[link:PARENT_OF]->(:Person {id: $id})
        MATCH (kind:RelationshipKind {key: link.kind}) WHERE kind.blood
        RETURN parent.id AS id, parent.full_name AS name
        """,
        id=child_id,
    )
    return await result.data()


async def parent_ids(tx: Tx, person_id: str) -> dict[str, str]:
    """Parent id -> the kind of that parent link."""
    result = await tx.run(
        "MATCH (parent:Person)-[link:PARENT_OF]->(:Person {id: $id}) "
        "RETURN parent.id AS id, link.kind AS kind",
        id=person_id,
    )
    return {row["id"]: row["kind"] for row in await result.data()}


async def create_parent_link(
    tx: Tx, link_id: str, parent_id: str, child_id: str, kind: str
) -> None:
    await tx.run(
        """
        MATCH (parent:Person {id: $parent}), (child:Person {id: $child})
        CREATE (parent)-[:PARENT_OF {id: $id, kind: $kind, created_at: datetime()}]->(child)
        """,
        id=link_id,
        parent=parent_id,
        child=child_id,
        kind=kind,
    )


async def create_spouse_link(tx: Tx, link_id: str, a: str, b: str, status: str) -> None:
    await tx.run(
        """
        MATCH (a:Person {id: $a}), (b:Person {id: $b})
        CREATE (a)-[:SPOUSE_OF {id: $id, status: $status, created_at: datetime()}]->(b)
        """,
        id=link_id,
        a=a,
        b=b,
        status=status,
    )


async def fetch_link(tx: Tx, link_id: str) -> dict[str, Any] | None:
    result = await tx.run(
        """
        MATCH (a:Person)-[link:PARENT_OF|SPOUSE_OF {id: $id}]->(b:Person)
        RETURN type(link) AS type, a.id AS source, b.id AS target, properties(link) AS props
        """,
        id=link_id,
    )
    record = await result.single()
    return record.data() if record else None


async def update_link(tx: Tx, link_id: str, props: dict[str, Any]) -> None:
    await tx.run(
        "MATCH ()-[link:PARENT_OF|SPOUSE_OF {id: $id}]->() SET link += $props",
        id=link_id,
        props=props,
    )


async def delete_link(tx: Tx, link_id: str) -> None:
    await tx.run("MATCH ()-[link:PARENT_OF|SPOUSE_OF {id: $id}]->() DELETE link", id=link_id)
