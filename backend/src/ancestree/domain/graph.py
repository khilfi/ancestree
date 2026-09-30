"""The lightweight view of the whole family that the tree canvas draws."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from ancestree.domain.person import Gender, PartialDate
from ancestree.domain.relationship import SpouseStatus


class GraphPerson(BaseModel):
    id: UUID
    full_name: str
    nickname: str | None
    gender: Gender
    birth_year: int | None
    death_year: int | None
    birth_order: int | None
    placeholder: bool
    photo_version: int | None  # None: no photo
    birthplace: str | None = None  # "Kota Bharu, Kelantan", for the hover tooltip
    born_in: str | None = None  # the state, or the country abroad, or the town: for filters
    x: float | None = None  # where it was dragged to; None: its place on the rings
    y: float | None = None
    # For the timeline: the whole dates, approximate or not, and whether they're alive
    # (as set by hand, else inferred: no death recorded and born within 110 years).
    born: PartialDate | None = None
    died: PartialDate | None = None
    is_living: bool | None = None
    # A date of birth written but not readable, e.g. "31/2/1950" from a spreadsheet:
    # What's missing shows it beside the date picker.
    birth_text: str | None = None


class GraphLink(BaseModel):
    """For "parent" links, `source` is the parent and `target` the child."""

    id: UUID
    type: Literal["parent", "spouse"]
    source: UUID
    target: UUID
    kind: str | None
    status: SpouseStatus | None
    in_layout: bool = True  # parent links: whether the kind places the child on the rings


class Seat(BaseModel):
    """Where someone sits on the rings; the browser draws it."""

    unit: str
    generation: int  # 1 = the centre
    parent: UUID | None  # hangs from this parent, one ring in
    order: int  # clockwise among that parent's children (eldest first), or among partners
    partner_of: UUID | None  # sits beside this person: married in, or an unknown parent
    branch: UUID | None  # where this line's colour starts: a child of the first split


class LayoutUnit(BaseModel):
    """One set of rings: a family's own, or a cluster hanging off one person."""

    id: str
    centre: list[UUID]
    anchor: UUID | None  # a cluster hangs off this person on the rings
    anchor_seat: Seat | None  # where that person would sit among the cluster's own
    size: int


class GraphLayout(BaseModel):
    units: list[LayoutUnit]
    seats: dict[UUID, Seat]
    unlinked: list[UUID]  # the "Not linked yet" tray
    centre_chosen: bool  # the centre was set by hand rather than found


class Graph(BaseModel):
    people: list[GraphPerson]
    links: list[GraphLink]
    layout: GraphLayout


class Position(BaseModel):
    id: UUID
    x: float | None  # None puts them back on their place on the rings
    y: float | None


class Positions(BaseModel):
    positions: list[Position] = Field(max_length=20_000)


class TreeSettings(BaseModel):
    """Stored in DATA_DIR/settings/app.json."""

    centre: UUID | None = None  # None: the oldest ancestor
    # "closeness": how close each person is to you, once you've chosen who you are
    colours: Literal["branch", "generation", "closeness", "off"] = "branch"


class MeSettings(BaseModel):
    """Which person you are, for "Me". None until you choose. Stored in
    DATA_DIR/settings/app.json under "me"; not an Undo step."""

    person: UUID | None = None
