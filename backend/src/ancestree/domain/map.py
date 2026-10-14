"""The map's answers: where each person lives and was born,
found on the map, and the places you've put on it by hand."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

from ancestree.domain.person import Exactness, OptionalText, Place

# Whether an address may be looked up online, on this computer: asked each time, without
# asking, or never.
Lookup = Literal["ask", "always", "never"]


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
    district: str | None = None  # a town's, where the gazetteer gives one: "Tumpat"
    # Where its own location puts it, finer than its town: the house, the street, the
    # postcode's area, or by hand. None where the town, a pin or the gazetteer placed it.
    exact: Exactness | None = None


class MapPerson(BaseModel):
    id: UUID
    lives: Located | None = None  # None: no "Lives in"
    born: Located | None = None  # None: no birthplace
    # With no place of their own, their parents': whose, so it's said, and so What's
    # missing can list the grown-ups among them.
    at_parents: Literal["mother", "father", "parents"] | None = None


class Town(BaseModel):
    """A town or kampung around the family's places, named on the map: from a state's
    zoom when it has 1,000 people or more, else as you zoom closer."""

    name: str
    lat: float
    lon: float
    people: int  # as GeoNames knows it: 0 for most kampungs


class FamilyMap(BaseModel):
    """Everyone but unknown parents, with where they live and were born, the pins, and the
    towns around the family's places, the most worth naming first."""

    people: list[MapPerson]
    pins: list[Pin]
    towns: list[Town] = Field(default_factory=list)


# A pack's key: the world's, a country's ISO code in small letters ("my"), or a state's
# ("us-ca"). packs.json lists them all, so no country is named in the code.
PackKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)?$", max_length=24)]


class MapPack(BaseModel):
    """One of the map's packs of OpenStreetMap's tiles, and how it stands on this
    computer: the world, fetched on first opening the map, or a country or a state of one,
    when chosen."""

    key: PackKey
    title: str  # "Malaysia", "California"
    country: str = ""  # its country's key; none for the world's
    size: int  # bytes
    minzoom: int
    maxzoom: int
    first: bool  # fetched on first opening the map
    installed: bool
    fetching: bool
    done: int  # bytes fetched so far, while it's on its way
    error: str | None = None  # why the last try failed


class MapCountry(BaseModel):
    """A country in Settings → Map, and its packs: its own, or each of its states'."""

    key: str  # "my"
    title: str  # "Malaysia"
    continent: str  # "Asia"
    packs: list[str]  # its packs' keys


class MapPlaces(BaseModel):
    """A country's places, or the world's: fetched with its packs, for finding where
    someone lived or was born, and how they stand on this computer."""

    country: str  # its country's key, or "world"
    size: int  # bytes
    installed: bool
    fetching: bool
    done: int  # bytes fetched so far, while they're on their way
    error: str | None = None  # why the last try failed


class PlaceSuggestion(BaseModel):
    """What an address line, as it's typed, may be: the place's parts to fill in, and
    where it is, as exactly as the postcode's spot or the town's; what's nearest a point put on
    the map by hand; or what an online lookup found, to the house where it knows
    it, with the address it found it as."""

    town: str
    district: str
    state: str
    postcode: str
    country: str  # its English name, as the person form has it
    lat: float
    lon: float
    exact: Exactness
    address: str = ""  # the house and street an online lookup found: "12 Jalan Melati 3"


class PlaceSuggestions(BaseModel):
    """Suggestions for an address line, in a country; and whether that country's places
    are on this computer, so its download can be offered where they aren't."""

    country: str | None  # its key ("my"); None for a country the map doesn't know
    downloaded: bool
    suggestions: list[PlaceSuggestion]


class FamilyCountries(BaseModel):
    """The countries anyone in the family lives or was born in, by key ("my"): Settings → Map
    lists them first."""

    countries: list[str]


class MapPacks(BaseModel):
    """The packs, all cut from one of Protomaps' builds of OpenStreetMap, the countries
    they're of, and whether the map's online extra is on: OpenFreeMap's tiles, where the
    packs end."""

    build: str  # "20261010"
    packs: list[MapPack]
    countries: list[MapCountry] = Field(default_factory=list)
    places: list[MapPlaces] = Field(default_factory=list)
    online: bool = False
    lookup: Lookup = "ask"  # whether an address may be looked up online
    # How many addresses were placed more exactly when a country's places came, by its
    # key, or "world": since the app started.
    placed: dict[str, int] = Field(default_factory=dict)


class OnlineMap(BaseModel):
    """The map's online extra turned on or off."""

    on: bool


class OnlineLookup(BaseModel):
    """Whether an address may be looked up online: asked each time, without asking, or
    never."""

    lookup: Lookup


class LookupAsked(BaseModel):
    """An address to look up online, once: the line as typed, in its country."""

    line: str = Field(min_length=2, max_length=300)
    country: str = Field(default="Malaysia", max_length=100)
