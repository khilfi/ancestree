"""Stored relationships and configurable relationship kinds.

Only two relationships are stored: parent -> child, and spouse <-> spouse.
Everything else (grandparent, uncle, cousin, in-law, step-family) is derived.
"""

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ancestree.domain.person import Gender, OptionalText

BIOLOGICAL = "biological"


class SpouseStatus(StrEnum):
    MARRIED = "married"
    DIVORCED = "divorced"
    WIDOWED = "widowed"


class ParentLink(BaseModel):
    """`parent_id` is a parent of `child_id`. `kind` is the key of a RelationshipKind."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    parent_id: UUID
    child_id: UUID
    kind: str = BIOLOGICAL


class SpouseLink(BaseModel):
    """Stored once, read in both directions. `order` numbers a person's marriages."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    person_a: UUID
    person_b: UUID
    status: SpouseStatus = SpouseStatus.MARRIED
    order: int | None = Field(default=None, ge=1)


class GenderedLabel(BaseModel):
    """One side of a relationship kind: "adoptive parent", or "adoptive father"/"mother"."""

    neutral: str = Field(min_length=1, max_length=60)
    male: OptionalText = Field(default=None, max_length=60)
    female: OptionalText = Field(default=None, max_length=60)

    def for_gender(self, gender: Gender) -> str:
        if gender is Gender.MALE and self.male:
            return self.male
        if gender is Gender.FEMALE and self.female:
            return self.female
        return self.neutral


class KindWords(BaseModel):
    """A kind's words in another kinship language, e.g. Malay: "angkat", "bapa
    angkat" / "emak angkat", "anak angkat". `label` is the kind as a qualifier, as in "abang
    angkat"."""

    label: str = Field(min_length=1, max_length=60)
    parent_label: GenderedLabel
    child_label: GenderedLabel


class RelationshipKind(BaseModel):
    """A kind of parent-child link. Biological is built in; the rest are yours to configure.

    Only `blood` kinds count towards blood relationships in the kinship engine.
    `in_layout` decides whether the child is placed on a ring outside this parent.
    `words` holds its Malay ("ms") and Javanese ("jv") words; without them the English
    labels stand in.
    """

    key: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str
    builtin: bool
    blood: bool
    active: bool
    in_layout: bool
    sort_order: int
    parent_label: GenderedLabel
    child_label: GenderedLabel
    words: dict[str, KindWords] = Field(default_factory=dict)
