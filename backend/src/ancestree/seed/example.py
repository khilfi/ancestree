"""The example family: Keluarga Contoh grown into a full
example, to look around in. About 65 made-up people over six generations, grown from the test
family's own, with drawn portraits, life stories with every part, what people say, addresses
across Malaysia, a family in Singapore and a son in Melbourne, and every shape of family the app
knows. It fills a family of its own, the first time that family opens: never mixed with a real
one, which it refuses to touch."""

import asyncio
import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from importlib import resources
from pathlib import Path
from typing import Self
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ancestree.domain.graph import MeSettings, TreeSettings
from ancestree.domain.kinship import KinshipSettings
from ancestree.domain.person import DateQualifier, Gender, LivesWith, PartialDate, Person, Place
from ancestree.domain.relationship import ParentLink, SpouseLink
from ancestree.media.photos import ProcessedPhoto, process_photo, process_picture
from ancestree.repo.people import (
    add_parent_links,
    add_spouse_links,
    count_people_by_source,
    upsert_people,
)
from ancestree.seed.drawing import Headwear, Look, portrait, scene
from ancestree.seed.family import SeedFamilyUnit, SeedMarriage
from ancestree.services.context import Context
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage import biography as stories
from ancestree.storage import files
from ancestree.storage.settings import write_kinship_settings, write_me, write_tree_settings

NAME = "Keluarga Contoh"
_NAMESPACE = uuid5(NAMESPACE_URL, "https://ancestree.app/example-family")
_SCENE = re.compile(r"\]\(scene:(river|station|garden|city)\)")


def example_id(name: str) -> UUID:
    """Its people's and links' ids: the same in every example family, as each is apart."""
    return uuid5(_NAMESPACE, name)


def _date(text: str) -> PartialDate:
    """ "1938-03-14", "1938-03" or "1938"; "c. 1872", about; "1876-1880", between."""
    if text.startswith("c. "):
        return PartialDate(year=int(text[3:]), qualifier=DateQualifier.ABOUT)
    if re.fullmatch(r"\d{4}-\d{4}", text):
        start, end = text.split("-")
        return PartialDate(year=int(start), year_to=int(end), qualifier=DateQualifier.BETWEEN)
    parts = [int(part) for part in text.split("-")]
    return PartialDate(
        year=parts[0],
        month=parts[1] if len(parts) > 1 else None,
        day=parts[2] if len(parts) > 2 else None,
    )


class Drawn(BaseModel):
    """How their portrait is drawn (seed/drawing.py)."""

    model_config = ConfigDict(extra="forbid")

    headwear: Headwear
    skin: int = Field(ge=0, le=4)
    glasses: bool = False
    beard: bool = False
    age: int | None = None  # as drawn; else their age now


class ExamplePerson(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    full_name: str
    nickname: str | None = None
    title: str | None = None
    name_jawi: str | None = None
    gender: Gender = Gender.UNKNOWN
    born: PartialDate | None = None
    birth_place: Place | None = None
    died: PartialDate | None = None
    death_place: Place | None = None
    burial_place: str | None = None
    residence: Place | None = None
    lives_with: LivesWith | None = None
    occupation: str | None = None
    notes: str | None = None
    birth_order: int | None = None
    placeholder: bool = False
    drawn: Drawn | None = None

    @field_validator("born", "died", mode="before")
    @classmethod
    def _dates(cls, value: object) -> object:
        return _date(value) if isinstance(value, str) else value

    def look(self, today: date) -> Look | None:
        """How they're drawn: as they are now, or late in their life."""
        if self.drawn is None or self.born is None or self.born.year is None:
            return None
        age = self.drawn.age
        if age is None:
            end = self.died.year if self.died and self.died.year else today.year
            age = end - self.born.year
        return Look(
            key=self.key,
            female=self.gender is Gender.FEMALE,
            age=age,
            skin=self.drawn.skin,
            headwear=self.drawn.headwear,
            glasses=self.drawn.glasses,
            beard=self.drawn.beard,
        )


class ExampleFamily(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    me: str  # whom "Me" is: one of the grandchildren
    titles: list[str]
    youngest: str
    people: list[ExamplePerson]
    families: list[SeedFamilyUnit]
    marriages: list[SeedMarriage]

    @model_validator(mode="after")
    def check_references(self) -> Self:
        keys = {person.key for person in self.people}
        if len(keys) != len(self.people):
            raise ValueError("people's keys must differ")
        named = [self.me]
        named += [key for unit in self.families for key in [*unit.parents, *unit.children]]
        named += [key for marriage in self.marriages for key in marriage.spouses]
        if missing := sorted(set(named) - keys):
            raise ValueError(f"unknown people: {missing}")
        return self

    def person_id(self, key: str) -> UUID:
        return example_id(f"person:{key}")

    def people_as_domain(self) -> list[Person]:
        return [
            Person(
                id=self.person_id(person.key),
                full_name=person.full_name,
                nickname=person.nickname,
                title=person.title,
                name_jawi=person.name_jawi,
                gender=person.gender,
                birth_date=person.born,
                birth_place=person.birth_place,
                death_date=person.died,
                death_place=person.death_place,
                burial_place=person.burial_place,
                residence=person.residence,
                lives_with=person.lives_with,
                occupation=person.occupation,
                notes=person.notes,
                birth_order=person.birth_order,
                placeholder=person.placeholder,
                has_photo=person.drawn is not None,
                photo_version=1 if person.drawn is not None else 0,
            )
            for person in self.people
        ]

    def parent_links(self) -> list[ParentLink]:
        return [
            ParentLink(
                id=example_id(f"parent:{parent}>{child}"),
                parent_id=self.person_id(parent),
                child_id=self.person_id(child),
                kind=unit.kind,
            )
            for unit in self.families
            for parent in unit.parents
            for child in unit.children
        ]

    def spouse_links(self) -> list[SpouseLink]:
        return [
            SpouseLink(
                id=example_id(f"spouse:{marriage.spouses[0]}={marriage.spouses[1]}"),
                person_a=self.person_id(marriage.spouses[0]),
                person_b=self.person_id(marriage.spouses[1]),
                status=marriage.status,
                order=marriage.order,
            )
            for marriage in self.marriages
        ]


def _here() -> resources.abc.Traversable:
    return resources.files("ancestree.seed") / "example"


def load_example_family() -> ExampleFamily:
    return ExampleFamily.model_validate_json((_here() / "family.json").read_text("utf-8"))


def example_stories() -> dict[str, str]:
    """Each life story, by whose it is, as biography.md holds it; drawn scenes still named."""
    folder = _here() / "stories"
    return {
        entry.name.removesuffix(".md"): entry.read_text("utf-8")
        for entry in folder.iterdir()
        if entry.name.endswith(".md")
    }


class ExampleRefusedError(Exception):
    """Raised instead of mixing the example family with anyone else."""


@dataclass(frozen=True)
class ExampleResult:
    people: int
    links: int
    photos: int
    stories: int


def _photos(data_dir: Path, family: ExampleFamily, today: date) -> int:
    """Each portrait drawn and kept as a photo uploaded would be: several at once, as drawing
    and making the copies mostly leave Python free."""
    looks = [(person, look) for person in family.people if (look := person.look(today))]

    def drawn(look: Look) -> tuple[bytes, ProcessedPhoto]:
        original = portrait(look)
        return original, process_photo(original)

    with ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 1)) as pool:
        made = pool.map(drawn, [look for _, look in looks])
        for (person, _), (original, photo) in zip(looks, made, strict=True):
            files.store_photo(data_dir, family.person_id(person.key), original, photo)
    return len(looks)


def _stories(data_dir: Path, family: ExampleFamily) -> int:
    pictures: dict[str, bytes] = {}
    told = example_stories()
    for key, text in told.items():
        person = family.person_id(key)

        def drawn(found: re.Match[str], person: UUID = person) -> str:
            name = found[1]
            if name not in pictures:
                pictures[name] = process_picture(scene(name))  # type: ignore[arg-type]
            kept = stories.store_picture(data_dir, person, pictures[name])
            return f"]({stories.MEDIA}/{kept})"

        stories.write_story(data_dir, person, _SCENE.sub(drawn, text))
    return len(told)


async def write_example(ctx: Context) -> ExampleResult:
    """Fill this family with the example family: its people and links, their portraits and
    stories, and its settings. Refused where anyone is here already."""
    counts = await count_people_by_source(ctx.driver, ctx.database)
    if sum(counts.values()):
        raise ExampleRefusedError(
            "The example family goes in a family of its own: this one has people already."
        )
    family = load_example_family()
    people = family.people_as_domain()
    parents, spouses = family.parent_links(), family.spouse_links()
    await upsert_people(ctx.driver, ctx.database, people)
    written = await add_parent_links(ctx.driver, ctx.database, parents)
    written += await add_spouse_links(ctx.driver, ctx.database, spouses)
    if written != len(parents) + len(spouses):
        raise RuntimeError("Some of the example family's links couldn't be written.")
    today = date.today()
    photos = await asyncio.to_thread(_photos, ctx.data_dir, family, today)
    told = await asyncio.to_thread(_stories, ctx.data_dir, family)
    await asyncio.to_thread(write_me, ctx.data_dir, MeSettings(person=family.person_id(family.me)))
    await asyncio.to_thread(
        write_kinship_settings,
        ctx.data_dir,
        KinshipSettings(titles=family.titles, youngest=family.youngest),
    )
    await asyncio.to_thread(write_tree_settings, ctx.data_dir, TreeSettings())
    await refresh_snapshots(ctx, [str(person.id) for person in people])
    return ExampleResult(len(people), written, photos, told)
