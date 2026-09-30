"""Family facts: facts about the whole family, each naming its
people by id so the app can open them."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class FactPerson(BaseModel):
    id: UUID
    name: str  # as the answers say it: "Tok Ismail", "Siti"


class Counts(BaseModel):
    """What the tree's toolbar used to show, and more."""

    people: int
    links: int
    couples: int
    unknown_parents: int
    families: int  # families with no link to each other
    unlinked: int  # waiting in "Not linked yet"


class GenerationCount(BaseModel):
    generation: int  # as on the rings: 1 is the centre
    people: int


class PersonDate(BaseModel):
    """ "Tok Ismail, born about 1905"."""

    person: FactPerson
    date: str


class PersonYears(BaseModel):
    """ "Nenek Fatimah, 94 years"."""

    person: FactPerson
    years: int
    about: bool


class Parents(BaseModel):
    """ "Hassan & Mariam, 4 children"."""

    parents: list[FactPerson]
    children: int


class Descendants(BaseModel):
    """ "Tok Ismail & Nenek Fatimah, 38 over 4 generations"."""

    people: list[FactPerson]  # one, or a couple with the same descendants
    count: int
    generations: int


class Pair(BaseModel):
    """Two people and what joins them: the links between them, or a kinship word."""

    a: FactPerson
    b: FactPerson
    links: int | None = None  # the longest chain
    term: str | None = None  # "second cousin once removed": b as seen from a


class NameCount(BaseModel):
    """ "Siti (3)", "Selangor (9)", with who they are."""

    name: str
    people: list[FactPerson]


class DecadeCount(BaseModel):
    decade: int  # 1950 for the 1950s
    people: int


class Anniversary(BaseModel):
    """A birthday this month, or the anniversary of a death."""

    person: FactPerson
    kind: Literal["birthday", "death"]
    day: int | None
    date: str  # "14 March 1938"
    years: int | None  # turning 40; died 15 years ago


class SiblingGroup(BaseModel):
    """Children of the same parents whose order isn't known yet."""

    parents: list[FactPerson]
    children: list[FactPerson]


class ToFillIn(BaseModel):
    no_gender: list[FactPerson]
    no_birth_year: list[FactPerson]
    no_birth_order: list[SiblingGroup]


class FamilyFacts(BaseModel):
    counts: Counts
    generations: list[GenerationCount]  # the main family's, married-in families alongside
    oldest: PersonDate | None  # the earliest birth recorded
    youngest: PersonDate | None
    span_years: int | None  # between the oldest and the youngest
    span_about: bool
    longest_life: PersonYears | None
    average_life: int | None
    lives_known: int  # how many lives, birth to death, the average is of
    oldest_living: PersonYears | None
    biggest_family: Parents | None
    most_descendants: Descendants | None
    longest_chain: Pair | None
    farthest_by_blood: Pair | None
    cousins_married: list[Pair]
    names: list[NameCount]  # given names shared by two or more
    birthplaces: list[NameCount]
    decades: list[DecadeCount]
    month: str  # "September"
    this_month: list[Anniversary]
    to_fill_in: ToFillIn
