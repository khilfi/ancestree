"""Merging two people: one entered twice becomes one."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class MergeDetail(BaseModel):
    """A detail of the two, as the merge treats it."""

    label: str  # "Born"
    keep: str  # as the one kept has it; empty if they've none
    other: str  # as the one merged in has it
    taken: bool  # the one kept had none, so it takes the other's


class MergeLink(BaseModel):
    """A link of the one merged in, and what becomes of it."""

    description: str  # "Parent: Ismail bin Ahmad"
    outcome: Literal["moved", "already", "between", "left_out"]
    why: str = ""  # for one left out: the rule it would break


class MergePreview(BaseModel):
    """What merging `other` into `keep` would do. Nothing is written."""

    keep: UUID
    keep_name: str
    other: UUID
    other_name: str
    details: list[MergeDetail]
    links: list[MergeLink]
    photo: Literal["none", "kept", "taken"]  # the one kept's photo stays; or the other's comes
    story: Literal["none", "kept", "taken", "both"]  # both: the other's stays with them


class MergeRequest(BaseModel):
    other: UUID  # the one merged in, who goes to the Trash
