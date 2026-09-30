"""The fictional test family "Keluarga Contoh".

About 40 people over 5 generations, built to exercise the hard cases: two concurrent
wives, a remarriage, an adoption, a cousin marriage, twins, an unknown parent, missing
and approximate dates, and an uncle (Zul) born the same year as his nephew (Ali).
Real family data never goes into the repository.
"""

from importlib import resources
from typing import Self
from uuid import UUID, uuid5

from pydantic import BaseModel, Field, model_validator

from ancestree.domain.person import Gender, PartialDate, Person, Place
from ancestree.domain.relationship import BIOLOGICAL, ParentLink, SpouseLink, SpouseStatus

SEED_SOURCE = "seed:keluarga_contoh"
_NAMESPACE = UUID("7d8f3b52-2c1e-4f0a-9a57-6b1f0c2e4d91")


def seed_id(name: str) -> UUID:
    """Stable ids, so reloading the family replaces the same people."""
    return uuid5(_NAMESPACE, name)


class SeedPerson(BaseModel):
    key: str
    full_name: str
    nickname: str | None = None
    gender: Gender = Gender.UNKNOWN
    birth: PartialDate | None = None
    birth_place: Place | None = None
    death: PartialDate | None = None
    residence: Place | None = None
    birth_order: int | None = None
    placeholder: bool = False


class SeedFamilyUnit(BaseModel):
    parents: list[str] = Field(min_length=1, max_length=2)
    children: list[str] = Field(min_length=1)
    kind: str = BIOLOGICAL


class SeedMarriage(BaseModel):
    spouses: tuple[str, str]
    status: SpouseStatus = SpouseStatus.MARRIED
    order: int | None = None


class SeedFamily(BaseModel):
    name: str
    description: str
    people: list[SeedPerson]
    families: list[SeedFamilyUnit]
    marriages: list[SeedMarriage]

    @model_validator(mode="after")
    def check_references(self) -> Self:
        keys = [person.key for person in self.people]
        duplicates = sorted({key for key in keys if keys.count(key) > 1})
        if duplicates:
            raise ValueError(f"duplicate keys: {duplicates}")
        referenced = {key for unit in self.families for key in (*unit.parents, *unit.children)}
        referenced |= {key for marriage in self.marriages for key in marriage.spouses}
        unknown = sorted(referenced - set(keys))
        if unknown:
            raise ValueError(f"unknown people: {unknown}")
        return self

    def people_as_domain(self) -> list[Person]:
        return [
            Person(
                id=seed_id(f"person:{p.key}"),
                full_name=p.full_name,
                nickname=p.nickname,
                gender=p.gender,
                birth_date=p.birth,
                birth_place=p.birth_place,
                death_date=p.death,
                residence=p.residence,
                birth_order=p.birth_order,
                placeholder=p.placeholder,
            )
            for p in self.people
        ]

    def parent_links(self) -> list[ParentLink]:
        return [
            ParentLink(
                id=seed_id(f"parent:{parent}>{child}"),
                parent_id=seed_id(f"person:{parent}"),
                child_id=seed_id(f"person:{child}"),
                kind=unit.kind,
            )
            for unit in self.families
            for parent in unit.parents
            for child in unit.children
        ]

    def spouse_links(self) -> list[SpouseLink]:
        return [
            SpouseLink(
                id=seed_id(f"spouse:{m.spouses[0]}={m.spouses[1]}"),
                person_a=seed_id(f"person:{m.spouses[0]}"),
                person_b=seed_id(f"person:{m.spouses[1]}"),
                status=m.status,
                order=m.order,
            )
            for m in self.marriages
        ]


def load_seed_family() -> SeedFamily:
    text = resources.files("ancestree.seed").joinpath("keluarga_contoh.json").read_text("utf-8")
    return SeedFamily.model_validate_json(text)
