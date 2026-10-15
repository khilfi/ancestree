"""People, with partial dates and places."""

import calendar
from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator


class Gender(StrEnum):
    MALE = "male"
    FEMALE = "female"
    UNKNOWN = "unknown"


class DateQualifier(StrEnum):
    EXACT = "exact"
    ABOUT = "about"
    BEFORE = "before"
    AFTER = "after"
    BETWEEN = "between"


class PartialDate(BaseModel):
    """A date that may be incomplete or approximate: "1950", "Mar 1950", "c. 1920", "1910-1915".

    Unknown parts stay empty; they are never filled with a stand-in value.
    """

    model_config = ConfigDict(frozen=True)

    year: int | None = Field(default=None, ge=1, le=9999)
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)
    qualifier: DateQualifier = DateQualifier.EXACT
    year_to: int | None = Field(default=None, ge=1, le=9999)
    original_text: str | None = None

    @model_validator(mode="after")
    def check_parts(self) -> Self:
        if self.day is not None and self.month is None:
            raise ValueError("a day needs a month")
        if self.month is not None and self.year is None:
            raise ValueError("a month needs a year")
        if self.year is not None and self.month is not None and self.day is not None:
            days_in_month = calendar.monthrange(self.year, self.month)[1]
            if self.day > days_in_month:
                month = calendar.month_name[self.month]
                raise ValueError(f"{month} {self.year} has no day {self.day}")
        if self.qualifier is DateQualifier.BETWEEN:
            if self.year is None or self.year_to is None:
                raise ValueError("'between' needs both year and year_to")
            if self.year_to < self.year:
                raise ValueError("year_to must not be before year")
        elif self.year_to is not None:
            raise ValueError("year_to is only used with 'between'")
        if self.year is None and self.qualifier is not DateQualifier.EXACT:
            raise ValueError("a qualifier needs a year")
        return self


def blank_to_none(value: object) -> object:
    """Form fields arrive as "" when left empty; store that as missing."""
    if isinstance(value, str):
        return value.strip() or None
    return value


OptionalText = Annotated[str | None, BeforeValidator(blank_to_none)]


# How exactly a place's location puts it: the house found (street search), the
# street's middle, the postcode's area, the town's middle; or put there by hand, on the map or
# as coordinates, which nothing moves again by itself.
Exactness = Literal["spot", "street", "postcode", "town", "hand"]
# The finer the better: what a country's places, downloaded later, may move a location up to.
EXACTER: dict[str, int] = {"town": 0, "postcode": 1, "street": 2, "spot": 3, "hand": 4}


class Place(BaseModel):
    model_config = ConfigDict(frozen=True)

    town: OptionalText = Field(default=None, max_length=100)
    state: OptionalText = Field(default=None, max_length=100)
    country: str = Field(default="Malaysia", max_length=100)
    # Since 0.8.0: the address in one line, house and street; the district and the
    # postcode; and where it is, and how exactly: the house's spot, the street's, the postcode's
    # or the town's. A place from before has none of them, and reads as it did.
    address: OptionalText = Field(default=None, max_length=300)
    district: OptionalText = Field(default=None, max_length=100)
    postcode: OptionalText = Field(default=None, max_length=20)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    exact: Exactness | None = None

    @model_validator(mode="after")
    def located_whole(self) -> Self:
        """A location is both its numbers, and how exact it is says nothing without one."""
        if (self.lat is None) != (self.lon is None):
            raise ValueError("A location needs both its latitude and its longitude")
        if self.lat is None and self.exact is not None:
            raise ValueError("How exact a location is needs the location")
        return self

    @property
    def is_empty(self) -> bool:
        """Only the default country: nothing was actually entered."""
        given = (self.town, self.state, self.address, self.district, self.postcode, self.lat)
        return all(part is None for part in given) and self.country == "Malaysia"

    def over(self, held: Place | None) -> Place:
        """This place, said by its town, state and country alone, laid over the one held,
        as a spreadsheet or a computer before 0.8.0 says it: in the same town, the held one's
        address, district, postcode and location stay; another town is a move, and drops them."""
        if held is None or (self.town or "").casefold() != (held.town or "").casefold():
            return self
        return held.model_copy(update={"state": self.state, "country": self.country})

    def to_the_town(self) -> Place:
        """This place no closer than its town (0.8.0): its address, postcode and location gone,
        as a copy hiding living people's details has everyone's."""
        return self.model_copy(update=dict.fromkeys(("address", "postcode", "lat", "lon", "exact")))


# Where someone with no place of their own lives: at their mother's, their father's,
# or elsewhere, so not at their parents'. None: their parents', the mother's if they live apart.
LivesWith = Literal["mother", "father", "elsewhere"]

# The place of death: kept in the database, backups and the family folder, but shown
# on no screen and in no file made for anyone, as it's sensitive. True brings it all back.
DEATH_PLACES = False


def death_places() -> bool:
    """Whether the place of death is shown and sent, or only kept (DEATH_PLACES): read each
    time, so a test can turn it on."""
    return DEATH_PLACES


class Person(BaseModel):
    id: UUID
    full_name: str = Field(min_length=1, max_length=200)
    nickname: str | None = None
    title: str | None = None
    name_jawi: str | None = None
    gender: Gender = Gender.UNKNOWN
    birth_date: PartialDate | None = None
    birth_place: Place | None = None
    death_date: PartialDate | None = None
    death_place: Place | None = None
    burial_place: str | None = None
    residence: Place | None = None
    lives_with: LivesWith | None = None  # with no residence of their own
    living: bool | None = None  # None: infer from the dates
    occupation: str | None = None
    notes: str | None = None
    birth_order: int | None = Field(default=None, ge=1)
    placeholder: bool = False
    has_photo: bool = False
    photo_version: int = 0
