"""Reading the whole family in the lightweight shape the tree and the relationship finder need.

The Python driver spends most of its time per record, so everyone comes back as one list of
values rather than a record each: three to four times quicker at 2,000 people.
"""

from collections.abc import Sequence
from typing import Any

from neo4j import AsyncDriver, RoutingControl

_PERSON_FIELDS = (
    "id",
    "full_name",
    "nickname",
    "gender",
    "birth_year",
    "birth_month",
    "birth_day",
    "birth_qualifier",
    "birth_year_to",
    "death_year",
    "death_month",
    "death_day",
    "death_qualifier",
    "death_year_to",
    "living",
    "birth_order",
    "placeholder",
    "photo_version",
    "birth_town",
    "birth_state",
    "birth_country",
    "x",
    "y",
    "birth_original_text",
)
_LINK_FIELDS = ("id", "type", "source", "target", "kind", "status", "order")


async def read_family(
    driver: AsyncDriver, database: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, bool]]:
    """People, links, and whether each relationship kind places a child on the rings."""
    people, _, _ = await driver.execute_query(
        """
        MATCH (p:Person)
        WITH p ORDER BY p.birth_year, p.full_name
        RETURN collect([p.id, p.full_name, p.nickname, coalesce(p.gender, 'unknown'),
                        p.birth_year, p.birth_month, p.birth_day, p.birth_qualifier,
                        p.birth_year_to, p.death_year, p.death_month, p.death_day,
                        p.death_qualifier, p.death_year_to, p.living,
                        p.birth_order, coalesce(p.placeholder, false),
                        CASE WHEN p.has_photo THEN p.photo_version END,
                        p.birth_town, p.birth_state, p.birth_country,
                        p.layout_x, p.layout_y, p.birth_original_text]) AS rows
        """,
        database_=database,
        routing_=RoutingControl.READ,
    )
    links, _, _ = await driver.execute_query(
        """
        MATCH (a:Person)-[r:PARENT_OF|SPOUSE_OF]->(b:Person)
        WITH r, a, b, CASE type(r) WHEN 'PARENT_OF' THEN 'parent' ELSE 'spouse' END AS type
        ORDER BY type, r.id
        RETURN collect([r.id, type, a.id, b.id, r.kind, r.status, r.order]) AS rows
        """,
        database_=database,
        routing_=RoutingControl.READ,
    )
    kinds, _, _ = await driver.execute_query(
        "MATCH (k:RelationshipKind) RETURN k.key AS key, coalesce(k.in_layout, true) AS in_layout",
        database_=database,
        routing_=RoutingControl.READ,
    )
    return (
        [dict(zip(_PERSON_FIELDS, row, strict=True)) for row in people[0]["rows"]],
        [dict(zip(_LINK_FIELDS, row, strict=True)) for row in links[0]["rows"]],
        {record["key"]: bool(record["in_layout"]) for record in kinds},
    )


async def save_positions(
    driver: AsyncDriver, database: str, positions: Sequence[dict[str, Any]]
) -> None:
    """Where people were dragged to; None puts someone back on their place on the rings."""
    await driver.execute_query(
        """
        UNWIND $rows AS row
        MATCH (p:Person {id: row.id})
        SET p.layout_x = row.x, p.layout_y = row.y
        """,
        rows=list(positions),
        database_=database,
    )


async def clear_positions(driver: AsyncDriver, database: str) -> None:
    await driver.execute_query(
        "MATCH (p:Person) WHERE p.layout_x IS NOT NULL REMOVE p.layout_x, p.layout_y",
        database_=database,
    )
