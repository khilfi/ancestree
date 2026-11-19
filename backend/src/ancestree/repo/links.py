"""The two stored relationships: PARENT_OF (parent -> child) and SPOUSE_OF."""

from typing import Any, LiteralString

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


async def create_spouse_link(
    tx: Tx, link_id: str, a: str, b: str, status: str, order: int | None = None
) -> None:
    """A marriage; with `order`, its place among a person's marriages: none is kept
    without one."""
    await tx.run(
        """
        MATCH (a:Person {id: $a}), (b:Person {id: $b})
        CREATE (a)-[:SPOUSE_OF {id: $id, status: $status, order: $order,
                                created_at: datetime()}]->(b)
        """,
        id=link_id,
        a=a,
        b=b,
        status=status,
        order=order,
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


# A relationship's type can't be a query parameter, so each type has its own query.
_PUT_BACK: dict[str, LiteralString] = {
    "PARENT_OF": """
        MATCH (a:Person {id: $source}), (b:Person {id: $target})
        CREATE (a)-[r:PARENT_OF]->(b)
        SET r = $props, r.created_at = coalesce(datetime($made), datetime())
        """,
    "SPOUSE_OF": """
        MATCH (a:Person {id: $source}), (b:Person {id: $target})
        CREATE (a)-[r:SPOUSE_OF]->(b)
        SET r = $props, r.created_at = coalesce(datetime($made), datetime())
        """,
}


async def put_back_link(
    tx: Tx, link_type: str, source: str, target: str, props: dict[str, Any]
) -> None:
    """A link as it was, as plain JSON holds it (a Trash entry): every property kept, a
    marriage's order too, and when it was first made."""
    kept = {key: value for key, value in props.items() if key not in ("created_at", "updated_at")}
    await tx.run(
        _PUT_BACK[link_type], source=source, target=target, props=kept, made=props.get("created_at")
    )


async def as_stored(tx: Tx, link_ids: list[str]) -> list[dict[str, Any]]:
    """What the rules look at, for each of these links as the tree has it now, with them in
    it: who it joins, any other link between the two, whether the child is also the
    parent's ancestor, and the child's birth parents."""
    result = await tx.run(
        """
        UNWIND $ids AS id
        MATCH (a:Person)-[r:PARENT_OF|SPOUSE_OF {id: id}]->(b:Person)
        RETURN id, type(r) AS type, a.full_name AS source, b.full_name AS target,
               a = b AS itself,
               [(a)-[s:PARENT_OF|SPOUSE_OF]-(b) WHERE s <> r | type(s)] AS others,
               type(r) = 'PARENT_OF' AND EXISTS { (b)-[:PARENT_OF*1..]->(a) } AS loop,
               EXISTS { MATCH (k:RelationshipKind {key: r.kind}) WHERE k.blood } AS blood,
               [(p:Person)-[l:PARENT_OF]->(b)
                WHERE EXISTS { MATCH (k:RelationshipKind {key: l.kind}) WHERE k.blood }
                | {id: p.id, name: p.full_name}] AS birth_parents,
               a.id AS parent_id
        """,
        ids=link_ids,
    )
    return await result.data()
