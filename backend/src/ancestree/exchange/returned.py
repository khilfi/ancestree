"""A copy to edit, come back: its family, read safely.

Nothing in the file ever runs here. Only the family inside its page is read: the one script
element that holds it, found by its id; unlocked with the password when the copy is locked;
unpacked with a limit, so a small file can't unpack into gigabytes; then read strictly, each
part checked for its type and size before anything uses it. The file is untrusted: whatever
it says is only ever offered for review, never taken as the family's record, and pictures
stay as they came until they're used, when they're decoded and made again like any upload.
"""

import base64
import binascii
import json
import re
import zlib
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from ancestree.domain.exports import CopyPermissions
from ancestree.domain.person import DateQualifier, Gender
from ancestree.domain.relationship import SpouseStatus
from ancestree.exchange.copies import FORMAT, password_key
from ancestree.media.photos import Crop

MAX_FILE = 64 * 1024 * 1024  # bytes: a copy with its app and a few hundred photos
MAX_UNPACKED = 256 * 1024 * 1024  # what its family may unpack to
MAX_PICTURE = 30 * 1024 * 1024  # a data: address, as text
_FEWEST_ROUNDS, _MOST_ROUNDS = 100_000, 5_000_000  # PBKDF2: a file can't ask for a day's work
_PAYLOAD = re.compile(rb'<script type="application/json" id="ancestree-copy">(.*?)</script>', re.S)
_WEBP = "data:image/webp;base64,"

Text = Annotated[str, StringConstraints(max_length=200)]
Long = Annotated[str, StringConstraints(max_length=5000)]
Year = Annotated[int, Field(ge=1, le=9999)]


class ReturnedError(Exception):
    """The file can't be brought in; `code` says why, for the API."""

    code = "bad_copy"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotACopyError(ReturnedError):
    code = "not_a_copy"


class NotToEditError(ReturnedError):
    code = "not_to_edit"


class LockedError(ReturnedError):
    code = "locked"


class WrongPasswordError(ReturnedError):
    code = "wrong_password"


class DamagedError(ReturnedError):
    code = "damaged"


# --- What a copy to edit carries, checked ------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ReturnedPerson(_Strict):
    """Someone as a copy to edit carries them (exchange/records.py): types and sizes checked
    here; whether their details make sense is checked when they're compared."""

    id: UUID
    full_name: Text = Field(min_length=1)
    gender: Gender = Gender.UNKNOWN
    placeholder: bool = False
    has_photo: bool = False
    nickname: Text | None = None
    title: Text | None = None
    name_jawi: Text | None = None
    birth_year: Year | None = None
    birth_month: int | None = Field(default=None, ge=1, le=12)
    birth_day: int | None = Field(default=None, ge=1, le=31)
    birth_qualifier: DateQualifier | None = None
    birth_year_to: Year | None = None
    birth_original_text: Text | None = None
    death_year: Year | None = None
    death_month: int | None = Field(default=None, ge=1, le=12)
    death_day: int | None = Field(default=None, ge=1, le=31)
    death_qualifier: DateQualifier | None = None
    death_year_to: Year | None = None
    death_original_text: Text | None = None
    birth_town: Text | None = None
    birth_state: Text | None = None
    birth_country: Text | None = None
    death_town: Text | None = None
    death_state: Text | None = None
    death_country: Text | None = None
    residence_town: Text | None = None
    residence_state: Text | None = None
    residence_country: Text | None = None
    burial_place: Text | None = None
    living: bool | None = None
    occupation: Text | None = None
    notes: Long | None = None
    birth_order: int | None = Field(default=None, ge=0, le=10_000)
    photo_version: int | None = Field(default=None, ge=0, le=1_000_000_000)


class ReturnedLink(_Strict):
    id: UUID
    type: Literal["parent", "spouse"]
    source: UUID  # for a parent link, the parent
    target: UUID
    kind: Annotated[str, StringConstraints(max_length=64)] | None = None
    status: SpouseStatus | None = None


class ReturnedStory(_Strict):
    story: Annotated[str, StringConstraints(max_length=2_000_000)]
    sources: list[Annotated[str, StringConstraints(max_length=1000)]] = Field(max_length=500)


class ReturnedPhoto(_Strict):
    """A photo chosen in the copy: the whole of it as the copy shrank it, and its crop."""

    display: Annotated[str, StringConstraints(max_length=MAX_PICTURE)]
    crop: Crop


class _Family(_Strict):
    people: list[ReturnedPerson] = Field(max_length=50_000)
    links: list[ReturnedLink] = Field(max_length=200_000)


class _Editing(_Strict):
    id: UUID
    for_: Annotated[str, StringConstraints(max_length=200)] = Field(alias="for")
    may: CopyPermissions = Field(default_factory=CopyPermissions)
    made_at: datetime
    saved_at: datetime | None = None
    hidden: list[UUID] = Field(default_factory=list, max_length=50_000)


class _About(_Strict):
    title: Annotated[str, StringConstraints(max_length=200)] = ""
    editing: _Editing


class _Snapshot(_Strict):
    format: int
    about: _About
    family: _Family
    stories: dict[UUID, ReturnedStory] = Field(default_factory=dict, max_length=50_000)
    files: dict[
        Annotated[str, StringConstraints(max_length=300)],
        Annotated[str, StringConstraints(max_length=MAX_PICTURE)],
    ] = Field(default_factory=dict, max_length=200_000)
    photos: dict[UUID, ReturnedPhoto] = Field(default_factory=dict, max_length=50_000)


class _Lock(_Strict):
    salt: Annotated[str, StringConstraints(max_length=200)]
    iv: Annotated[str, StringConstraints(max_length=200)]
    iterations: int
    data: str


class _Sealed(_Strict):
    format: int
    gzip: str | None = None
    locked: _Lock | None = None


@dataclass(frozen=True)
class Returned:
    """A copy to edit as it came back: who made its changes, and what it holds now."""

    copy_id: str
    for_name: str  # as the file says: the app goes by its own record of the copy
    title: str
    made_at: datetime
    saved_at: datetime | None  # None: as the app made it, never saved from the copy
    locked: bool
    people: dict[str, ReturnedPerson]
    links: dict[str, ReturnedLink]
    stories: dict[str, ReturnedStory]
    files: dict[str, str]  # data: addresses, by the address the app asks for them at
    photos: dict[str, ReturnedPhoto]

    def picture(self, address: str) -> bytes | None:
        """A picture the copy carries, as bytes: only WebP, which is all a copy ever makes."""
        return webp_bytes(self.files.get(address))


def webp_bytes(address: str | None) -> bytes | None:
    """The bytes of a data: address for a WebP picture; None for anything else."""
    if not address or not address.startswith(_WEBP):
        return None
    try:
        return base64.b64decode(address.removeprefix(_WEBP), validate=True)
    except binascii.Error, ValueError:
        return None


# --- Reading -----------------------------------------------------------------------------------


def _b64(text: str, what: str) -> bytes:
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as error:
        raise DamagedError(f"This copy is damaged: its {what} can't be read.") from error


def _unpack(data: bytes) -> bytes:
    """Gunzip, stopping at MAX_UNPACKED: a file can't make the app unpack gigabytes."""
    unpacker = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        unpacked = unpacker.decompress(data, MAX_UNPACKED + 1)
    except zlib.error as error:
        raise DamagedError("This copy is damaged: its family can't be unpacked.") from error
    if len(unpacked) > MAX_UNPACKED or unpacker.unconsumed_tail:
        raise DamagedError("This copy's family is too big to bring in.")
    return unpacked


def _unlock(lock: _Lock, password: str | None) -> bytes:
    if password is None:
        raise LockedError("This copy is locked. Type its password to bring its changes in.")
    if not _FEWEST_ROUNDS <= lock.iterations <= _MOST_ROUNDS:
        raise DamagedError("This copy is damaged: its lock isn't one AncesTree makes.")
    key = password_key(password, _b64(lock.salt, "lock"), lock.iterations)
    try:
        return AESGCM(key).decrypt(_b64(lock.iv, "lock"), _b64(lock.data, "family"), None)
    except (InvalidTag, ValueError) as error:
        raise WrongPasswordError("That isn't the password of this copy.") from error


def sealed_in(page: bytes) -> dict[str, Any]:
    """The family's place in a copy's page, as it's written there. Only that is read."""
    match = _PAYLOAD.search(page)
    if match is None:
        raise NotACopyError(
            "That isn't an AncesTree copy: choose the .html file a relative sent back."
        )
    try:
        sealed: dict[str, Any] = json.loads(match[1])
    except ValueError as error:
        raise DamagedError("This copy is damaged: its family can't be read.") from error
    return sealed


def read_returned(page: bytes, password: str | None = None) -> Returned:
    """A copy to edit's family, from its page. Refused, with the reason, for a file that
    isn't a copy to edit, a locked one without its password, or a damaged one."""
    if len(page) > MAX_FILE:
        raise DamagedError("That file is larger than a copy can be (64 MB).")
    try:
        sealed = _Sealed.model_validate(sealed_in(page))
    except ValidationError as error:
        raise DamagedError("This copy is damaged: its family can't be read.") from error
    if sealed.format != FORMAT:
        raise DamagedError("This copy was made by a newer AncesTree: update the app first.")
    if sealed.locked is not None:
        packed = _unlock(sealed.locked, password)
    elif sealed.gzip is not None:
        packed = _b64(sealed.gzip, "family")
    else:
        raise DamagedError("This copy is damaged: its family isn't in it.")
    try:
        found = json.loads(_unpack(packed))
    except ValueError as error:
        raise DamagedError("This copy is damaged: its family can't be read.") from error
    if not isinstance(found, dict):
        raise DamagedError("This copy is damaged: its family can't be read.")
    about = found.get("about")
    if not isinstance(about, dict) or not about.get("editing"):
        raise NotToEditError(
            "That's a view-only copy: nothing can be changed in it, so there's nothing to "
            "bring back."
        )
    try:
        snapshot = _Snapshot.model_validate(found)
    except ValidationError as error:
        where = ".".join(str(part) for part in error.errors()[0]["loc"][:3])
        raise DamagedError(
            f"This copy is damaged: {where} isn't as AncesTree writes it."
        ) from error
    editing = snapshot.about.editing
    return Returned(
        copy_id=str(editing.id),
        for_name=editing.for_,
        title=snapshot.about.title,
        made_at=editing.made_at,
        saved_at=editing.saved_at,
        locked=sealed.locked is not None,
        people={str(person.id): person for person in snapshot.family.people},
        links={str(link.id): link for link in snapshot.family.links},
        stories={str(pid): story for pid, story in snapshot.stories.items()},
        files=snapshot.files,
        photos={str(pid): photo for pid, photo in snapshot.photos.items()},
    )
