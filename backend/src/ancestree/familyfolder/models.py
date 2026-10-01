"""What the family folder's files hold, once opened.

Keys and fingerprints travel as hex. Every model refuses fields it doesn't know, so a file
out of shape is refused whole.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["keeper", "trusted", "contributor", "viewer", "removed"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FamilyFile(_Model):
    """family.json, the only file in the clear: which family, and the keeper's public keys."""

    format: Literal[1] = 1
    family: str
    keeper_sign: str
    keeper_dh: str


class Put(_Model):
    """Someone's details, as they now are (the spike's stand-in for the app's changes)."""

    op: Literal["put"] = "put"
    id: str
    data: dict[str, Any]


class Delete(_Model):
    op: Literal["delete"] = "delete"
    id: str


class Joined(_Model):
    """A computer's name and role, for everyone in the family to see."""

    op: Literal["joined"] = "joined"
    device: str
    name: str
    role: Role


class Removed(_Model):
    op: Literal["removed"] = "removed"
    device: str


Change = Annotated[Put | Delete, Field(discriminator="op")]
RecordOp = Annotated[Put | Delete | Joined | Removed, Field(discriminator="op")]


class Source(_Model):
    """The proposal a change set came from, and whether a note about the rest follows."""

    device: str
    proposal: int
    note: bool = False


class RecordChange(_Model):
    seq: int
    prev: str | None  # the fingerprint of the change set before it
    made: str
    source: Source | None = None
    changes: list[RecordOp]


class Proposal(_Model):
    seq: int
    base: int  # the record's last change set when it was made
    made: str
    changes: list[Change] = Field(default_factory=list)  # the spike's: entries put or deleted
    # The computer's family as it is, for the keeper's review: a copy to edit's family
    # as exchange/returned.py reads it, as JSON, gzipped, in base64.
    family: str = ""
    answered: int = 0  # the newest of this computer's proposals it had heard back on
    changed: int = 0  # the people and links it changed, as it counts them: none, withdrawn


class JoinRequest(_Model):
    device: str
    sign: str
    dh: str
    name: str  # the computer's name, locked for the keeper


class MemberFile(_Model):
    device: str
    version: int
    role: Role
    sign: str
    dh: str
    keys: str | None  # the family's keys, locked for this computer; none once it's removed


class KeyRing(_Model):
    keys: dict[int, str]  # every family key so far, by epoch
    naming: str


class Note(_Model):
    """The keeper's answer to a proposal: which changes were taken, which weren't, and why."""

    proposal: int
    taken: list[int]
    left: list[int]
    note: str
    left_out: list[str] = Field(default_factory=list)  # what wasn't taken, in words


class Snapshot(_Model):
    seq: int
    hash: str
    state: dict[str, Any]
    changed: dict[str, int]


class Recovery(_Model):
    """The keeper's keys, for a new computer that has the recovery code."""

    device: str
    sign: str
    dh: str
    keys: dict[int, str]
    naming: str
