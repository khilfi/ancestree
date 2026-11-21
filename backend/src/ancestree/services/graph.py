"""The tree canvas's view: everyone, every link, and each person's seat on the rings."""

from collections.abc import Collection, Mapping, Sequence, Set
from typing import Any
from uuid import UUID

from neo4j import AsyncDriver, RoutingControl

from ancestree.domain.graph import (
    BirthParents,
    Graph,
    GraphLayout,
    GraphLink,
    GraphPerson,
    LayoutUnit,
    ParentLoop,
    Seat,
)
from ancestree.domain.links import three_birth_parents
from ancestree.domain.person import Gender, PartialDate
from ancestree.domain.relationship import BIOLOGICAL
from ancestree.lineage import seating
from ancestree.repo.graph import PERSON_FIELDS, read_family
from ancestree.repo.mapping import date_from_row
from ancestree.services.detail import living_from

LAYOUT_SEATS = 60_000  # the most seats a view-only copy carries for other centres
# A person's values in a backup's graph.json, under the names the database query gives them.
_ARCHIVE_NAMES = {"x": "layout_x", "y": "layout_y"}


async def load_graph(driver: AsyncDriver, database: str, centre: UUID | None) -> Graph:
    people, links, in_layout = await read_family(driver, database)
    kinds, _, _ = await driver.execute_query(
        "MATCH (k:RelationshipKind) WHERE k.blood RETURN collect(k.key) AS keys",
        database_=database,
        routing_=RoutingControl.READ,
    )
    return build_graph(people, links, in_layout, centre, blood=set(kinds[0]["keys"]))


def graph_from_archive(archive: Mapping[str, Any]) -> Graph:
    """The graph of a family in a backup archive's graph.json (`restore.read_graph`), as
    `load_graph` makes it from the database, around its oldest ancestor: to look at a family
    without restoring it."""
    people = []
    for person in archive["people"]:
        row = {name: person.get(_ARCHIVE_NAMES.get(name, name)) for name in PERSON_FIELDS}
        row["gender"] = row["gender"] or Gender.UNKNOWN.value
        row["placeholder"] = bool(row["placeholder"])
        row["photo_version"] = person.get("photo_version") if person.get("has_photo") else None
        people.append(row)
    # In the database's order: by year of birth, the unknown last, then by name.
    people.sort(
        key=lambda row: (row["birth_year"] is None, row["birth_year"] or 0, row["full_name"])
    )
    links = sorted(
        (
            {
                "id": link["properties"]["id"],
                "type": "parent" if link["type"] == "PARENT_OF" else "spouse",
                "source": link["source"],
                "target": link["target"],
            }
            | {key: link["properties"].get(key) for key in ("kind", "status", "order")}
            for link in archive["links"]
        ),
        key=lambda link: (link["type"], link["id"]),
    )
    in_layout = {
        kind["key"]: bool(kind.get("in_layout", True)) for kind in archive["relationship_kinds"]
    }
    blood = {kind["key"] for kind in archive["relationship_kinds"] if kind.get("blood")}
    return build_graph(people, links, in_layout, None, blood=blood or {BIOLOGICAL})


def centre_layouts(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    in_layout: Mapping[str, bool],
    made: Graph,
    made_centre: UUID | None,
    budget: int = LAYOUT_SEATS,
) -> dict[str, GraphLayout]:
    """The seats around each other centre a view-only copy offers, by the
    centre's id. A copy can't seat anyone itself, so it carries these:

    - "" for the oldest ancestor, when the copy was made with another centre;
    - every family's centre, and in turn the centres of the families that hang off theirs,
      the biggest first;
    - each branch of the family at the centre, in the order of their colours.

    They stop before `budget` seats in all, so a very big family keeps a small copy."""
    layouts: dict[str, GraphLayout] = {}
    made_key = str(made_centre) if made_centre else ""
    spent = 0
    # Whoever is at the centre, everyone linked has one seat: so a layout's size is known before
    # it's worked out, and one that won't fit the budget is never worked out at all.
    each = len(made.layout.seats)

    def carry(key: str) -> GraphLayout | None:
        nonlocal spent
        if key == made_key or key in layouts or spent + each > budget:
            return None
        layout = build_graph(people, links, in_layout, UUID(key) if key else None).layout
        spent += len(layout.seats)
        layouts[key] = layout
        return layout

    if made_centre:
        carry("")
    waiting = [made.layout]
    while waiting:
        layout = waiting.pop(0)
        for unit in sorted(layout.units, key=lambda unit: -unit.size):
            found = carry(str(unit.centre[0])) if unit.centre else None
            if found:
                waiting.append(found)
    first = made.layout.units[0].id if made.layout.units else None
    starts = sorted(
        (seat.order, str(person))
        for person, seat in made.layout.seats.items()
        if seat.branch == person and seat.unit == first
    )
    for _, person in starts:
        carry(person)
    return layouts


def seated_under(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    in_layout: Mapping[str, bool],
) -> dict[str, str]:
    """The parent each person sits under on the tree laid out from the oldest ancestor,
    whatever centre is chosen now, by their ids: where someone with no place of their
    own is shown when their parents live apart. Those at a family's top sit under no one."""
    seats = _seating(people, links, in_layout, None).seats
    return {person: seat.parent for person, seat in seats.items() if seat.parent}


def _seating(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    in_layout: Mapping[str, bool],
    centre: str | None,
) -> seating.Seating:
    members = [
        seating.Member(
            id=str(row["id"]),
            name=row["full_name"],
            gender=Gender(row.get("gender") or Gender.UNKNOWN),
            birth=birth_from_row(row),
            birth_order=row.get("birth_order"),
            placeholder=bool(row.get("placeholder")),
        )
        for row in people
    ]
    parent_edges = [
        seating.ParentEdge(
            str(link["source"]),
            str(link["target"]),
            in_layout.get(link.get("kind") or BIOLOGICAL, True),
            str(link["id"]),
        )
        for link in links
        if link["type"] == "parent"
    ]
    spouse_edges = [
        seating.SpouseEdge(str(link["source"]), str(link["target"]), link.get("order"))
        for link in links
        if link["type"] == "spouse"
    ]
    return seating.seat_family(members, parent_edges, spouse_edges, centre=centre)


def build_graph(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    in_layout: Mapping[str, bool],
    centre: UUID | None,
    *,
    this_year: int | None = None,
    blood: Set[str] = frozenset({BIOLOGICAL}),
) -> Graph:
    """Rows as the database returns them (or a generated family) -> the canvas's graph.
    `this_year` decides who is taken to be alive: this year, unless a test fixes it. `blood`:
    the kinds of parent link by birth, to find a child with three birth parents."""
    wanted = str(centre) if centre else None
    result = _seating(people, links, in_layout, wanted)
    return Graph(
        people=[_person(row, this_year) for row in people],
        links=[
            GraphLink.model_validate(
                dict(link) | {"in_layout": in_layout.get(link.get("kind") or BIOLOGICAL, True)}
            )
            for link in links
        ],
        layout=GraphLayout(
            units=[
                LayoutUnit(
                    id=unit.id,
                    centre=[UUID(p) for p in unit.centre],
                    anchor=_uuid(unit.anchor),
                    anchor_seat=_seat(unit.anchor_seat) if unit.anchor_seat else None,
                    size=unit.size,
                )
                for unit in result.units
            ],
            seats={UUID(person): _seat(seat) for person, seat in result.seats.items()},
            unlinked=[UUID(person) for person in result.unlinked],
            centre_chosen=any(
                unit.centre[0] == wanted for unit in result.units if unit.anchor is None
            ),
            loops=[
                ParentLoop(link=UUID(loop.link), people=[UUID(p) for p in loop.people])
                for loop in result.loops
            ],
            three_birth_parents=[
                BirthParents(
                    child=UUID(found.child),
                    parents=[UUID(p) for p in found.parents],
                    link=UUID(found.link),
                )
                for found in three_birth_parents(
                    (str(link["id"]), str(link["source"]), str(link["target"]))
                    for link in links
                    if link["type"] == "parent" and (link.get("kind") or BIOLOGICAL) in blood
                )
            ],
        ),
    )


def birth_from_row(row: Mapping[str, Any]) -> PartialDate | None:
    return date_from_row(row, "birth")


def birth_region(row: Mapping[str, Any]) -> str | None:
    """Where someone was born, as the filters and Family facts group it: the state; the
    country, if abroad; else the town."""
    country = row.get("birth_country")
    abroad = country if country and country != "Malaysia" else None
    region = row.get("birth_state") or abroad or row.get("birth_town")
    return str(region) if region else None


def _person(row: Mapping[str, Any], this_year: int | None = None) -> GraphPerson:
    country = row.get("birth_country")
    parts = [row.get("birth_town"), row.get("birth_state")]
    if country and country != "Malaysia":
        parts.append(country)
    born, died = date_from_row(row, "birth"), date_from_row(row, "death")
    return GraphPerson.model_validate(
        dict(row)
        | {
            "birthplace": ", ".join(p for p in parts if p) or None,
            "born_in": birth_region(row),
            "born": born,
            "died": died,
            "is_living": living_from(row.get("living"), born, died, this_year=this_year),
            "birth_text": row.get("birth_original_text") if born is None else None,
        }
    )


def with_story_marks(graph: Graph, told: Collection[str]) -> Graph:
    """The graph with `has_story` for those of `told`, who have a life story."""
    if not told:
        return graph
    people = [
        person.model_copy(update={"has_story": True}) if str(person.id) in told else person
        for person in graph.people
    ]
    return graph.model_copy(update={"people": people})


def _uuid(value: str | None) -> UUID | None:
    return UUID(value) if value else None


def _seat(seat: seating.Seat) -> Seat:
    return Seat(
        unit=seat.unit,
        generation=seat.generation,
        parent=_uuid(seat.parent),
        order=seat.order,
        partner_of=_uuid(seat.partner_of),
        branch=_uuid(seat.branch),
    )
