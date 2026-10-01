"""Changes back from a copy to edit, and from a relative's
computer through the family folder.

A relative's copy comes back as a file. It's read safely (exchange/returned.py) and compared
with what the app knows the copy started from, and with the tree now (importing/returned.py):
each change is offered for you to tick, as a spreadsheet's are. Nothing is written until
you import; the preview rehearses the changes inside the database and rolls them back, so a
link the rules refuse shows as left out before you import.

The import makes a backup first. The people, details and links come in as one Undo step,
each through the app's own rules; life stories and photos after, as in the app. It's kept in
DATA_DIR/imports/, so Take back can later undo all of it; and the family as the file had it
becomes what the next file from the same copy is compared with.

A relative's computer sends its whole family through the family folder instead. It's
compared with the family as the keeper's record had it when the relative made their changes,
from the keeper's own record, and with the tree now: the same review, the same bringing in.
"""

import asyncio
import base64
import csv
import gzip
import io
import json
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Any
from uuid import UUID, uuid7

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.exports import CopyPermissions, ExportFormat
from ancestree.domain.imports import (
    CopyPreview,
    CopyReturned,
    ImportChange,
    ImportDone,
    ImportLeftOut,
    ImportSecondLook,
    ImportTakenBack,
)
from ancestree.domain.relationship import BIOLOGICAL, SpouseStatus
from ancestree.exchange.returned import Returned, read_returned, webp_bytes
from ancestree.exchange.spreadsheet import ENCODING, guard
from ancestree.importing.returned import (
    AddLink,
    AddPerson,
    Base,
    CopyPlan,
    FillIn,
    Order,
    Photo,
    Relink,
    Remove,
    SetDetail,
    Siblings,
    Story,
    TreeNow,
    Unlink,
    asked_stories,
    plan_returned,
)
from ancestree.media.photos import PhotoError, process_photo, process_picture, thumbnail
from ancestree.repo import history as history_repo
from ancestree.repo import imports as imports_repo
from ancestree.repo import kinds as kinds_repo
from ancestree.repo import links as links_repo
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import person_from_props
from ancestree.services import exports
from ancestree.services import people as people_service
from ancestree.services.context import Context, RuleError, folder_lock, read, write
from ancestree.services.families import by_blood, family_key
from ancestree.services.history import History
from ancestree.services.relationships import add_parent, add_spouse
from ancestree.services.rules import Facts, life_notices
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage import biography as stories_storage
from ancestree.storage import copies as copies_storage
from ancestree.storage import files
from ancestree.storage import imports as storage

TAG = "copy:"  # people brought in from a copy carry "copy:<the import's id>" as their source
SENT_TAG = "folder:"  # and from a relative's computer, "folder:<the import's id>"
UNKNOWN_PARENT = "Unknown parent"


def _plain(value: Any) -> Any:
    """Neo4j values as JSON: temporal values become ISO 8601 text."""
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    iso_format = getattr(value, "iso_format", None)
    return iso_format() if callable(iso_format) else value


def _facts(props: Mapping[str, Any]) -> Facts:
    person = person_from_props(props)
    return Facts(
        name=person.full_name,
        gender=person.gender,
        birth=person.birth_date,
        death=person.death_date,
    )


# --- Reading and comparing ---------------------------------------------------------------------


@dataclass(frozen=True)
class _Compared:
    returned: Returned
    base: Base
    about: dict[str, Any]
    brought: dict[str, Any] | None
    plan: CopyPlan

    def about_copy(self) -> CopyReturned:
        brought_at = self.brought.get("brought_at") if self.brought else None
        return CopyReturned(
            copy_id=self.returned.copy_id,
            for_name=str(self.about["for"]),
            title=str(self.about.get("title") or ""),
            made_at=datetime.fromisoformat(str(self.about["made_at"])),
            saved_at=self.returned.saved_at,
            brought_at=datetime.fromisoformat(brought_at) if brought_at else None,
            locked=self.returned.locked,
        )


def _base(ctx: Context, returned: Returned) -> tuple[Base, dict[str, Any], dict[str, Any] | None]:
    """What the app knows the copy started from, or what the last file from it brought in."""
    try:
        about, start = copies_storage.read_copy(ctx.data_dir, returned.copy_id)
    except KeyError as error:
        raise RuleError(
            "unknown_copy",
            "This copy wasn't made by this AncesTree, so there's nothing here to compare it "
            "with. Only copies to edit made here can bring changes back.",
        ) from error
    brought = copies_storage.read_brought(ctx.data_dir, returned.copy_id)
    if brought is not None and brought.get("saved_at"):
        last = datetime.fromisoformat(brought["saved_at"])
        if returned.saved_at is None or returned.saved_at < last:
            raise RuleError(
                "older_copy",
                f"This file was saved before the one from this copy brought in on "
                f"{datetime.fromisoformat(brought['brought_at']):%d %b %Y}: it has nothing "
                "newer. Ask for their latest save.",
            )
    source = brought or start
    family = source["family"]
    return (
        Base(
            people={str(person["id"]): person for person in family["people"]},
            links={str(link["id"]): link for link in family["links"]},
            stories={str(pid): story for pid, story in source.get("stories", {}).items()},
            ids=dict(brought.get("ids", {})) if brought else {},
            may=CopyPermissions.model_validate(about.get("may") or {}),
            hidden=frozenset(str(pid) for pid in about.get("hidden", [])),
            for_name=str(about["for"]),
        ),
        about,
        brought,
    )


async def _tree_now(ctx: Context, stories_of: set[str]) -> TreeNow:
    async def work(tx: Tx) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Any]:
        people, links = await imports_repo.read_whole_tree(tx)
        return people, links, await kinds_repo.fetch_kinds(tx)

    people, links, kinds = await read(ctx, work)

    def stories() -> dict[str, str | None]:
        return {pid: stories_storage.read_story(ctx.data_dir, pid) for pid in stories_of}

    return TreeNow(
        people={str(props["id"]): props for props in people},
        links=links,
        kinds=kinds,
        stories=await asyncio.to_thread(stories),
    )


async def _compare(
    ctx: Context, data: bytes, password: str | None, answers: Mapping[str, str]
) -> _Compared:
    returned = await asyncio.to_thread(read_returned, data, password)
    base, about, brought = await asyncio.to_thread(_base, ctx, returned)
    tree = await _tree_now(ctx, asked_stories(base, returned))
    plan = plan_returned(base, returned, tree, answers)
    return _Compared(returned, base, about, brought, plan)


@dataclass(frozen=True)
class Sent:
    """What a relative's computer sent through the family folder, and the family it was
    made on, from the keeper's own record."""

    returned: Returned
    base: Base
    device: str
    proposal: int
    computer: str  # its name, as the family knows it
    email: str  # its owner's Google account
    sent_at: datetime
    packed: bytes  # what it sent, gzipped JSON: kept with the import

    def about(self) -> CopyReturned:
        return CopyReturned(
            copy_id=self.device,
            for_name=self.computer,
            title="",
            made_at=self.sent_at,
            saved_at=self.sent_at,
            brought_at=None,
            locked=False,
        )


async def _compare_sent(ctx: Context, sent: Sent, answers: Mapping[str, str]) -> _Compared:
    tree = await _tree_now(ctx, asked_stories(sent.base, sent.returned))
    plan = plan_returned(sent.base, sent.returned, tree, answers)
    about = {"for": sent.computer, "title": "", "made_at": sent.sent_at.isoformat()}
    return _Compared(sent.returned, sent.base, about, None, plan)


def _photos_shown(compared: _Compared) -> None:
    """Each new photo, small, for the review: made again from the copy's pixels. One that
    can't be read is left out."""
    plan = compared.plan
    for change in list(plan.changes):
        operation = plan.operations.get(change.id)
        if not isinstance(operation, Photo) or operation.display is None:
            continue
        data = webp_bytes(operation.display)
        try:
            if data is None:
                raise PhotoError("not a picture")
            small = thumbnail(data)
        except PhotoError:
            plan.changes.remove(change)
            del plan.operations[change.id]
            plan.left_out.append(
                ImportLeftOut(
                    row=None,
                    column=change.name,
                    written="Photo",
                    why="The photo in the copy can't be read, so it's left out.",
                )
            )
            continue
        change.picture = "data:image/webp;base64," + base64.b64encode(small).decode("ascii")


# --- Carrying out ------------------------------------------------------------------------------


@dataclass
class _Done:
    """What carrying out the changes did, for the record and Take back."""

    carried: set[str]
    created: list[str] = field(default_factory=list)  # people it added
    placeholders: list[str] = field(default_factory=list)  # unknown parents it added
    placeholder_ids: dict[str, str] = field(default_factory=dict)  # the copy's -> the tree's
    link_ids: list[str] = field(default_factory=list)  # links it made
    changed: list[dict[str, Any]] = field(default_factory=list)  # details: before and after
    relinked: list[dict[str, Any]] = field(default_factory=list)  # links it changed
    unlinked: list[dict[str, Any]] = field(default_factory=list)  # links it took out, as they were
    orphans: list[dict[str, Any]] = field(default_factory=list)  # unknown parents that went too
    filled: list[dict[str, Any]] = field(default_factory=list)  # unknown parents filled in
    removing: list[str] = field(default_factory=list)  # to the Trash, once the rest is done
    stories: list[dict[str, Any]] = field(default_factory=list)
    photos: list[dict[str, Any]] = field(default_factory=list)
    refused: list[ImportLeftOut] = field(default_factory=list)
    refused_ids: set[str] = field(default_factory=set)
    notices: list[ImportSecondLook] = field(default_factory=list)

    def refuse(self, change: ImportChange, why: str) -> None:
        self.refused.append(
            ImportLeftOut(row=None, column=change.name, written=change.column or "", why=why)
        )
        self.refused_ids.add(change.id)
        self.carried.discard(change.id)

    def touched(self) -> set[str]:
        """Whose views may have changed: for the snapshots kept beside each person."""
        people = {*self.created, *self.placeholders}
        people |= {str(item["person"]) for item in self.changed}
        people |= {str(item["person"]) for item in (*self.stories, *self.photos)}
        for item in (*self.relinked, *self.unlinked):
            people |= {str(item["source"]), str(item["target"])}
        for item in self.filled:
            people |= {str(item["parent"]), *(str(link["target"]) for link in item["links"])}
        return people


async def _add_person(
    tx: Tx, operation: AddPerson, change: ImportChange, done: _Done, tag: str
) -> None:
    if await people_repo.fetch_person(tx, operation.person) is not None:
        done.refuse(change, "Someone in the tree has the same id already, so they're left out.")
        return
    props = {**operation.props, "source": tag}
    await people_repo.create_person(tx, props)
    done.created.append(operation.person)
    done.notices += [
        ImportSecondLook(row=None, message=notice.message) for notice in life_notices(_facts(props))
    ]


async def _set(tx: Tx, operation: SetDetail, change: ImportChange, done: _Done) -> None:
    now = await people_repo.fetch_person(tx, operation.person)
    if now is None:
        done.refuse(change, "They're no longer in the tree.")
        return
    before = {key: now.get(key) for key in operation.props}
    await people_repo.update_person(tx, operation.person, operation.props)
    done.changed.append(
        {
            "person": operation.person,
            "field": operation.field,
            "before": before,
            "after": operation.props,
        }
    )


async def _relink(tx: Tx, operation: Relink, change: ImportChange, done: _Done) -> None:
    link = await links_repo.fetch_link(tx, operation.link)
    if link is None:
        done.refuse(change, "That link is no longer in the tree.")
        return
    record = {
        "link": operation.link,
        "type": link["type"],
        "source": link["source"],
        "target": link["target"],
        "before": _plain(link["props"]),
        "swap": operation.swap,
    }
    if link["type"] == "SPOUSE_OF":
        status = operation.status or SpouseStatus.MARRIED
        await links_repo.update_link(tx, operation.link, {"status": status.value})
        done.relinked.append(record | {"after": {**record["before"], "status": status.value}})
        return
    was = str(link["props"].get("kind") or BIOLOGICAL)
    kind = operation.kind or was
    parent, child = link["source"], link["target"]
    if operation.swap:
        parent, child = child, parent
    # Out, then back in through the same rules, so they see the change (as the app does).
    await links_repo.delete_link(tx, operation.link)
    people = await people_repo.fetch_people(tx, [parent, child])
    kinds = await kinds_repo.fetch_kinds(tx)
    try:
        await add_parent(
            tx, parent, child, kind, kinds, people, link_id=operation.link, allow_hidden=kind == was
        )
    except RuleError as error:
        await links_repo.create_parent_link(tx, operation.link, link["source"], link["target"], was)
        done.refuse(change, error.message)
        return
    done.relinked.append(record | {"after": {**record["before"], "kind": kind}})


async def _unlink(tx: Tx, operation: Unlink, done: _Done) -> None:
    link = await links_repo.fetch_link(tx, operation.link)
    if link is None:
        return  # gone already
    await links_repo.delete_link(tx, operation.link)
    done.unlinked.append(
        {
            "id": operation.link,
            "type": link["type"],
            "source": link["source"],
            "target": link["target"],
            "props": _plain(link["props"]),
        }
    )
    # An unknown parent with no one left to stand in for goes too, as in the app.
    parent = await people_repo.fetch_person(tx, link["source"])
    if (
        parent
        and parent.get("placeholder")
        and not await people_repo.fetch_links_of(tx, link["source"])
    ):
        await people_repo.delete_person(tx, link["source"])
        done.orphans.append(_plain(parent))


async def _fill_in(tx: Tx, operation: FillIn, change: ImportChange, done: _Done) -> None:
    unknown = await people_repo.fetch_person(tx, operation.placeholder)
    if unknown is None or not unknown.get("placeholder"):
        done.refuse(change, "The unknown parent has been filled in or taken out since.")
        return
    parent = await people_repo.fetch_person(tx, operation.parent)
    if parent is None:
        done.refuse(change, "Who fills them in isn't in the tree.")
        return
    children = [
        row["person"]["id"] for row in await people_repo.fetch_children(tx, operation.placeholder)
    ]
    # The rules, checked before anything changes: nothing is half done.
    for child in children:
        name = (await people_repo.fetch_person(tx, child) or {}).get("full_name", "a child")
        if await links_repo.links_between(tx, operation.parent, child):
            done.refuse(change, f"{parent['full_name']} and {name} are linked already.")
            return
        if await links_repo.is_ancestor(tx, child, operation.parent):
            done.refuse(change, f"{name} is already an ancestor of {parent['full_name']}.")
            return
        others = [
            row
            for row in await links_repo.blood_parents(tx, child)
            if row["id"] != operation.placeholder
        ]
        if len(others) >= 2:
            done.refuse(change, f"{name} already has two biological parents.")
            return
    links = [
        {"id": link["props"]["id"], **_plain(link)}
        for link in await people_repo.fetch_links_of(tx, operation.placeholder)
    ]
    await people_repo.delete_person(tx, operation.placeholder)  # its links go with it
    people = await people_repo.fetch_people(tx, [operation.parent, *children])
    kinds = await kinds_repo.fetch_kinds(tx)
    made: list[str] = []
    for child in children:
        linked = await add_parent(tx, operation.parent, child, BIOLOGICAL, kinds, people)
        made += [str(view.id) for view in linked.links]
    done.link_ids += made
    done.filled.append(
        {"placeholder": _plain(unknown), "links": links, "parent": operation.parent, "made": made}
    )


async def _siblings(
    tx: Tx, operation: Siblings, change: ImportChange, done: _Done, tag: str
) -> None:
    kinds = await kinds_repo.fetch_kinds(tx)
    people = await people_repo.fetch_people(tx, list(operation.children))
    if len(people) != len(operation.children):
        done.refuse(change, "Not all of them are in the tree.")
        return
    parents = [
        by_blood(await links_repo.parent_ids(tx, child), kinds) for child in operation.children
    ]
    if set(parents[0]).intersection(*parents[1:]):
        done.refuse(change, "They share a parent in the tree already.")
        return
    for child, theirs in zip(operation.children, parents, strict=True):
        if len(theirs) >= 2:
            done.refuse(change, f"{people[child]['full_name']} already has two biological parents.")
            return
    placeholder = operation.placeholder
    if await people_repo.fetch_person(tx, placeholder) is not None:
        placeholder = str(uuid7())
    await people_repo.create_person(
        tx,
        {
            "id": placeholder,
            "full_name": UNKNOWN_PARENT,
            "gender": "unknown",
            "placeholder": True,
            "has_photo": False,
            "photo_version": 0,
            "source": tag,
        },
    )
    done.placeholders.append(placeholder)
    if placeholder != operation.placeholder:
        done.placeholder_ids[operation.placeholder] = placeholder
    for child, wanted in zip(operation.children, operation.links, strict=True):
        link_id = wanted if await links_repo.fetch_link(tx, wanted) is None else str(uuid7())
        await links_repo.create_parent_link(tx, link_id, placeholder, child, BIOLOGICAL)
        done.link_ids.append(link_id)


async def _link(tx: Tx, operation: AddLink, change: ImportChange, done: _Done) -> None:
    people = await people_repo.fetch_people(tx, [operation.a, operation.b])
    if len(people) != 2:
        done.refuse(change, "Someone it joins isn't in the tree.")
        return
    try:
        if operation.type == "spouse":
            linked = await add_spouse(tx, operation.a, operation.b, operation.status, people)
        else:
            free = await links_repo.fetch_link(tx, operation.link) is None
            kinds = await kinds_repo.fetch_kinds(tx)
            linked = await add_parent(
                tx,
                operation.a,
                operation.b,
                operation.kind,
                kinds,
                people,
                link_id=operation.link if free else None,
            )
    except RuleError as error:
        done.refuse(change, error.message)
        return
    done.link_ids += [str(view.id) for view in linked.links]
    done.notices += [ImportSecondLook(row=None, message=n.message) for n in linked.notices]


async def _order(tx: Tx, operation: Order, change: ImportChange, done: _Done) -> None:
    first = sorted(operation.parents)[0]
    kinds = await kinds_repo.fetch_kinds(tx)
    rows = {row["person"]["id"]: row for row in await people_repo.fetch_children(tx, first)}
    family = {
        cid
        for cid, row in rows.items()
        if family_key(row, first, kinds) == (None, operation.parents - {first})
    }
    if family != set(operation.children):
        done.refuse(
            change,
            "Their brothers and sisters have changed in the tree since, so the order is left "
            "for you to set.",
        )
        return
    for number, child in enumerate(operation.children, start=1):
        before = rows[child]["person"].get("birth_order")
        done.changed.append(
            {
                "person": child,
                "field": "birth_order",
                "before": {"birth_order": before},
                "after": {"birth_order": number},
            }
        )
    await people_repo.set_birth_orders(
        tx, {child: number for number, child in enumerate(operation.children, start=1)}
    )


# In this order: new people first; then what makes room (links changed and taken out, unknown
# parents filled in) before new links take it; the birth order once everyone's linked.
_ORDER: tuple[type, ...] = (
    AddPerson,
    SetDetail,
    Relink,
    Unlink,
    FillIn,
    Siblings,
    AddLink,
    Order,
    Remove,
)


async def _carry_out(tx: Tx, plan: CopyPlan, carried: set[str], tag: str) -> _Done:
    """The people, details and links chosen, each through the app's rules; one they refuse
    is left out, and only that one. Removals are left to the caller, through the Trash."""
    done = _Done(carried=set(carried))
    by_id = {change.id: change for change in plan.changes}
    for kind in _ORDER:
        for change_id, operation in plan.operations.items():
            if change_id not in done.carried or not isinstance(operation, kind):
                continue
            if any(need in done.refused_ids for need in by_id[change_id].needs):
                done.refuse(by_id[change_id], "It needs something that couldn't come in.")
                continue
            change = by_id[change_id]
            match operation:
                case AddPerson():
                    await _add_person(tx, operation, change, done, tag)
                case SetDetail():
                    await _set(tx, operation, change, done)
                case Relink():
                    await _relink(tx, operation, change, done)
                case Unlink():
                    await _unlink(tx, operation, done)
                case FillIn():
                    await _fill_in(tx, operation, change, done)
                case Siblings():
                    await _siblings(tx, operation, change, done, tag)
                case AddLink():
                    await _link(tx, operation, change, done)
                case Order():
                    await _order(tx, operation, change, done)
                case Remove():
                    done.removing.append(operation.person)
    return done


def _rehearsal(plan: CopyPlan) -> set[str]:
    """Everything but the removals, stories and photos: so a link the rules refuse is found
    whatever is ticked. Those only come after, and can't make a link fail."""
    everything = [c.id for c in plan.changes if c.kind not in ("remove_person", "story", "photo")]
    return plan.carried_out(everything)


class _RollBackError(Exception):
    """Not a failure: it ends a preview's transaction, so everything it did is rolled back."""

    def __init__(self, done: _Done) -> None:
        super().__init__("rolled back")
        self.done = done


async def preview_copy(
    ctx: Context, data: bytes, file_name: str, password: str | None, answers: Mapping[str, str]
) -> CopyPreview:
    """What a copy to edit brings back, for you to tick. Nothing is written."""
    compared = await _compare(ctx, data, password, answers)
    return await _previewed(ctx, compared, file_name, compared.about_copy())


async def preview_sent(ctx: Context, sent: Sent, answers: Mapping[str, str]) -> CopyPreview:
    """What a relative's computer sent, for you to tick. Nothing is written."""
    compared = await _compare_sent(ctx, sent, answers)
    return await _previewed(ctx, compared, sent.computer, sent.about())


async def _previewed(
    ctx: Context, compared: _Compared, file_name: str, about: CopyReturned
) -> CopyPreview:
    plan = compared.plan

    async def rehearse(tx: Tx) -> _Done:
        raise _RollBackError(await _carry_out(tx, plan, _rehearsal(plan), f"{TAG}preview"))

    try:
        await write(ctx, rehearse)
    except _RollBackError as rolled_back:
        done = rolled_back.done
    else:
        raise RuntimeError("A preview is always rolled back.")
    await asyncio.to_thread(_photos_shown, compared)
    changes = [change for change in plan.changes if change.id not in done.refused_ids]
    return CopyPreview(
        file_name=file_name,
        about=about,
        questions=plan.questions,
        changes=changes,
        left_out=[*plan.left_out, *done.refused],
        second_look=[*plan.second_look, *done.notices],
    )


# --- Stories and photos, after the rest ---------------------------------------------------------


def _write_story(ctx: Context, operation: Story, returned: Returned) -> dict[str, Any] | str:
    """The story as the copy has it, with its new pictures made again and kept here: what
    was done, or why not."""
    now = stories_storage.read_story(ctx.data_dir, operation.person)
    if (now or "") != (operation.was or ""):
        return "Their story has been changed in the app since, so it's kept."
    text = operation.text
    for name, address in operation.pictures.items():
        data = returned.picture(address)
        if data is None:
            continue
        try:
            webp = process_picture(data)
        except PhotoError:
            continue
        kept = stories_storage.store_picture(ctx.data_dir, operation.person, webp)
        text = text.replace(f"media/{name}", f"media/{kept}")
    stories_storage.write_story(ctx.data_dir, operation.person, text)
    return {"person": operation.person, "before": now, "after": text or None}


async def _stories(ctx: Context, plan: CopyPlan, done: _Done, returned: Returned) -> None:
    by_id = {change.id: change for change in plan.changes}
    for change_id, operation in plan.operations.items():
        if change_id not in done.carried or not isinstance(operation, Story):
            continue
        if any(need in done.refused_ids for need in by_id[change_id].needs):
            done.refuse(by_id[change_id], "They couldn't come in, so neither can their story.")
            continue
        async with folder_lock(operation.person):
            result = await asyncio.to_thread(_write_story, ctx, operation, returned)
        if isinstance(result, str):
            done.refuse(by_id[change_id], result)
        else:
            done.stories.append(result)


async def _photos(ctx: Context, plan: CopyPlan, done: _Done) -> None:
    by_id = {change.id: change for change in plan.changes}
    for change_id, operation in plan.operations.items():
        if change_id not in done.carried or not isinstance(operation, Photo):
            continue
        change = by_id[change_id]
        if any(need in done.refused_ids for need in change.needs):
            done.refuse(change, "They couldn't come in, so neither can their photo.")
            continue
        props = await read(ctx, partial(people_repo.fetch_person, person_id=operation.person))
        if props is None:
            done.refuse(change, "They're no longer in the tree.")
            continue
        now = props.get("photo_version") if props.get("has_photo") else None
        if now != operation.version:
            done.refuse(change, "Their photo has been changed in the app since, so it's kept.")
            continue
        if operation.display is None:
            stamp = await asyncio.to_thread(files.remove_photo, ctx.data_dir, operation.person)
            has_photo = False
        else:
            data = webp_bytes(operation.display)
            try:
                if data is None:
                    raise PhotoError("not a picture")
                processed = await asyncio.to_thread(process_photo, data, operation.crop)
            except PhotoError:
                done.refuse(change, "The photo in the copy can't be read, so it's left out.")
                continue
            stamp = await asyncio.to_thread(
                files.store_photo, ctx.data_dir, operation.person, data, processed
            )
            has_photo = True
        version = await write(
            ctx, partial(people_repo.set_photo, person_id=operation.person, has_photo=has_photo)
        )
        done.photos.append(
            {"person": operation.person, "had": now is not None, "stamp": stamp, "version": version}
        )


# --- The import --------------------------------------------------------------------------------


def _what_happened(change: ImportChange, carried: bool) -> str:
    if carried:
        return "Done."
    if change.removes:
        return "Not ticked: kept."
    return "Not ticked: left as it is in the tree."


def _report(plan: CopyPlan, done: _Done) -> bytes:
    """Each change and what happened to it; what was left out, and why."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(("Who", "What", "In the tree", "In the copy", "What happened"))
    for change in plan.changes:
        if change.id in done.refused_ids:
            continue
        what = change.column or change.detail or change.kind.replace("_", " ")
        row = (
            change.name,
            what,
            change.before or "",
            change.after or change.detail or "",
            _what_happened(change, change.id in done.carried),
        )
        writer.writerow(guard(cell) for cell in row)
    for item in [*plan.left_out, *done.refused]:
        writer.writerow(
            guard(cell) for cell in (item.column, item.written, "", "", f"Left out. {item.why}")
        )
    for look in [*plan.second_look, *done.notices]:
        writer.writerow(
            guard(cell) for cell in ("", "", "", "", f"Worth a second look: {look.message}")
        )
    return buffer.getvalue().encode(ENCODING)


def _brought(returned: Returned, plan: CopyPlan, done: _Done, import_id: str) -> dict[str, Any]:
    """The family as the file had it: what the next file from this copy is compared with."""
    return {
        "family": {
            "people": [
                person.model_dump(mode="json", exclude_none=True)
                for person in returned.people.values()
            ],
            "links": [link.model_dump(mode="json") for link in returned.links.values()],
        },
        "stories": {pid: story.model_dump() for pid, story in returned.stories.items()},
        "ids": {**plan.ids, **done.placeholder_ids},
        "saved_at": returned.saved_at.isoformat() if returned.saved_at else None,
        "brought_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "import_id": import_id,
    }


def _label(for_name: str) -> str:
    return f"Changes from {for_name}'s copy"


@dataclass(frozen=True)
class _Brought:
    """What bringing changes in did, and where it's kept."""

    plan: CopyPlan
    done: _Done
    backup: str
    import_id: str
    folder: Path
    at: datetime
    tag: str

    def left_out(self) -> list[ImportLeftOut]:
        return [*self.plan.left_out, *self.done.refused]

    def record(self) -> dict[str, Any]:
        """The record's part every import from a copy or a computer keeps alike."""
        done = self.done
        return {
            "format": 1,
            "id": self.import_id,
            "tag": self.tag,
            "imported_at": self.at.isoformat(timespec="seconds"),
            "backup": self.backup,
            "people": done.created,
            "placeholders": done.placeholders,
            "links": len(done.link_ids),
            "link_ids": done.link_ids,
            "changed": done.changed,
            "relinked": done.relinked,
            "unlinked": done.unlinked,
            "orphans": done.orphans,
            "filled": done.filled,
            "removed": done.removing,
            "stories": done.stories,
            "photos": done.photos,
            "left_out": [item.model_dump(mode="json") for item in self.left_out()],
            "second_look": [
                item.model_dump(mode="json") for item in [*self.plan.second_look, *done.notices]
            ],
            "differences": [],
            "taken_back_at": None,
        }

    def done_view(self, label: str) -> ImportDone:
        done = self.done
        return ImportDone(
            id=self.import_id,
            label=label,
            people=len(done.created),
            links=len(done.link_ids),
            changed=len(done.changed) + len(done.relinked) + len(done.unlinked) + len(done.filled),
            removed=len(done.removing),
            stories=len(done.stories),
            photos=len(done.photos),
            left_out=len(self.left_out()),
            backup=self.backup,
        )


async def _bring_in(
    ctx: Context,
    history: History,
    compared: _Compared,
    chosen: Collection[str] | None,
    *,
    label: str,
    prefix: str,
    nothing_new: str,
    sent_by: dict[str, str] | None = None,
) -> _Brought:
    """What's chosen (None: what's ticked to begin with): a backup first, then the people,
    details and links as one Undo step, the removals last; then stories and photos."""
    plan, returned = compared.plan, compared.returned
    if not plan.changes:
        raise RuleError("nothing_to_import", nothing_new)
    carried = plan.carried_out(chosen)
    if not carried:
        raise RuleError("nothing_chosen", "Nothing is ticked, so there's nothing to bring in.")
    backup = await exports.make_export(ctx, ExportFormat.ARCHIVE)
    now = datetime.now().astimezone()
    import_id, folder = await asyncio.to_thread(storage.new_import_folder, ctx.data_dir, now)
    tag = f"{prefix}{import_id}"
    people, links = plan.reached(carried)
    try:
        async with history.change(ctx, people, links) as change:
            done = await write(ctx, lambda tx: _carry_out(tx, plan, carried, tag))
            change.people.update([*done.created, *done.placeholders])
            change.removing = done.removing
            change.label = label
            change.sent_by = sent_by
    except BaseException:
        await asyncio.to_thread(storage.remove_folder, folder)
        raise
    await _stories(ctx, plan, done, returned)
    await _photos(ctx, plan, done)
    await refresh_snapshots(ctx, done.touched())
    return _Brought(plan, done, backup.name, import_id, folder, now, tag)


async def run_copy(
    ctx: Context,
    history: History,
    data: bytes,
    file_name: str,
    password: str | None,
    answers: Mapping[str, str],
    chosen: Collection[str] | None = None,
) -> ImportDone:
    """Bring in what's chosen (None: what's ticked to begin with): a backup first, then the
    people, details and links as one Undo step, the removals last; then stories and photos."""
    compared = await _compare(ctx, data, password, answers)
    returned = compared.returned
    for_name = str(compared.about["for"])
    brought = await _bring_in(
        ctx,
        history,
        compared,
        chosen,
        label=_label(for_name),
        prefix=TAG,
        nothing_new=f"There's nothing new in this copy: everything {for_name} changed is in the "
        "tree, or was brought in before.",
    )
    plan, done = brought.plan, brought.done
    base = copies_storage.read_brought(ctx.data_dir, returned.copy_id)
    record = brought.record() | {
        "kind": "copy",
        "file_name": file_name,
        "copy_id": returned.copy_id,
        "for": for_name,
        "title": compared.about.get("title") or "",
        "saved_at": returned.saved_at.isoformat() if returned.saved_at else None,
    }
    was = gzip.compress(json.dumps(base).encode("utf-8"), mtime=0)
    await asyncio.to_thread(
        storage.save_copy_import, brought.folder, record, data, _report(plan, done), was
    )
    await asyncio.to_thread(
        copies_storage.keep_brought,
        ctx.data_dir,
        returned.copy_id,
        _brought(returned, plan, done, brought.import_id),
    )
    return brought.done_view(_label(for_name))


@dataclass(frozen=True)
class SentDone:
    """What bringing in a computer's changes did, and what wasn't taken, in words, for
    the keeper's answer to it."""

    done: ImportDone
    left_out: list[str]


def _not_taken(brought: _Brought) -> list[str]:
    """What wasn't taken, as the review named it: unticked, refused by the rules, or left out."""
    plan, done = brought.plan, brought.done
    words = [
        f"{change.name}: {change.column or change.detail or change.kind.replace('_', ' ')}"
        for change in plan.changes
        if change.id not in done.carried and change.id not in done.refused_ids
    ]
    words += [f"{item.column}: {item.written}. {item.why}" for item in brought.left_out()]
    return words


async def run_sent(
    ctx: Context,
    history: History,
    sent: Sent,
    answers: Mapping[str, str],
    chosen: Collection[str] | None = None,
) -> SentDone:
    """Bring in what's chosen of what a relative's computer sent, as from a copy: a
    backup first, one Undo step, then stories and photos; kept for Take back."""
    compared = await _compare_sent(ctx, sent, answers)
    label = f"Changes from {sent.computer}"
    brought = await _bring_in(
        ctx,
        history,
        compared,
        chosen,
        label=label,
        prefix=SENT_TAG,
        nothing_new=f"There's nothing new from {sent.computer}: everything it changed is in the "
        "tree already.",
        sent_by={
            "computer": sent.computer,
            "email": sent.email,
            "sent": sent.sent_at.isoformat(timespec="seconds"),
        },
    )
    record = brought.record() | {
        "kind": "folder",
        "file_name": sent.computer,
        "device": sent.device,
        "proposal": sent.proposal,
        "for": sent.computer,
        "email": sent.email,
        "sent_at": sent.sent_at.isoformat(),
    }
    was = gzip.compress(
        json.dumps(
            {"people": sent.base.people, "links": sent.base.links, "stories": sent.base.stories}
        ).encode("utf-8"),
        mtime=0,
    )
    await asyncio.to_thread(
        storage.save_sent_import,
        brought.folder,
        record,
        sent.packed,
        _report(brought.plan, brought.done),
        was,
    )
    return SentDone(brought.done_view(label), _not_taken(brought))


def everything_left(plan: CopyPlan) -> list[str]:
    """Everything a computer sent, in words: what isn't taken when it's turned down."""
    words = [
        f"{change.name}: {change.column or change.detail or change.kind.replace('_', ' ')}"
        for change in plan.changes
    ]
    return words + [f"{item.column}: {item.written}. {item.why}" for item in plan.left_out]


async def plan_sent(ctx: Context, sent: Sent) -> CopyPlan:
    """What a computer sent, compared, with no answers yet: for turning it down, and for a
    trusted computer's changes."""
    return (await _compare_sent(ctx, sent, {})).plan


# --- Take back ---------------------------------------------------------------------------------


async def _relink_back(ctx: Context, relinked: list[Mapping[str, Any]]) -> tuple[int, int]:
    """Links it changed, as they were, while they're as it left them: (put back, kept)."""
    put_back = kept = 0
    for item in relinked:

        async def work(tx: Tx, item: Mapping[str, Any] = item) -> bool:
            link = await links_repo.fetch_link(tx, str(item["link"]))
            if link is None:
                return False
            if link["type"] == "SPOUSE_OF":
                if link["props"].get("status") != item["after"].get("status"):
                    return False
                await links_repo.update_link(
                    tx, str(item["link"]), {"status": item["before"].get("status")}
                )
                return True
            ends = (
                (item["target"], item["source"])
                if item["swap"]
                else (item["source"], item["target"])
            )
            kind = str(link["props"].get("kind") or BIOLOGICAL)
            if (link["source"], link["target"]) != ends or kind != item["after"].get("kind"):
                return False
            # Out, and back as it was through the rules; refused, it stays as it is.
            await links_repo.delete_link(tx, str(item["link"]))
            people = await people_repo.fetch_people(tx, [item["source"], item["target"]])
            kinds = await kinds_repo.fetch_kinds(tx)
            was = str(item["before"].get("kind") or BIOLOGICAL)
            try:
                await add_parent(
                    tx,
                    item["source"],
                    item["target"],
                    was,
                    kinds,
                    people,
                    link_id=str(item["link"]),
                    allow_hidden=True,
                )
            except RuleError:
                await links_repo.create_parent_link(tx, str(item["link"]), *ends, kind)
                return False
            return True

        if await write(ctx, work):
            put_back += 1
        else:
            kept += 1
    return put_back, kept


async def _link_back(ctx: Context, link: Mapping[str, Any]) -> bool:
    """A link it took out, made again through the rules, if both ends are still here."""

    async def work(tx: Tx) -> bool:
        people = await people_repo.fetch_people(tx, [link["source"], link["target"]])
        if len(people) != 2 or await links_repo.fetch_link(tx, str(link["id"])) is not None:
            return False
        try:
            if link["type"] == "SPOUSE_OF":
                if await links_repo.links_between(tx, link["source"], link["target"]):
                    return False
                await links_repo.create_spouse_link(
                    tx,
                    str(link["id"]),
                    link["source"],
                    link["target"],
                    str(link["props"].get("status") or SpouseStatus.MARRIED.value),
                )
            else:
                kinds = await kinds_repo.fetch_kinds(tx)
                await add_parent(
                    tx,
                    link["source"],
                    link["target"],
                    str(link["props"].get("kind") or BIOLOGICAL),
                    kinds,
                    people,
                    link_id=str(link["id"]),
                    allow_hidden=True,
                )
        except RuleError:
            return False
        return True

    return await write(ctx, work)


async def _unknown_back(ctx: Context, props: Mapping[str, Any]) -> None:
    """An unknown parent it took out, back, while no one has their id."""

    async def work(tx: Tx) -> None:
        if await people_repo.fetch_person(tx, str(props["id"])) is None:
            kept = {k: v for k, v in props.items() if k not in ("created_at", "updated_at")}
            await people_repo.create_person(tx, kept)

    await write(ctx, work)


async def _put_back_details(ctx: Context, changed: list[Mapping[str, Any]]) -> tuple[int, int]:
    """Details it changed, as they were, unless changed again since: (put back, kept)."""
    if not changed:
        return 0, 0

    async def work(tx: Tx) -> tuple[int, int]:
        keys = {key for item in changed for key in item["after"]}
        now = await history_repo.properties(tx, {str(item["person"]) for item in changed}, keys)
        put_back = kept = 0
        for item in changed:
            current = now.get(str(item["person"]))
            if current is None:
                continue
            if all(current.get(key) == value for key, value in item["after"].items()):
                await people_repo.update_person(tx, str(item["person"]), dict(item["before"]))
                put_back += 1
            else:
                kept += 1
        return put_back, kept

    return await write(ctx, work)


def _story_back(ctx: Context, item: Mapping[str, Any]) -> bool:
    now = stories_storage.read_story(ctx.data_dir, str(item["person"]))
    if (now or "") != (item["after"] or ""):
        return False  # changed again since
    stories_storage.write_story(ctx.data_dir, str(item["person"]), item["before"] or "")
    return True


async def _photo_back(ctx: Context, item: Mapping[str, Any]) -> bool:
    pid = str(item["person"])
    props = await read(ctx, lambda tx: people_repo.fetch_person(tx, pid))
    if props is None or props.get("photo_version") != item["version"]:
        return False  # changed again since, or gone
    stamp = item.get("stamp")
    previous = (
        await asyncio.to_thread(files.previous_photo, ctx.data_dir, pid, stamp) if stamp else None
    )
    if item["had"] and previous is None:
        return False  # the photo before has gone from previous/
    if previous is None:
        await asyncio.to_thread(files.remove_photo, ctx.data_dir, pid)
        has_photo = False
    else:
        original, crop = previous
        processed = await asyncio.to_thread(process_photo, original, crop)
        await asyncio.to_thread(files.store_photo, ctx.data_dir, pid, original, processed)
        has_photo = True
    await write(ctx, lambda tx: people_repo.set_photo(tx, pid, has_photo=has_photo))
    return True


async def take_back_copy(
    ctx: Context, history: History, record: Mapping[str, Any]
) -> ImportTakenBack:
    """Undo changes brought in from a copy, as far as they still can be: whoever it added goes
    to the Trash, links and all; the links it made go; the links it changed or took out, the
    unknown parents it filled in, the details and birth orders it changed, the stories and
    photos, all go back as they were, unless changed again since; and whoever it removed comes
    back from the Trash. The next file from the same copy is then compared as before it."""
    people = [str(pid) for pid in record["people"]]
    async with history.lock:
        present = await read(ctx, lambda tx: imports_repo.people_present(tx, people))
        for pid in people:
            if pid in present:
                await people_service.delete_person(ctx, UUID(pid))

        async def unlink(tx: Tx) -> None:
            links = await history_repo.links_by_id(tx, [str(lid) for lid in record["link_ids"]])
            await history_repo.delete_links(tx, list(links))
            for pid in record.get("placeholders", []):
                if not await people_repo.fetch_links_of(tx, str(pid)):
                    await people_repo.delete_person(tx, str(pid))

        await write(ctx, unlink)
        links = 0
        for filled in record.get("filled", []):
            await _unknown_back(ctx, filled["placeholder"])
            for link in filled["links"]:
                links += await _link_back(ctx, link)
        for orphan in record.get("orphans", []):
            await _unknown_back(ctx, orphan)
        for link in record.get("unlinked", []):
            links += await _link_back(ctx, link)
        relinked, relink_kept = await _relink_back(ctx, record.get("relinked", []))
        put_back, kept = await _put_back_details(ctx, record.get("changed", []))
        restored = await people_service.bring_back(
            ctx, [str(pid) for pid in record.get("removed", [])]
        )
        stories = 0
        for item in reversed(record.get("stories", [])):
            async with folder_lock(str(item["person"])):
                stories += await asyncio.to_thread(_story_back, ctx, item)
        photos = 0
        for item in reversed(record.get("photos", [])):
            photos += await _photo_back(ctx, item)
        history.clear()  # steps before it may name what changed: none can be undone now
    touched = {*present, *(str(item["person"]) for item in record.get("changed", []))}
    await refresh_snapshots(ctx, touched - set(people))
    return ImportTakenBack(
        moved=len(present),
        gone=len(people) - len(present),
        restored=restored,
        reverted=put_back,
        kept=kept + relink_kept,
        links=links + relinked,
        stories=stories,
        photos=photos,
    )


def restore_base(ctx: Context, record: Mapping[str, Any]) -> None:
    """After Take back, the next file from this copy is compared as before the import, if no
    other import from it has come since."""
    copy_id = str(record["copy_id"])
    brought = copies_storage.read_brought(ctx.data_dir, copy_id)
    if brought is None or brought.get("import_id") != record["id"]:
        return
    saved = storage.import_base(ctx.data_dir, str(record["id"]))
    was = json.loads(gzip.decompress(saved)) if saved else None
    copies_storage.keep_brought(ctx.data_dir, copy_id, was)
