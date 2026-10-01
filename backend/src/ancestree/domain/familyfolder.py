"""The family folder, as the app shows it."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]
Role = Literal["keeper", "trusted", "contributor", "viewer", "removed"]
Choosable = Literal["trusted", "contributor", "viewer"]


class FolderMember(BaseModel):
    """A computer in the family."""

    device: str
    name: str  # as its owner named it, such as "Salmah's laptop"
    role: Role
    email: str  # the Google account it signed in with; empty if not known yet
    you: bool  # this computer


class FolderAsking(BaseModel):
    """A computer asking to join: its code should match the one its owner reads out."""

    device: str
    name: str
    email: str
    code: str


class FolderAnswer(BaseModel):
    """The keeper's answer to the changes this computer sent."""

    proposal: int
    left_out: list[str]  # what wasn't taken, as the keeper's review named it
    note: str  # the keeper's own words, if any


class FolderChanges(BaseModel):
    """A relative's computer with changes waiting for the keeper's review."""

    device: str
    name: str
    email: str
    role: Role
    proposal: int  # which of its proposals: the newest, standing for those before it
    sent_at: datetime


class FamilyFolderStatus(BaseModel):
    available: bool  # AncesTree has a Google client to sign in with
    email: str | None  # the Google account signed in, if one is
    signing_in: bool  # a sign-in is waiting for Google's answer
    setup: Literal["keeper", "member"] | None
    family: str  # the family's name; empty until known
    role: Role | Literal["waiting"] | None  # this computer's, once it has asked or started
    code: str | None  # while waiting to be let in: the code to read to the keeper
    members: list[FolderMember] = Field(default_factory=list)
    asking: list[FolderAsking] = Field(default_factory=list)  # the keeper's to answer
    last_sync: datetime | None
    received: datetime | None  # when the family last arrived here, on a relative's
    problem: str  # what's in the way, in plain words; empty if nothing
    recovery_code: str | None  # the keeper's, once, just after the family is started
    # A relative's: the people and links it changed that wait for the keeper, when it
    # last sent them, and the keeper's answers not yet seen here.
    pending: int = 0
    sent_at: datetime | None = None
    answers: list[FolderAnswer] = Field(default_factory=list)
    changes: list[FolderChanges] = Field(default_factory=list)  # the keeper's to review


class SignInStarted(BaseModel):
    url: str  # Google's page, to open in the browser


class SharedFolder(BaseModel):
    """A family folder someone has shared with this Google account."""

    id: str
    owner: str  # the keeper's Google account


class StartFamily(BaseModel):
    family: Name  # "Keluarga Contoh": never written in the clear
    computer: Name  # this computer, as the family will see it


class JoinFamily(BaseModel):
    folder: str
    computer: Name


class Admit(BaseModel):
    device: str
    role: Choosable


class OneComputer(BaseModel):
    device: str


class Invite(BaseModel):
    email: Email


class Recover(BaseModel):
    folder: str | None = None  # none: the one family folder in this account's Drive
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=60)]


Answers = dict[Annotated[str, StringConstraints(max_length=100)], str]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class ReviewChanges(BaseModel):
    """The keeper's answers to the look-alike questions, so far."""

    answers: Answers = Field(default_factory=dict, max_length=10_000)


class BringIn(BaseModel):
    """Bring in what's ticked of a computer's changes, with a note for what isn't."""

    proposal: int
    answers: Answers = Field(default_factory=dict, max_length=10_000)
    chosen: list[Annotated[str, StringConstraints(max_length=100)]] | None = Field(
        default=None, max_length=100_000
    )
    note: Note = ""


class TurnDown(BaseModel):
    """Take none of a computer's changes, with a note to say why."""

    proposal: int
    note: Note = ""
