"""What the API accepts."""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field, field_validator, model_validator

from ancestree.domain.dates import DateParseError, parse_partial_date
from ancestree.domain.person import Gender, OptionalText, PartialDate, Place
from ancestree.domain.relationship import BIOLOGICAL, GenderedLabel, KindWords, SpouseStatus


def _read_typed_date(value: object) -> object:
    """Dates arrive as parts from the date picker, or typed ("c. 1950") from imports and
    the command line. Typed ones are read here, so a bad one fails on its field."""
    if value is None or isinstance(value, str):
        try:
            return parse_partial_date(value)
        except DateParseError as error:
            raise ValueError(str(error)) from error
    return value


TypedDate = Annotated[
    PartialDate | None,
    BeforeValidator(_read_typed_date, json_schema_input_type=PartialDate | str | None),
]

Relation = Literal["parent", "child", "spouse", "sibling"]


class PersonInput(BaseModel):
    """The person form. Only the full name is required."""

    full_name: str = Field(min_length=1, max_length=200)
    nickname: OptionalText = Field(default=None, max_length=100)
    title: OptionalText = Field(default=None, max_length=100)
    name_jawi: OptionalText = Field(default=None, max_length=200)
    gender: Gender = Gender.UNKNOWN
    birth_date: TypedDate = None
    birth_place: Place | None = None
    death_date: TypedDate = None
    death_place: Place | None = None
    burial_place: OptionalText = Field(default=None, max_length=200)
    residence: Place | None = None
    living: bool | None = None
    occupation: OptionalText = Field(default=None, max_length=200)
    notes: OptionalText = Field(default=None, max_length=5000)

    @field_validator("full_name", mode="before")
    @classmethod
    def strip_name(cls, value: object) -> object:
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("birth_place", "death_place", "residence")
    @classmethod
    def drop_empty_place(cls, value: Place | None) -> Place | None:
        return None if value is not None and value.is_empty else value


class PersonPatch(BaseModel):
    """What's missing's quick fixes, and the map's: only what's
    given changes. A date of birth comes as parts, or typed, like the form's."""

    gender: Gender | None = None
    birth_date: TypedDate = None
    residence: Place | None = None  # where they live
    birth_place: Place | None = None

    @field_validator("birth_place", "residence")
    @classmethod
    def drop_empty_place(cls, value: Place | None) -> Place | None:
        return None if value is not None and value.is_empty else value

    def changes(self) -> set[str]:
        """The fields given: a date or place given as null clears it; a gender as null
        changes nothing."""
        given = set(self.model_fields_set)
        if self.gender is None:
            given.discard("gender")
        return given


class RelationshipCreate(BaseModel):
    """Read as "`person_a` is `person_b`'s `a_is`": a is b's mother -> a_is "parent"."""

    person_a: UUID
    person_b: UUID
    a_is: Relation
    kind: str = BIOLOGICAL  # parent and child links
    status: SpouseStatus = SpouseStatus.MARRIED  # spouse links
    # Siblings: which of the other sibling's parents they share. Needed when only one of
    # the two has recorded parents; when neither has, an unknown parent joins them.
    shared_parents: list[UUID] | None = None


class RelationshipUpdate(BaseModel):
    kind: str | None = None  # parent links
    status: SpouseStatus | None = None  # spouse links
    swap: bool = False  # parent links: the child becomes the parent


class NewRelative(BaseModel):
    """Create someone already linked, e.g. "Add child"."""

    relation: Relation  # the new person is this person's <relation>
    person: PersonInput
    kind: str = BIOLOGICAL
    other_parent: UUID | None = None  # adding a child: the other parent, linked too


class FillIn(BaseModel):
    """An unknown parent becomes a real person: someone new, or someone in the tree."""

    person: PersonInput | None = None
    existing: UUID | None = None

    @model_validator(mode="after")
    def one_of_them(self) -> Self:
        if (self.person is None) == (self.existing is None):
            raise ValueError("give either a new person or someone already in the tree")
        return self


class ChildrenOrder(BaseModel):
    """Children of the same two parents, eldest first."""

    child_ids: list[UUID] = Field(min_length=1)


type KindLanguage = Literal["ms", "jv"]


class KindInput(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    parent_label: GenderedLabel
    child_label: GenderedLabel
    in_layout: bool = True
    words: dict[KindLanguage, KindWords] = Field(default_factory=dict)  # Malay, Javanese


class KindUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    parent_label: GenderedLabel | None = None
    child_label: GenderedLabel | None = None
    active: bool | None = None
    in_layout: bool | None = None
    sort_order: int | None = None
    words: dict[KindLanguage, KindWords] | None = None  # replaces them all when given
