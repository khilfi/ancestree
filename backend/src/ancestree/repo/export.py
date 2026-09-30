"""Reading everything, as raw properties, for backups and exports."""

from typing import Any, LiteralString

from neo4j import AsyncDriver, RoutingControl


async def export_graph(driver: AsyncDriver, database: str) -> dict[str, Any]:
    async def rows(query: LiteralString) -> list[dict[str, Any]]:
        records, _, _ = await driver.execute_query(
            query, database_=database, routing_=RoutingControl.READ
        )
        return [record.data() for record in records]

    people = await rows("MATCH (p:Person) RETURN properties(p) AS person ORDER BY p.id")
    links = await rows(
        """
        MATCH (a:Person)-[r:PARENT_OF|SPOUSE_OF]->(b:Person)
        RETURN type(r) AS type, a.id AS source, b.id AS target, properties(r) AS properties
        ORDER BY r.id
        """
    )
    kinds = await rows(
        "MATCH (k:RelationshipKind) RETURN properties(k) AS kind ORDER BY k.sort_order, k.key"
    )
    schema = await rows("MATCH (m:Migration) RETURN max(m.version) AS version")
    return {
        "schema_version": schema[0]["version"],
        "people": [row["person"] for row in people],
        "links": links,
        "relationship_kinds": [row["kind"] for row in kinds],
    }
