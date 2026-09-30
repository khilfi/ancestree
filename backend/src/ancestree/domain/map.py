"""The map's answers: where each person lives and was born,
found on the map, and the places you've put on it by hand."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from ancestree.domain.person import OptionalText, Place


class Pin(BaseModel):
    """A place the gazetteer doesn't know, put on the map by hand: everyone who lives or was
    born there lands on it."""

    town: OptionalText = Field(default=None, max_length=100)
    state: OptionalText = Field(default=None, max_length=100)
    country: str = Field(default="Malaysia", max_length=100)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)

    def place(self) -> Place:
        return Place(town=self.town, state=self.state, country=self.country)


class MapPins(BaseModel):
    """Every pin, kept in settings/app.json, so backups carry them."""

    pins: list[Pin] = Field(default_factory=list)


class Located(BaseModel):
    """A place as written, and where it goes on the map: `found` says how. None there means it
    wasn't found: a country the gazetteer doesn't know."""

    place: Place
    lat: float | None = None
    lon: float | None = None
    found: Literal["pin", "town", "state", "country"] | None = None
    name: str | None = None  # what it was found as: "Kota Bharu", "Kelantan", "Malaysia"
    state: str | None = None  # the state it counts under: the person form's name in Malaysia
    country: str  # the country it counts under, in English


class MapPerson(BaseModel):
    id: UUID
    lives: Located | None = None  # None: no "Lives in"
    born: Located | None = None  # None: no birthplace


class FamilyMap(BaseModel):
    """Everyone but unknown parents, with where they live and were born, and the pins."""

    people: list[MapPerson]
    pins: list[Pin]
