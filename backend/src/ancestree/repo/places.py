"""Where everyone lives and was born, for the map; and, for someone
with no place of their own, what says where they live: whom they live with, whether
they've died, and their parents, birth parents first, with how each is their parent, so only
those they can live with are taken."""

from dataclasses import dataclass, field
from typing import Any

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.person import LivesWith, PartialDate, Place
from ancestree.repo.mapping import date_from_props, place_from


@dataclass(frozen=True)
class Places:
    id: str
    lives: Place | None
    born: Place | None
    lives_with: LivesWith | None = None
    living: bool | None = None  # as set by hand
    born_on: PartialDate | None = None
    died_on: PartialDate | None = None
    # Each parent's details (unknown parents aside), with the kind of their link.
    parents: tuple[tuple[dict[str, Any], str], ...] = field(default=())
    died: Place | None = None  # where they died


async def read_places(tx: Tx) -> list[Places]:
    """Everyone but unknown parents, in no particular order."""
    result = await tx.run(
        """
        MATCH (p:Person) WHERE NOT coalesce(p.placeholder, false)
        OPTIONAL MATCH (parent:Person)-[link:PARENT_OF]->(p)
        WHERE NOT coalesce(parent.placeholder, false)
        WITH p, parent, link
        ORDER BY coalesce(link.kind, 'biological') <> 'biological', link.id
        RETURN properties(p) AS props,
               collect([properties(parent), coalesce(link.kind, 'biological')]) AS parents
        """
    )
    rows = []
    for row in await result.data():
        props = row["props"]
        rows.append(
            Places(
                props["id"],
                place_from("residence", props),
                place_from("birth", props),
                props.get("lives_with"),
                props.get("living"),
                date_from_props("birth", props),
                date_from_props("death", props),
                tuple((parent, str(kind)) for parent, kind in row["parents"] if parent),
                died=place_from("death", props),
            )
        )
    return rows


async def read_addresses(tx: Tx) -> list[tuple[str, dict[str, Place]]]:
    """Everyone's places with an address or a postcode, by id, each by its prefix
    ("residence", "birth", "death"): those a pin can be placed for from the address."""
    result = await tx.run(
        """
        MATCH (p:Person) WHERE NOT coalesce(p.placeholder, false)
          AND (p.residence_address IS NOT NULL OR p.residence_postcode IS NOT NULL
               OR p.birth_address IS NOT NULL OR p.birth_postcode IS NOT NULL
               OR p.death_address IS NOT NULL OR p.death_postcode IS NOT NULL)
        RETURN properties(p) AS props
        """
    )
    rows = []
    for row in await result.data():
        props = row["props"]
        owned = {
            prefix: place
            for prefix in ("residence", "birth", "death")
            if (place := place_from(prefix, props)) is not None
            and (place.address or place.postcode)
        }
        rows.append((str(props["id"]), owned))
    return rows
