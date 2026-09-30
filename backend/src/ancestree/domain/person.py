"""People, with partial dates and places."""

import calendar
from enum import StrEnum
from typing import Annotated, Self
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


class Place(BaseModel):
    model_config = ConfigDict(frozen=True)

    town: OptionalText = Field(default=None, max_length=100)
    state: OptionalText = Field(default=None, max_length=100)
    country: str = Field(default="Malaysia", max_length=100)

    @property
    def is_empty(self) -> bool:
        """Only the default country: nothing was actually entered."""
        return self.town is None and self.state is None and self.country == "Malaysia"


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
    living: bool | None = None  # None: infer from the dates
    occupation: str | None = None
    notes: str | None = None
    birth_order: int | None = Field(default=None, ge=1)
    placeholder: bool = False
    has_photo: bool = False
    photo_version: int = 0
