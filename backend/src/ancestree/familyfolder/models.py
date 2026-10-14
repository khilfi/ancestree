"""What the family folder's files hold, once opened.

Keys and fingerprints travel as hex. Every model refuses fields it doesn't know, so a file
out of shape is refused whole.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["keeper", "trusted", "contributor", "viewer", "removed"]
# A computer's id, and a public key, as a file another computer wrote carries them (0.8.0):
# exactly so, or the file is refused whole.
Device = Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]
PublicKey = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


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
    # The computer's family as it is, for the keeper's review, as exchange/returned.py
    # reads it: JSON, gzipped, in base64.
    family: str = ""
    answered: int = 0  # the newest of this computer's proposals it had heard back on
    changed: int = 0  # the people and links it changed, as it counts them: none, withdrawn


class JoinRequest(_Model):
    device: Device
    sign: PublicKey
    dh: PublicKey
    name: Annotated[str, Field(pattern=r"^[0-9a-f]*$", max_length=1024)]  # locked for the keeper


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


# Handing over the keeper

Afterwards = Literal["trusted", "contributor", "viewer"]


class Newcomer(_Model):
    """The offering computer's place in the family after a handover: let in by the new keeper
    under a new identity, without a code, as the offer vouches for it."""

    device: str
    name: str
    role: Afterwards
    sign: str
    dh: str


class KnownComputer(_Model):
    """A computer of the family, as the keeper knows it."""

    name: str
    role: Role
    sign: str
    dh: str
    version: int = 0


class Offer(_Model):
    """The family offered to one of its computers, locked for it alone and signed with the
    keeper's key: the keeper's keys, its list of the family's computers and their Google
    accounts, what it has answered, and what the offering computer becomes afterwards."""

    id: str
    to: str
    made: str
    keys: Recovery
    # The key the recovery code stands for: kept by a computer of the keeper's own, whose
    # owner's code stays; another person's makes a new code.
    recovery: str
    known: dict[str, KnownComputer]
    accounts: dict[str, str]  # each relative's computer's Google account
    invited: list[str]  # accounts the family folder is shared with, joined or not
    decided: list[str]  # "computer/proposal", answered
    newcomer: Newcomer | None  # None: the offering computer leaves the family


class About(_Model):
    """What a relative's computer says of itself, in its own folder: its version, so the keeper
    knows it can take over, and an offer it turned down."""

    device: str
    version: str  # the app's, as people read it
    handover: int = 0  # the way of handing over the keeper it takes part in: 1 since 0.5.0
    declined: str = ""  # the offer it turned down, if any


class Waiting(_Model):
    """A computer asking to join, as the keeper's computer read its request."""

    device: str
    name: str  # as it named itself, which only the keeper's computer can read
    email: str  # the Google account whose folder it asked from


class Outcome(_Model):
    """What the keeper's computer did with one of a helping computer's instructions."""

    number: int
    action: str = ""  # "let_in" or "invited"; empty for one that couldn't be read
    name: str  # the computer it was about, or the account invited
    done: bool
    why: str = ""  # why not, in plain words


class Helping(_Model):
    """What the keeper's computer leaves another of the keeper's own, allowed to invite and let
    in for it, locked for that computer alone: whether it still may; the invitation, which
    only the keeper's key can sign; the names of the computers asking to join; what became of
    that computer's instructions; and when the keeper's computer last looked, so it's known
    whether it runs."""

    device: str
    allowed: bool
    keeper: str  # the keeper's computer's name
    looked: str  # ISO 8601
    invitation: str = ""
    asking: list[Waiting] = Field(default_factory=list)
    refused: list[str] = Field(default_factory=list)  # computers turned away, not to show
    done: list[Outcome] = Field(default_factory=list)


class Instruction(_Model):
    """A helping computer's word to the keeper's, in its own folder: let this computer in,
    whose code its owner compared, with this role; or, it invited this Google account. Numbered,
    so none is carried out twice."""

    device: Device  # the helping computer
    number: Annotated[int, Field(ge=1)]
    made: Annotated[str, Field(max_length=40)]
    action: Literal["let_in", "invited"]
    joining: Annotated[str, Field(pattern=r"^([0-9a-f]{16})?$")] = ""  # the computer to let in
    # Its code, as this computer worked it out and its owner compared.
    code: Annotated[str, Field(pattern=r"^([A-Z2-7]{4}-[A-Z2-7]{4})?$")] = ""
    role: Literal["trusted", "contributor", "viewer"] = "contributor"
    # The account invited, as the invitation's form takes it (0.8.0: never any text at all).
    email: Annotated[str, Field(max_length=254, pattern=r"^([^@\s]+@[^@\s]+\.[^@\s]+)?$")] = ""


class TookOver(_Model):
    """The new keeper's word, in its own folder, signed with the keeper's key: it took the
    family on the offer, and where the family folder is now ("" for where it was)."""

    offer: str
    folder: str
    made: str
