"""Importing a spreadsheet in the app, and reviewing what it
would change before anything does. The changes a copy to edit brings back are reviewed
the same way."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ImportOption(BaseModel):
    """One answer to a question: "person:<id>" (someone in the tree), "row:<n>" (a row of the
    file), "new" (someone new) or "out" (leave the link out)."""

    id: str
    label: str
    detail: str | None = None  # who they are, so namesakes can be told apart


class ImportQuestion(BaseModel):
    id: str  # stable for the same file: "same:3", "who:9:Parents:0", "same:<id>" for a copy
    row: int | None  # None: a copy's, which has no rows
    column: str
    written: str  # what the cell said
    kind: Literal["same_person", "which_person"]
    text: str
    options: list[ImportOption]
    answer: str  # the option in force: yours, or the default


class ImportLeftOut(BaseModel):
    """A value or a link that didn't come in, and why; the rest of the row still did. For a
    copy: whose it was, in `column`, with no row."""

    row: int | None
    column: str
    written: str
    why: str


class ImportSecondLook(BaseModel):
    """Something that came in but is worth a look, e.g. an unlikely age gap."""

    row: int | None
    message: str


class ImportDifference(BaseModel):
    """A row that is someone already in the tree says something the tree doesn't, and it
    isn't offered as a change: the tree has been changed since the file was exported, so the
    tree's is the newer. For you to look at."""

    row: int
    person: UUID
    name: str
    column: str
    written: str
    in_tree: str  # "" when the tree has nothing there


type ChangeKind = Literal[
    "add_person",
    "set",
    "add_link",
    "remove_person",
    # From a copy to edit:
    "remove_link",
    "change_link",  # its kind, a marriage's status, or which way round a parent link goes
    "fill_in",  # an unknown parent filled in
    "order",  # the birth order of brothers and sisters
    "story",
    "photo",
]


class ImportChange(BaseModel):
    """One thing the import would do, which you can leave out. New people, new links
    and details changed only in the file start ticked; a removal, a clash, a detail whose
    file doesn't say what it started from, or a date that can't be read waits for your tick."""

    id: str  # stable for the same file and answers: "add:row:3", "set:<id>:birth_date", …
    kind: ChangeKind
    row: int | None  # None: someone only named in other rows
    person: UUID | None = None  # who it changes or removes, when they're in the tree
    name: str  # who it's about
    column: str | None = None  # "set": the detail; "add_link": Parents, Spouses or Children
    before: str | None = None  # "set": what the tree has now; "" when nothing
    after: str | None = None  # "set": what the file says; "" when it clears the detail
    detail: str | None = None  # "add_person": b. 1938 · Kota Bharu; "add_link": who, and how
    clash: bool = False  # changed in the tree too since the file was exported, or the copy made
    unsure: bool = False  # the file doesn't say what it started from (no Version)
    removes: bool = False  # takes something out: only ever by its own tick, never Tick all
    picture: str | None = None  # "photo": the new photo, small, as a data: address
    needs: list[str] = Field(default_factory=list)  # changes it can't happen without
    blocked_by: list[str] = Field(default_factory=list)  # changes that rule it out
    ticked: bool


class ImportPerson(BaseModel):
    """Someone the import adds."""

    row: int | None  # None: named only in someone's Parents, Spouses or Children
    name: str
    born: str | None
    birthplace: str | None
    named_in: list[int]  # the rows that name them, when they have no row of their own


class ImportPreview(BaseModel):
    file_name: str
    rows: int
    people: list[ImportPerson]
    matched: int  # rows that are someone already in the tree
    links: int
    links_to_tree: int  # of the links, those to someone already in the tree
    questions: list[ImportQuestion]
    left_out: list[ImportLeftOut]
    second_look: list[ImportSecondLook]
    differences: list[ImportDifference]
    columns_not_read: list[str]
    changes: list[ImportChange] = Field(default_factory=list)  # to review and tick


class CopyReturned(BaseModel):
    """Which copy to edit came back, as the app recorded it when it made it."""

    copy_id: str
    for_name: str  # whom it was made for
    title: str
    made_at: datetime
    saved_at: datetime | None  # when the file was saved from the copy; None: as the app made it
    brought_at: datetime | None  # when a file of this copy was last brought in; None: never
    locked: bool


class CopyPreview(BaseModel):
    """What a copy to edit brings back, for you to tick. Nothing is written."""

    file_name: str
    about: CopyReturned  # which copy, and whose
    questions: list[ImportQuestion]  # look-alikes: is someone new already in the tree?
    changes: list[ImportChange]
    left_out: list[ImportLeftOut]  # what the copy changed that can't come in, and why
    second_look: list[ImportSecondLook]


class ImportDone(BaseModel):
    id: str
    label: str  # the Undo step: "Import 42 people from cousins.csv"
    people: int
    links: int
    changed: int = 0  # details changed in people already in the tree
    removed: int = 0  # people moved to the Trash
    stories: int = 0  # life stories written or changed
    photos: int = 0  # photos added, replaced or removed
    left_out: int
    backup: str  # the backup made first


class ImportSummary(BaseModel):
    """An earlier import, for Settings → Import and What's missing."""

    id: str
    kind: Literal["spreadsheet", "copy"] = "spreadsheet"
    file_name: str
    for_name: str | None = None  # a copy's: whom it was made for (M21)
    imported_at: datetime
    people: int
    people_present: int  # still in the tree: not undone, taken back or deleted since
    links: int
    changed: int = 0  # details changed in people already in the tree
    removed: int = 0  # people it moved to the Trash
    stories: int = 0  # life stories it wrote or changed
    photos: int = 0  # photos it added, replaced or removed
    left_out: list[ImportLeftOut]
    differences: int
    second_look: int
    taken_back_at: datetime | None


class ImportTakenBack(BaseModel):
    moved: int  # people it added, moved to the Trash
    gone: int  # people it added, already out of the tree
    restored: int = 0  # people it removed, brought back from the Trash
    reverted: int = 0  # details it changed, put back as they were
    kept: int = 0  # what it changed that has been changed again since: left as it is
    links: int = 0  # links it took out or changed, put back
    stories: int = 0  # life stories put back
    photos: int = 0  # photos put back
