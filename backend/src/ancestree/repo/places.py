"""Where everyone lives and was born, for the map."""

from dataclasses import dataclass

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.person import Place
from ancestree.repo.mapping import place_from


@dataclass(frozen=True)
class Places:
    id: str
    lives: Place | None
    born: Place | None


async def read_places(tx: Tx) -> list[Places]:
    """Everyone but unknown parents, in no particular order."""
    result = await tx.run(
        """
        MATCH (p:Person) WHERE NOT coalesce(p.placeholder, false)
        RETURN p.id AS id,
               {residence_town: p.residence_town, residence_state: p.residence_state,
                residence_country: p.residence_country, birth_town: p.birth_town,
                birth_state: p.birth_state, birth_country: p.birth_country} AS places
        """
    )
    return [
        Places(
            row["id"],
            place_from("residence", row["places"]),
            place_from("birth", row["places"]),
        )
        for row in await result.data()
    ]
