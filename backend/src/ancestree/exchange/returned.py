"""What a relative's computer sent the keeper: its whole
family, read strictly.

Nothing in it ever runs here, and none of it is taken as the family's record: it's read part by
part, each checked for its type and size before anything uses it, and only ever offered for the
keeper's review. Pictures stay as they came until they're used, when they're decoded and made
again like any upload.
"""

import base64
import binascii
from dataclasses import dataclass
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from ancestree.domain.person import DateQualifier, Gender
from ancestree.domain.relationship import SpouseStatus
from ancestree.media.photos import Crop

MAX_PICTURE = 30 * 1024 * 1024  # a data: address, as text
_WEBP = "data:image/webp;base64,"

Text = Annotated[str, StringConstraints(max_length=200)]
Long = Annotated[str, StringConstraints(max_length=5000)]
Year = Annotated[int, Field(ge=1, le=9999)]


class ReturnedError(Exception):
    """What was sent can't be brought in; `code` says why, for the API."""

    code = "bad_changes"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class DamagedError(ReturnedError):
    code = "damaged"


# --- What a computer sends, checked ------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ReturnedPerson(_Strict):
    """Someone as a computer sends them (exchange/records.py): types and sizes checked here;
    whether their details make sense is checked when they're compared."""

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
    """A photo chosen on their computer: the whole of it, as a WebP, and its crop."""

    display: Annotated[str, StringConstraints(max_length=MAX_PICTURE)]
    crop: Crop


class _Family(_Strict):
    people: list[ReturnedPerson] = Field(max_length=50_000)
    links: list[ReturnedLink] = Field(max_length=200_000)


class _Sent(_Strict):
    """A relative's family as their computer sent it: everyone, every link, the life stories,
    and the photos and story pictures that are new there."""

    family: _Family
    stories: dict[UUID, ReturnedStory] = Field(default_factory=dict, max_length=50_000)
    files: dict[
        Annotated[str, StringConstraints(max_length=300)],
        Annotated[str, StringConstraints(max_length=MAX_PICTURE)],
    ] = Field(default_factory=dict, max_length=200_000)
    photos: dict[UUID, ReturnedPhoto] = Field(default_factory=dict, max_length=50_000)


@dataclass(frozen=True)
class Returned:
    """A relative's family as it came: which computer sent it, and what it holds."""

    sender: str  # the computer, by its id in the family folder
    people: dict[str, ReturnedPerson]
    links: dict[str, ReturnedLink]
    stories: dict[str, ReturnedStory]
    files: dict[str, str]  # data: addresses, by the address the app asks for them at
    photos: dict[str, ReturnedPhoto]

    def picture(self, address: str) -> bytes | None:
        """A picture it sent, as bytes: only WebP, which is all the app sends."""
        return webp_bytes(self.files.get(address))


def webp_bytes(address: str | None) -> bytes | None:
    """The bytes of a data: address for a WebP picture; None for anything else."""
    if not address or not address.startswith(_WEBP):
        return None
    try:
        return base64.b64decode(address.removeprefix(_WEBP), validate=True)
    except binascii.Error, ValueError:
        return None


def sent_family(found: object, sender: str) -> Returned:
    """A relative's family as their computer sent it, read strictly: it's only ever
    offered for the keeper's review. `sender` names the computer."""
    try:
        sent = _Sent.model_validate(found)
    except ValidationError as error:
        where = ".".join(str(part) for part in error.errors()[0]["loc"][:3])
        raise DamagedError(
            f"What it sent is damaged: {where} isn't as AncesTree writes it."
        ) from error
    return Returned(
        sender=sender,
        people={str(person.id): person for person in sent.family.people},
        links={str(link.id): link for link in sent.family.links},
        stories={str(pid): story for pid, story in sent.stories.items()},
        files=sent.files,
        photos={str(pid): photo for pid, photo in sent.photos.items()},
    )
