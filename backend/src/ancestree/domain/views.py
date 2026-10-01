"""What the API returns."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from ancestree.domain.person import Gender, PartialDate, Place
from ancestree.domain.relationship import RelationshipKind, SpouseStatus


class Notice(BaseModel):
    """Something worth a second look that was still saved, e.g. an unlikely age gap."""

    code: str
    message: str


class DateView(BaseModel):
    value: PartialDate
    text: str  # editable: "12/3/1950", "c. 1950"
    description: str  # readable: "12 March 1950", "about 1950"


class PersonSummary(BaseModel):
    id: UUID
    full_name: str
    nickname: str | None
    gender: Gender
    birth_year: int | None
    death_year: int | None
    photo_version: int | None  # None: no photo
    placeholder: bool


class Relative(PersonSummary):
    label: str  # "Father", "Adoptive mother", "Former wife", "Elder half-sister"
    link_id: UUID | None  # the stored link; None for siblings, who are derived
    kind: str | None = None
    status: SpouseStatus | None = None


class ChildGroup(BaseModel):
    """Children of the same parents, eldest first when that is known.

    `kind` is None for children by birth; otherwise the kind of link (e.g. adoptive) that
    this group of children shares with this person.
    """

    kind: str | None = None
    other_parents: list[PersonSummary]
    order_decided: bool
    children: list[Relative]


class PersonDetail(BaseModel):
    id: UUID
    full_name: str
    nickname: str | None
    title: str | None
    name_jawi: str | None
    gender: Gender
    birth_date: DateView | None
    birth_place: Place | None
    death_date: DateView | None
    death_place: Place | None
    burial_place: str | None
    residence: Place | None
    living: bool | None  # as set; None means "work it out"
    is_living: bool | None  # as worked out; None means unknown
    occupation: str | None
    notes: str | None
    placeholder: bool
    photo_version: int | None
    sibling_position: str | None  # "Eldest son of Tok Ismail & Nenek Fatimah"
    parents: list[Relative]
    spouses: list[Relative]
    siblings: list[Relative]
    child_groups: list[ChildGroup]
    link_count: int
    created_at: datetime | None
    updated_at: datetime | None


class PersonSaved(BaseModel):
    person: PersonDetail
    notices: list[Notice]


class LinkView(BaseModel):
    id: UUID
    type: Literal["parent", "spouse"]
    source: UUID  # the parent, for parent links
    target: UUID
    kind: str | None
    status: SpouseStatus | None


class Suggestion(BaseModel):
    type: Literal["marry"]
    person_a: UUID
    person_b: UUID
    message: str


class RelationshipResult(BaseModel):
    links: list[LinkView]
    notices: list[Notice]
    suggestions: list[Suggestion]


class RelativeAdded(BaseModel):
    person: PersonDetail  # the new relative
    notices: list[Notice]
    suggestions: list[Suggestion]


class KindView(RelationshipKind):
    usage: int  # how many links use this kind


class TrashEntry(BaseModel):
    entry: str
    person_id: UUID
    full_name: str
    deleted_at: datetime
    restore_until: datetime
    link_count: int


class RestoreResult(BaseModel):
    person: PersonDetail
    restored_links: int
    skipped_links: int  # links to people who are no longer there


class DateReading(BaseModel):
    text: str
    date: PartialDate | None
    description: str | None
    error: str | None


class HistoryStep(BaseModel):
    """One change that can be undone or redone, e.g. "Link Siti and Ali"."""

    id: str
    label: str
    at: datetime


class JournalEntry(BaseModel):
    """One change to someone, as their journal keeps it: who changed this, and when."""

    at: datetime
    what: str  # the change, as Undo names it: "Edit Hassan bin Ismail"
    by: str  # the computer it was made or brought in on, by its name in the family
    from_computer: str | None = None  # a relative's computer it came from, through the folder
    from_email: str | None = None  # that computer's owner's Google account
    sent_at: datetime | None = None  # when that computer sent it


class HistoryView(BaseModel):
    """What Undo and Redo would do next."""

    undo: HistoryStep | None
    redo: HistoryStep | None


class HistoryMove(BaseModel):
    done: HistoryStep  # the step just undone or redone
    history: HistoryView
