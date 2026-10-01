"""Merging two people: someone entered twice becomes one.

The one kept keeps everything it has. Where it has nothing, it takes the other's detail. Each
of the other's links moves to it through the app's own rules: one it has already is left as
it is, one between the two goes, and one the rules refuse stays with the other. The other then
goes to the Trash, so all of it can be brought back for 30 days. The people and links are one
Undo step.

Their photo and life story come across only to someone who has none, copied, so the other
keeps theirs in the Trash. Where both have a story, the other's stays with them, to copy from.
"""

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.merge import MergeDetail, MergeLink, MergePreview
from ancestree.domain.person import Gender
from ancestree.domain.relationship import BIOLOGICAL, SpouseStatus
from ancestree.domain.views import PersonSaved
from ancestree.exchange.spreadsheet import shown
from ancestree.media.photos import Crop
from ancestree.repo import kinds as kinds_repo
from ancestree.repo import links as links_repo
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import date_from_props, date_props, place_from, place_props
from ancestree.services import people as people_service
from ancestree.services import photos
from ancestree.services.context import (
    Context,
    NotFoundError,
    RuleError,
    folder_lock,
    read,
    write,
)
from ancestree.services.history import History
from ancestree.services.relationships import add_parent, add_spouse
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage import biography as stories
from ancestree.storage import files

# The details merged, as the app labels them, and what holds each.
_DETAILS = (
    ("Nickname", "nickname"),
    ("Title", "title"),
    ("Name in Jawi", "name_jawi"),
    ("Gender", "gender"),
    ("Born", "birth_date"),
    ("Birthplace", "birth_place"),
    ("Died", "death_date"),
    ("Death place", "death_place"),
    ("Burial place", "burial_place"),
    ("Lives in", "residence"),
    ("Living", "living"),
    ("Occupation", "occupation"),
    ("Notes", "notes"),
)
_PLACES = {"birth_place": "birth", "death_place": "death", "residence": "residence"}

type Props = Mapping[str, Any]


def _detail(props: Props, name: str) -> object:
    """A detail as the app holds it: a date, a place, a gender, text or yes/no; None if empty."""
    if name in ("birth_date", "death_date"):
        try:
            return date_from_props(name.removesuffix("_date"), props)
        except ValueError:
            return None
    if name in _PLACES:
        place = place_from(_PLACES[name], props)
        return None if place is None or place.is_empty else place
    if name == "gender":
        gender = Gender(props.get("gender") or Gender.UNKNOWN)
        return None if gender is Gender.UNKNOWN else gender
    if name == "living":
        return props.get("living")
    value = props.get(name)
    return value.strip() or None if isinstance(value, str) else None


def _as_props(name: str, value: Any) -> dict[str, Any]:
    if name in ("birth_date", "death_date"):
        return date_props(name.removesuffix("_date"), value)
    if name in _PLACES:
        return place_props(_PLACES[name], value)
    if name == "gender":
        return {"gender": value.value}
    return {name: value}


def _details(keep: Props, other: Props) -> tuple[list[MergeDetail], dict[str, Any]]:
    """Each detail either has, and what the one kept takes: what it has none of."""
    details: list[MergeDetail] = []
    taken: dict[str, Any] = {}
    for label, name in _DETAILS:
        mine, theirs = _detail(keep, name), _detail(other, name)
        if theirs is None:
            continue
        takes = mine is None
        details.append(MergeDetail(label=label, keep=shown(mine), other=shown(theirs), taken=takes))
        if takes:
            taken |= _as_props(name, theirs)
    return details, taken


@dataclass
class _Merged:
    keep: Props
    other: Props
    details: list[MergeDetail]
    links: list[MergeLink] = field(default_factory=list)
    ends: set[str] = field(default_factory=set)  # everyone the moved links join


async def _merge(tx: Tx, keep_id: str, other_id: str) -> _Merged:
    """The other's details and links, on the one kept, as far as the rules allow. Their link
    left out stays with them, into the Trash."""
    keep = await people_repo.fetch_person(tx, keep_id)
    other = await people_repo.fetch_person(tx, other_id)
    if keep is None or other is None:
        raise NotFoundError("They're no longer both in the tree.")
    if keep_id == other_id:
        raise RuleError("same_person", "Choose someone else to merge into them.")
    if keep.get("placeholder") or other.get("placeholder"):
        raise RuleError(
            "unknown_parent",
            "An unknown parent can't be merged: fill them in with someone instead.",
        )
    details, taken = _details(keep, other)
    if taken:
        await people_repo.update_person(tx, keep_id, taken)
    merged = _Merged(keep, other, details)
    kinds = await kinds_repo.fetch_kinds(tx)
    for link in await people_repo.fetch_links_of(tx, other_id):
        props = dict(link["props"])
        spouse = link["type"] == "SPOUSE_OF"
        end = link["target"] if link["source"] == other_id else link["source"]
        named = (await people_repo.fetch_person(tx, end) or {}).get("full_name", "someone")
        what = "Spouse" if spouse else ("Child" if link["source"] == other_id else "Parent")
        description = f"{what}: {named}"
        if end == keep_id:
            await links_repo.delete_link(tx, str(props["id"]))
            merged.links.append(MergeLink(description=description, outcome="between"))
            continue
        if any(
            existing["type"] == link["type"]
            for existing in await links_repo.links_between(tx, keep_id, end)
        ):
            merged.links.append(MergeLink(description=description, outcome="already"))
            continue
        await links_repo.delete_link(tx, str(props["id"]))  # out first: it may hold a place
        people = await people_repo.fetch_people(tx, [keep_id, end])
        try:
            if spouse:
                status = SpouseStatus(props.get("status") or SpouseStatus.MARRIED)
                await add_spouse(tx, keep_id, end, status, people)
            else:
                parent, child = (keep_id, end) if link["source"] == other_id else (end, keep_id)
                kind = str(props.get("kind") or BIOLOGICAL)
                await add_parent(tx, parent, child, kind, kinds, people, allow_hidden=True)
        except RuleError as error:
            # Back as it was, with the other: it goes to the Trash with them.
            if spouse:
                await links_repo.create_spouse_link(
                    tx, str(props["id"]), link["source"], link["target"],
                    str(props.get("status") or SpouseStatus.MARRIED.value),
                )  # fmt: skip
            else:
                await links_repo.create_parent_link(
                    tx, str(props["id"]), link["source"], link["target"],
                    str(props.get("kind") or BIOLOGICAL),
                )  # fmt: skip
            merged.links.append(
                MergeLink(description=description, outcome="left_out", why=error.message)
            )
            continue
        merged.links.append(MergeLink(description=description, outcome="moved"))
        merged.ends.add(end)
    return merged


def _has_story(ctx: Context, person_id: str) -> bool:
    text = stories.read_story(ctx.data_dir, person_id)
    return bool(text and text.strip())


def _files_say(ctx: Context, keep: Props, other: Props) -> tuple[str, str]:
    """What becomes of the other's photo and story: none to take, the one kept keeps its own,
    or, having none, takes the other's; with a story each, the other's stays with them."""
    photo = "none"
    if other.get("has_photo"):
        photo = "kept" if keep.get("has_photo") else "taken"
    story = "none"
    if _has_story(ctx, str(other["id"])):
        story = "both" if _has_story(ctx, str(keep["id"])) else "taken"
    return photo, story


class _RollBackError(Exception):
    """Not a failure: it ends a preview's transaction, so nothing it did is kept."""

    def __init__(self, merged: _Merged) -> None:
        super().__init__("rolled back")
        self.merged = merged


async def preview_merge(ctx: Context, keep_id: UUID, other_id: UUID) -> MergePreview:
    """What merging `other` into `keep` would do, rehearsed and rolled back."""

    async def rehearse(tx: Tx) -> None:
        raise _RollBackError(await _merge(tx, str(keep_id), str(other_id)))

    try:
        await write(ctx, rehearse)
    except _RollBackError as rolled_back:
        merged = rolled_back.merged
    else:
        raise RuntimeError("A preview is always rolled back.")
    photo, story = await asyncio.to_thread(_files_say, ctx, merged.keep, merged.other)
    return MergePreview(
        keep=keep_id,
        keep_name=str(merged.keep["full_name"]),
        other=other_id,
        other_name=str(merged.other["full_name"]),
        details=merged.details,
        links=merged.links,
        photo=photo,  # type: ignore[arg-type]
        story=story,  # type: ignore[arg-type]
    )


@dataclass(frozen=True)
class _Theirs:
    """The other's photo and story, read before their folder goes to the Trash."""

    photo: tuple[bytes, Crop | None] | None
    story: str | None
    pictures: dict[str, bytes]


def _theirs(ctx: Context, other: Props, photo: str, story: str) -> _Theirs:
    other_id = str(other["id"])
    original = files.read_original(ctx.data_dir, other_id) if photo == "taken" else None
    text = stories.read_story(ctx.data_dir, other_id) if story == "taken" else None
    pictures: dict[str, bytes] = {}
    for name in stories.pictures_in(text or ""):
        path = stories.picture_file(ctx.data_dir, other_id, name)
        if path is not None:
            pictures[name] = path.read_bytes()
    return _Theirs(
        photo=(original, files.read_crop(ctx.data_dir, other_id)) if original else None,
        story=text,
        pictures=pictures,
    )


def _copy_story(ctx: Context, keep_id: str, theirs: _Theirs) -> None:
    """The other's story and its pictures, now the one kept's, who had none."""
    media = files.person_dir(ctx.data_dir, keep_id) / stories.MEDIA
    for name, data in theirs.pictures.items():
        media.mkdir(parents=True, exist_ok=True)
        files.atomic_write(media / name, data)
    stories.write_story(ctx.data_dir, keep_id, theirs.story or "")


async def merge_people(
    ctx: Context, history: History, keep_id: UUID, other_id: UUID
) -> PersonSaved:
    """Merge `other` into `keep`: one Undo step for the people and links; the other then to
    the Trash. A photo or story the one kept lacks is copied from the other's."""
    keep, other = str(keep_id), str(other_id)

    async def both(tx: Tx) -> tuple[Props | None, Props | None, list[dict[str, Any]]]:
        return (
            await people_repo.fetch_person(tx, keep),
            await people_repo.fetch_person(tx, other),
            await people_repo.fetch_links_of(tx, other),
        )

    kept, merging, before = await read(ctx, both)
    if kept is None or merging is None:
        raise NotFoundError("They're no longer both in the tree.")
    photo, story = await asyncio.to_thread(_files_say, ctx, kept, merging)
    theirs = await asyncio.to_thread(_theirs, ctx, merging, photo, story)
    ends = {str(link["source"]) for link in before} | {str(link["target"]) for link in before}
    links = [str(link["props"]["id"]) for link in before]
    async with history.change(ctx, {keep, other, *ends}, links) as change:
        merged = await write(ctx, lambda tx: _merge(tx, keep, other))
        change.label = f"Merge {merged.other['full_name']} into {merged.keep['full_name']}"
        change.removing = [other]
    if theirs.photo is not None:
        data, crop = theirs.photo
        await photos.upload_photo(ctx, keep_id, data, crop)
    if theirs.story is not None:
        async with folder_lock(keep):
            await asyncio.to_thread(_copy_story, ctx, keep, theirs)
    await refresh_snapshots(ctx, {keep, *merged.ends})
    return PersonSaved(person=await people_service.get_person(ctx, keep_id), notices=[])
