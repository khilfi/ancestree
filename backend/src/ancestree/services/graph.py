"""The tree canvas's view: everyone, every link, and each person's seat on the rings."""

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from neo4j import AsyncDriver
from pydantic import ValidationError

from ancestree.domain.graph import Graph, GraphLayout, GraphLink, GraphPerson, LayoutUnit, Seat
from ancestree.domain.person import Gender, PartialDate
from ancestree.domain.relationship import BIOLOGICAL
from ancestree.lineage import seating
from ancestree.repo.graph import read_family
from ancestree.services.detail import living_from

LAYOUT_SEATS = 60_000  # the most seats a view-only copy carries for other centres


async def load_graph(driver: AsyncDriver, database: str, centre: UUID | None) -> Graph:
    people, links, in_layout = await read_family(driver, database)
    return build_graph(people, links, in_layout, centre)


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


def build_graph(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    in_layout: Mapping[str, bool],
    centre: UUID | None,
    *,
    this_year: int | None = None,
) -> Graph:
    """Rows as the database returns them (or a generated family) -> the canvas's graph.
    `this_year` decides who is taken to be alive: this year, unless a test fixes it."""
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
        )
        for link in links
        if link["type"] == "parent"
    ]
    spouse_edges = [
        seating.SpouseEdge(str(link["source"]), str(link["target"]), link.get("order"))
        for link in links
        if link["type"] == "spouse"
    ]
    wanted = str(centre) if centre else None
    result = seating.seat_family(members, parent_edges, spouse_edges, centre=wanted)
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
        ),
    )


def date_from_row(row: Mapping[str, Any], prefix: str) -> PartialDate | None:
    """A date from flattened properties ("birth_year", "birth_month"...), qualifier and all.
    Whatever doesn't fit is dropped rather than failing: a day, then the month, then the
    qualifier. No year, no date."""
    year = row.get(f"{prefix}_year")
    if year is None:
        return None
    full = {
        "year": year,
        "month": row.get(f"{prefix}_month"),
        "day": row.get(f"{prefix}_day"),
        "qualifier": row.get(f"{prefix}_qualifier") or "exact",
        "year_to": row.get(f"{prefix}_year_to"),
    }
    for attempt in (
        full,
        full | {"day": None},
        full | {"day": None, "month": None},
        {"year": year},
    ):
        try:
            return PartialDate.model_validate(attempt)
        except ValidationError:
            continue
    return None


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
