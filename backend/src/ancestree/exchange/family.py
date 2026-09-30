"""Everyone, every link and every story, read once for an export."""

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ancestree.domain.person import Person, Place
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind, SpouseStatus
from ancestree.lineage.birth_order import Sibling, order_siblings
from ancestree.repo.export import export_graph
from ancestree.repo.kinds import kind_from_props
from ancestree.repo.mapping import person_from_props
from ancestree.services.biography import split_sources
from ancestree.services.context import Context
from ancestree.storage.biography import read_story


@dataclass(frozen=True)
class Member:
    person: Person
    added: str  # when they were added: a stable order where nothing else decides
    story: str = ""
    sources: tuple[str, ...] = ()

    @property
    def id(self) -> str:
        return str(self.person.id)


@dataclass(frozen=True)
class ParentRow:
    parent: str
    child: str
    kind: str


@dataclass(frozen=True)
class SpouseRow:
    a: str
    b: str
    status: SpouseStatus
    order: int | None


@dataclass(frozen=True)
class FamilyData:
    members: dict[str, Member]  # unknown parents included: they tie siblings together
    parents: list[ParentRow]
    spouses: list[SpouseRow]
    kinds: dict[str, RelationshipKind]

    def people(self) -> list[Member]:
        """Real people, without unknown parents, in the order they were added."""
        return sorted(
            (m for m in self.members.values() if not m.person.placeholder),
            key=lambda m: (m.added, m.id),
        )

    def eldest_first(self, ids: list[str]) -> list[str]:
        """Children in birth order, the way the app orders them."""
        siblings = [
            Sibling(
                id=i,
                gender=self.members[i].person.gender,
                birth_date=self.members[i].person.birth_date,
                birth_order=self.members[i].person.birth_order,
                tiebreak=self.members[i].added,
            )
            for i in ids
        ]
        ordered, _ = order_siblings(siblings)
        return [sibling.id for sibling in ordered]

    def is_blood(self, kind: str) -> bool:
        definition = self.kinds.get(kind)
        return definition.blood if definition else kind == BIOLOGICAL


def place_text(place: Place | None) -> str | None:
    """ "Kota Bharu, Kelantan, Malaysia"; None when nothing was entered."""
    if place is None or place.is_empty:
        return None
    return ", ".join(part for part in (place.town, place.state, place.country) if part)


def family_from_graph(graph: Mapping[str, Any], stories: Mapping[str, str]) -> FamilyData:
    """The export's view of `export_graph`'s rows; `stories` are biography.md texts by id."""
    members = {}
    for props in graph["people"]:
        story, sources = split_sources(stories.get(props["id"], ""))
        members[props["id"]] = Member(
            person=person_from_props(props),
            added=str(props.get("created_at") or ""),
            story=story,
            sources=tuple(sources),
        )
    parents: list[ParentRow] = []
    spouses: list[SpouseRow] = []
    for link in graph["links"]:
        props = link["properties"]
        if link["type"] == "PARENT_OF":
            parents.append(ParentRow(link["source"], link["target"], props.get("kind", BIOLOGICAL)))
        else:
            spouses.append(
                SpouseRow(
                    link["source"],
                    link["target"],
                    SpouseStatus(props.get("status") or SpouseStatus.MARRIED),
                    props.get("order"),
                )
            )
    kinds = {k["key"]: kind_from_props(k) for k in graph["relationship_kinds"]}
    return FamilyData(members, parents, spouses, kinds)


def _read_stories(data_dir: Path, ids: list[str]) -> dict[str, str]:
    stories = {}
    for person_id in ids:
        text = read_story(data_dir, person_id)
        if text:
            stories[person_id] = text
    return stories


async def load_family(ctx: Context) -> FamilyData:
    graph = await export_graph(ctx.driver, ctx.database)
    ids = [props["id"] for props in graph["people"]]
    stories = await asyncio.to_thread(_read_stories, ctx.data_dir, ids)
    return family_from_graph(graph, stories)
