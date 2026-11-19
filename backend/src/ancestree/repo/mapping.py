"""Models <-> flat Neo4j properties. Neo4j properties cannot hold nested objects,
so a birth date becomes `birth_year`, `birth_month`, ... and a place `birth_town`, ...
"""

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from ancestree.domain.person import Gender, PartialDate, Person, Place, death_places
from ancestree.domain.requests import PersonInput

_DATE_FIELDS = ("year", "month", "day", "qualifier", "year_to", "original_text")
# Each place's properties: the first three since 0.1.0, the rest since 0.8.0.
_PLACE_FIELDS = (
    "town",
    "state",
    "country",
    "address",
    "district",
    "postcode",
    "lat",
    "lon",
    "exact",
)


def person_to_props(person: Person) -> dict[str, Any]:
    props: dict[str, Any] = {
        "id": str(person.id),
        "birth_order": person.birth_order,
        "placeholder": person.placeholder,
        "has_photo": person.has_photo,
        "photo_version": person.photo_version,
    }
    return props | _details(person)


def editable_props(data: PersonInput) -> dict[str, Any]:
    """Only what the person form edits: never the id, photo, placeholder or birth order; nor
    the place of death while it's only kept, so a save never clears it."""
    props = _details(data)
    if not death_places():
        for name in place_props("death", None):
            del props[name]
    return props


def _details(source: Person | PersonInput) -> dict[str, Any]:
    props: dict[str, Any] = {
        "full_name": source.full_name,
        "nickname": source.nickname,
        "title": source.title,
        "name_jawi": source.name_jawi,
        "gender": source.gender.value,
        "burial_place": source.burial_place,
        "living": source.living,
        "lives_with": source.lives_with,
        "occupation": source.occupation,
        "notes": source.notes,
    }
    props |= date_props("birth", source.birth_date)
    props |= place_props("birth", source.birth_place)
    props |= date_props("death", source.death_date)
    props |= place_props("death", source.death_place)
    props |= place_props("residence", source.residence)
    return props


def detail_props(data: PersonInput, name: str) -> dict[str, Any]:
    """One detail of the person form as the properties that hold it (a date or a place is
    several): what the form says, and a detail it leaves empty clears them."""
    value = getattr(data, name)
    if name in ("birth_date", "death_date"):
        return date_props(name.removesuffix("_date"), value)
    if name in ("birth_place", "death_place"):
        return place_props(name.removesuffix("_place"), value)
    if name == "residence":
        return place_props("residence", value)
    if name == "gender":
        return {"gender": data.gender.value}
    return {name: value}


def person_from_props(props: Mapping[str, Any]) -> Person:
    return Person(
        id=UUID(props["id"]),
        full_name=props["full_name"],
        nickname=props.get("nickname"),
        title=props.get("title"),
        name_jawi=props.get("name_jawi"),
        gender=Gender(props.get("gender") or Gender.UNKNOWN),
        birth_date=date_from_props("birth", props),
        birth_place=place_from("birth", props),
        death_date=date_from_props("death", props),
        death_place=place_from("death", props),
        burial_place=props.get("burial_place"),
        residence=place_from("residence", props),
        lives_with=props.get("lives_with"),
        living=props.get("living"),
        occupation=props.get("occupation"),
        notes=props.get("notes"),
        birth_order=props.get("birth_order"),
        placeholder=bool(props.get("placeholder", False)),
        has_photo=bool(props.get("has_photo", False)),
        photo_version=int(props.get("photo_version") or 0),
    )


def date_props(prefix: str, date: PartialDate | None) -> dict[str, Any]:
    """A date as flat properties: `birth_year`, `birth_month`... None removes them all when
    written with `SET p += props`."""
    if date is None:
        return {f"{prefix}_{field}": None for field in _DATE_FIELDS}
    return {
        f"{prefix}_year": date.year,
        f"{prefix}_month": date.month,
        f"{prefix}_day": date.day,
        f"{prefix}_qualifier": date.qualifier.value,
        f"{prefix}_year_to": date.year_to,
        f"{prefix}_original_text": date.original_text,
    }


def place_props(prefix: str, place: Place | None) -> dict[str, Any]:
    if place is None:
        return {f"{prefix}_{field}": None for field in _PLACE_FIELDS}
    return {f"{prefix}_{field}": getattr(place, field) for field in _PLACE_FIELDS}


def date_from_props(prefix: str, props: Mapping[str, Any]) -> PartialDate | None:
    values = {field: props.get(f"{prefix}_{field}") for field in _DATE_FIELDS}
    if all(value is None for value in values.values()):
        return None
    return PartialDate.model_validate({k: v for k, v in values.items() if v is not None})


def place_from(prefix: str, props: Mapping[str, Any]) -> Place | None:
    values = {field: props.get(f"{prefix}_{field}") for field in _PLACE_FIELDS}
    if all(value is None for value in values.values()):
        return None
    return Place.model_validate({k: v for k, v in values.items() if v is not None})


_DATES = (("birth", "date of birth"), ("death", "date of death"))


def unreadable(props: Mapping[str, Any]) -> str | None:
    """Why someone's stored dates or places can't be read as the app reads them, or None:
    "Ali's date of birth can't be read: February 1950 has no day 31". A restore refuses one,
    and the family folder keeps the keeper's instead."""
    name = str(props.get("full_name") or "Someone")
    for prefix, what in _DATES:
        try:
            date_from_props(prefix, props)
        except ValidationError as error:
            return f"{name}'s {what} can't be read: {_why(error)}"
    died = f"where {name} died" if death_places() else f"a place kept for {name}"
    for prefix, where in (
        ("birth", f"where {name} was born"),
        ("death", died),  # unshown: not named
        ("residence", f"where {name} lives"),
    ):
        try:
            place_from(prefix, props)
        except ValidationError as error:
            return f"{where} can't be read: {_why(error)}"
    return None


def _why(error: ValidationError) -> str:
    first = error.errors()[0]
    said = str(first["msg"]).removeprefix("Value error, ")
    part = ".".join(str(step) for step in first.get("loc", ()))
    return f"{said} ({part})" if part else said


def whole_of(name: str) -> str:
    """The detail a stored property is part of: "birth_day" is part of the date of birth,
    "residence_lat" of where they live. Any other property is a detail of its own. A date or a
    place only ever changes whole, so it travels whole between computers."""
    prefix, _, part = name.partition("_")
    if prefix in ("birth", "death") and part in _DATE_FIELDS:
        return f"{prefix}_date"
    if prefix in ("birth", "death", "residence") and part in _PLACE_FIELDS:
        return f"{prefix}_place"
    return name
