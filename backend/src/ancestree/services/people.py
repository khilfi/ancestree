"""People: create, edit, find, order children, and delete to (and restore from) the Trash."""

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid7

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.person import Gender, PartialDate, Place
from ancestree.domain.relationship import BIOLOGICAL
from ancestree.domain.requests import FillIn, NewRelative, PersonInput, PersonPatch
from ancestree.domain.search import find_people
from ancestree.domain.views import (
    Notice,
    PersonDetail,
    PersonSaved,
    PersonSummary,
    RelativeAdded,
    RestoreResult,
    TrashEntry,
)
from ancestree.repo import kinds as kinds_repo
from ancestree.repo import links as links_repo
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import date_props, editable_props, place_props
from ancestree.services.context import (
    Context,
    NotFoundError,
    RuleError,
    folder_lock,
    read,
    write,
)
from ancestree.services.detail import districted, load_detail, summary
from ancestree.services.families import by_blood, family_key
from ancestree.services.placing import placed, share_location
from ancestree.services.relationships import (
    Linked,
    connect,
    parent_refused,
    spouse_refused,
)
from ancestree.services.rules import Facts, life_notices, parent_child_notices
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage.files import (
    TRASH_DAYS,
    TrashItem,
    list_trash,
    move_to_trash,
    read_trash_item,
    take_out_of_trash,
)
from ancestree.storage.settings import read_kinship_settings


async def get_person(ctx: Context, person_id: UUID) -> PersonDetail:
    """A person, as the app shows them: where they live said to the district too, as
    written, or as the gazetteer has it; at their parents' too."""
    language = await kinship_language(ctx)
    detail = await read(ctx, lambda tx: load_detail(tx, str(person_id), language))
    return await asyncio.to_thread(districted, detail)


async def kinship_language(ctx: Context) -> str:
    """The language of the Relatives tab's labels: the kinship language chosen."""
    return (await asyncio.to_thread(read_kinship_settings, ctx.data_dir)).language


async def search(ctx: Context, text: str, limit: int) -> list[PersonSummary]:
    """By name or nickname, the same way a view-only copy searches (domain/search.py)."""
    rows = await read(ctx, people_repo.searchable)
    return [summary(row) for row in find_people(rows, text, limit)]


async def create_person(ctx: Context, data: PersonInput, mates: Sequence[str] = ()) -> PersonSaved:
    """Someone new; each place with an address given its location, and where they live shared
    with `mates`, the others at that address."""
    person_id = str(uuid7())
    language = await kinship_language(ctx)
    data = await asyncio.to_thread(placed, data)

    async def work(tx: Tx) -> tuple[PersonDetail, list[dict[str, Any]]]:
        namesakes = await people_repo.find_by_name(tx, data.full_name)
        props = _new_person_props(person_id, data)
        if mates and data.residence is not None:
            home = await share_location(tx, data.residence, mates)
            props |= place_props("residence", home)
        await people_repo.create_person(tx, props)
        return await load_detail(tx, person_id, language), namesakes

    detail, namesakes = await write(ctx, work)
    await refresh_snapshots(ctx, [person_id, *mates])
    notices = life_notices(_facts(detail)) + _namesake_notices(data, namesakes, detail.id)
    return PersonSaved(person=detail, notices=notices)


async def update_person(
    ctx: Context, person_id: UUID, data: PersonInput, mates: Sequence[str] = ()
) -> PersonSaved:
    data = await asyncio.to_thread(placed, data)
    return await _save(ctx, person_id, editable_props(data), mates, data.residence)


async def patch_person(
    ctx: Context, person_id: UUID, patch: PersonPatch, mates: Sequence[str] = ()
) -> PersonSaved:
    """A quick fix from What's missing: only what's given changes."""
    patch = await asyncio.to_thread(placed, patch)
    props: dict[str, Any] = {}
    changes = patch.changes()
    if "gender" in changes and patch.gender is not None:
        props["gender"] = patch.gender.value
    if "birth_date" in changes:
        props |= date_props("birth", patch.birth_date)
    if "residence" in changes:
        props |= place_props("residence", patch.residence)
    if "birth_place" in changes:
        props |= place_props("birth", patch.birth_place)
    if "death_place" in changes:
        props |= place_props("death", patch.death_place)
    home = patch.residence if "residence" in changes else None
    return await _save(ctx, person_id, props, mates, home)


async def _save(
    ctx: Context,
    person_id: UUID,
    props: dict[str, Any],
    mates: Sequence[str] = (),
    residence: Place | None = None,
) -> PersonSaved:
    """Write these properties; answer with the person as they are now, and what's worth a
    second look (an unlikely age gap, say). Where they live, given, is shared with `mates`, the
    others at that address."""
    pid = str(person_id)
    language = await kinship_language(ctx)

    async def work(tx: Tx) -> tuple[PersonDetail, list[Notice]]:
        written = props
        if mates and residence is not None:
            home = await share_location(tx, residence, mates)
            written = props | place_props("residence", home)
        if not await people_repo.update_person(tx, pid, written):
            raise NotFoundError("That person isn't in the tree.")
        detail = await load_detail(tx, pid, language)
        kinds = await kinds_repo.fetch_kinds(tx)
        me = _facts(detail)
        notices = life_notices(me)
        for parent in detail.parents:
            if not parent.placeholder:
                blood = parent.kind in kinds and kinds[parent.kind or ""].blood
                notices += parent_child_notices(_facts(parent), me, blood=blood)
        for group in detail.child_groups:
            for child in group.children:
                blood = child.kind in kinds and kinds[child.kind or ""].blood
                notices += parent_child_notices(me, _facts(child), blood=blood)
        return detail, notices

    detail, notices = await write(ctx, work)
    await refresh_snapshots(ctx, [pid, *mates])
    return PersonSaved(person=detail, notices=notices)


async def add_relative(ctx: Context, person_id: UUID, request: NewRelative) -> RelativeAdded:
    """Create someone already linked; if a link is refused, nobody is created."""
    anchor, new_id = str(person_id), str(uuid7())
    language = await kinship_language(ctx)
    person = await asyncio.to_thread(placed, request.person)

    async def work(tx: Tx) -> tuple[Linked, list[dict[str, Any]], PersonDetail]:
        if await people_repo.fetch_person(tx, anchor) is None:
            raise NotFoundError("That person isn't in the tree.")
        namesakes = await people_repo.find_by_name(tx, request.person.full_name)
        await people_repo.create_person(tx, _new_person_props(new_id, person))
        shared = None
        if request.relation == "sibling":
            # A new brother or sister shares the birth parents already recorded, if any.
            kinds = await kinds_repo.fetch_kinds(tx)
            shared = list(by_blood(await links_repo.parent_ids(tx, anchor), kinds)) or None
        linked = await connect(
            tx, new_id, anchor, request.relation, kind=request.kind, shared_parents=shared
        )
        if request.relation == "child" and request.other_parent is not None:
            linked.add(
                await connect(tx, new_id, str(request.other_parent), "child", kind=request.kind)
            )
        return linked, namesakes, await load_detail(tx, new_id, language)

    linked, namesakes, detail = await write(ctx, work)
    await refresh_snapshots(ctx, linked.people | {new_id, anchor})
    notices = _namesake_notices(request.person, namesakes, UUID(new_id)) + linked.notices
    return RelativeAdded(person=detail, notices=notices, suggestions=linked.suggestions)


async def fill_in(ctx: Context, placeholder_id: UUID, request: FillIn) -> RelativeAdded:
    """An unknown parent becomes a real one; the children they joined stay together."""
    unknown, new_id = str(placeholder_id), str(uuid7())
    if request.person is not None:
        request = request.model_copy(
            update={"person": await asyncio.to_thread(placed, request.person)}
        )

    async def work(tx: Tx) -> tuple[Linked, str, list[dict[str, Any]]]:
        props = await people_repo.fetch_person(tx, unknown)
        if props is None:
            raise NotFoundError("That person isn't in the tree.")
        if not props.get("placeholder"):
            raise RuleError("not_unknown", "Only an unknown parent can be filled in.")
        children = [row["person"]["id"] for row in await people_repo.fetch_children(tx, unknown)]
        namesakes: list[dict[str, Any]] = []
        if request.person is not None:
            namesakes = await people_repo.find_by_name(tx, request.person.full_name)
            await people_repo.create_person(tx, _new_person_props(new_id, request.person))
            parent = new_id
        else:
            parent = str(request.existing)
            if await people_repo.fetch_person(tx, parent) is None:
                raise NotFoundError("That person isn't in the tree.")
        await people_repo.delete_person(tx, unknown)  # its links go with it
        linked = Linked()
        for child in children:
            linked.add(await connect(tx, parent, child, "parent"))
        return linked, parent, namesakes

    linked, parent, namesakes = await write(ctx, work)
    await refresh_snapshots(ctx, linked.people | {parent})
    notices = _namesake_notices(request.person, namesakes, UUID(parent)) if request.person else []
    return RelativeAdded(
        person=await get_person(ctx, UUID(parent)),
        notices=notices + linked.notices,
        suggestions=linked.suggestions,
    )


async def set_children_order(ctx: Context, person_id: UUID, child_ids: list[UUID]) -> PersonDetail:
    """Birth order for children of the same parents, eldest first."""
    pid, ids = str(person_id), [str(child) for child in child_ids]
    language = await kinship_language(ctx)

    async def work(tx: Tx) -> PersonDetail:
        kinds = await kinds_repo.fetch_kinds(tx)
        children = {row["person"]["id"]: row for row in await people_repo.fetch_children(tx, pid)}
        if len(set(ids)) != len(ids) or any(child not in children for child in ids):
            raise RuleError("not_children", "Those aren't all this person's children.")
        families = {family_key(children[child], pid, kinds) for child in ids}
        if len(families) != 1:
            raise RuleError(
                "mixed_families", "Only children of the same parents are ordered together."
            )
        family = families.pop()
        if family[0] is not None:
            # Birth order is one number per person, kept in their family by birth.
            raise RuleError(
                "not_by_birth",
                "Birth order is set among children by birth. Other children follow their "
                "birth dates.",
            )
        whole = {cid for cid, row in children.items() if family_key(row, pid, kinds) == family}
        if whole != set(ids):
            raise RuleError("incomplete_order", "Put every child of these parents in the order.")
        await people_repo.set_birth_orders(tx, {child: n for n, child in enumerate(ids, start=1)})
        return await load_detail(tx, pid, language)

    detail = await write(ctx, work)
    await refresh_snapshots(ctx, ids)
    return detail


async def delete_person(ctx: Context, person_id: UUID) -> TrashEntry:
    """Move someone to the Trash: their links go into a tombstone, their folder alongside. An
    unknown parent left linked to no one goes too, and comes back with whichever of their
    children comes back first: each child's tombstone holds their unknown parents."""
    pid = str(person_id)

    async def export(tx: Tx) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        props = await people_repo.fetch_person(tx, pid)
        if props is None:
            raise NotFoundError("That person isn't in the tree.")
        links = await people_repo.fetch_links_of(tx, pid)
        unknown = []
        for link in links:
            if link["type"] == "PARENT_OF" and link["target"] == pid:
                parent = await people_repo.fetch_person(tx, link["source"])
                if parent is not None and parent.get("placeholder"):
                    unknown.append(parent)
        return props, links, unknown

    async with folder_lock(pid):
        props, links, unknown = await read(ctx, export)
        tombstone = {
            "format": 1,
            "person": _plain(props),
            "links": [{**link, "props": _plain(link["props"])} for link in links],
            "unknown_parents": [_plain(parent) for parent in unknown],
        }
        entry = await asyncio.to_thread(move_to_trash, ctx.data_dir, pid, tombstone)

        async def remove(tx: Tx) -> set[str]:
            await people_repo.delete_person(tx, pid)
            alone = set()
            for parent in unknown:
                if not await people_repo.fetch_links_of(tx, parent["id"]):
                    await people_repo.delete_person(tx, parent["id"])
                    alone.add(str(parent["id"]))
            return alone

        try:
            gone = await write(ctx, remove)
        except BaseException:
            await asyncio.to_thread(take_out_of_trash, ctx.data_dir, entry, pid)
            raise
    await refresh_snapshots(
        ctx, {link[end] for link in links for end in ("source", "target")} - {pid} - gone
    )
    return _trash_entry(await asyncio.to_thread(read_trash_item, ctx.data_dir, entry))


async def trash(ctx: Context) -> list[TrashEntry]:
    return [_trash_entry(item) for item in await asyncio.to_thread(list_trash, ctx.data_dir)]


async def trash_entry(ctx: Context, entry: str) -> TrashEntry:
    try:
        return _trash_entry(await asyncio.to_thread(read_trash_item, ctx.data_dir, entry))
    except (KeyError, FileNotFoundError) as error:
        raise NotFoundError("That isn't in the Trash.") from error


@dataclass
class Back:
    """What came back with someone from the Trash: their links put back; those skipped, to
    someone no longer here or of a kind deleted since; and why each link the rules refuse was
    left out."""

    restored: int = 0
    skipped: int = 0
    left_out: list[str] = field(default_factory=list)
    ids: list[str] = field(default_factory=list)  # of those put back

    @property
    def whole(self) -> bool:
        return not self.skipped and not self.left_out


async def put_person_back(tx: Tx, tombstone: Mapping[str, Any]) -> None:
    """Someone from their Trash entry, as they were, without their links yet; and their
    unknown parents no longer in the tree, so those links come back too."""
    person = tombstone["person"]
    if await people_repo.fetch_person(tx, person["id"]) is not None:
        raise RuleError("already_restored", f"{person['full_name']} is already in the tree.")
    for parent in tombstone.get("unknown_parents", ()):
        if await people_repo.fetch_person(tx, parent["id"]) is None:
            await _create_as_was(tx, parent)
    await _create_as_was(tx, person)


async def _create_as_was(tx: Tx, kept: Mapping[str, Any]) -> None:
    props = dict(kept)
    created_at = props.pop("created_at", None)
    props.pop("updated_at", None)
    await tx.run(
        """
        CREATE (p:Person) SET p = $props,
            p.created_at = coalesce(datetime($created), datetime()), p.updated_at = datetime()
        """,
        props=props,
        created=created_at,
    )


async def put_links_back(tx: Tx, tombstone: Mapping[str, Any], *, checked: bool = True) -> Back:
    """Someone's links from their Trash entry, once they're back: each through the rules a new
    link keeps, and each as it was, a marriage's order and all. Not `checked`: put back
    as they were, for Undo to check once it's done the rest."""
    person = tombstone["person"]
    kinds = await kinds_repo.fetch_kinds(tx)
    back = Back()
    for link in tombstone["links"]:
        source, target = link["source"], link["target"]
        other = target if source == person["id"] else source
        kind = link["props"].get("kind") or BIOLOGICAL
        people = await people_repo.fetch_people(tx, [source, target])
        parent = link["type"] == "PARENT_OF"
        if other not in people or (parent and kind not in kinds):
            back.skipped += 1
            continue
        if not checked:
            refused = None
        elif parent:
            refused = await parent_refused(
                tx, source, target, blood=kinds[kind].blood, people=people
            )
        else:
            refused = await spouse_refused(tx, source, target, people)
        if refused is not None:
            name = people[other]["full_name"]
            back.left_out.append(
                f"{person['full_name']}'s link to {name} can't come back: {refused.message}"
            )
            continue
        await links_repo.put_back_link(tx, link["type"], source, target, dict(link["props"]))
        back.restored += 1
        back.ids.append(str(link["props"]["id"]))
    return back


async def restore(ctx: Context, entry: str, *, whole: bool = False) -> RestoreResult:
    """Someone back from the Trash, with every link the rules let back: one they refuse
    stays out, and is said. `whole`: all of it, or nothing, as Undo needs."""
    try:
        item = await asyncio.to_thread(read_trash_item, ctx.data_dir, entry)
    except (KeyError, FileNotFoundError) as error:
        raise NotFoundError("That isn't in the Trash.") from error
    pid = item.tombstone["person"]["id"]

    async def work(tx: Tx) -> Back:
        await put_person_back(tx, item.tombstone)
        back = await put_links_back(tx, item.tombstone)
        if whole and not back.whole:
            why = back.left_out[0] if back.left_out else "someone they were linked to is gone"
            raise RuleError("not_whole", why)
        return back

    async with folder_lock(pid):
        back = await write(ctx, work)
        await asyncio.to_thread(take_out_of_trash, ctx.data_dir, entry, pid)
    others = {link[end] for link in item.tombstone["links"] for end in ("source", "target")}
    await refresh_snapshots(ctx, others | {pid})
    detail = await get_person(ctx, UUID(pid))
    return RestoreResult(
        person=detail,
        restored_links=back.restored,
        skipped_links=back.skipped,
        left_out=back.left_out,
    )


@dataclass
class Brought:
    """People brought back from the Trash, and why each link the rules refused stayed out."""

    people: int = 0
    left_out: list[str] = field(default_factory=list)


async def bring_back(ctx: Context, person_ids: list[str]) -> Brought:
    """People moved to the Trash, back from it while they're still there: the latest entry of
    each, should they have been restored and removed again since. Each link through the rules,
    as from the Trash."""
    brought = Brought()
    if not person_ids:
        return brought
    entries = await trash(ctx)
    for pid in person_ids:
        entry = next((e.entry for e in entries if str(e.person_id) == pid), None)
        if entry is None:
            continue
        try:
            result = await restore(ctx, entry)
        except RuleError, NotFoundError:
            continue  # back already
        brought.people += 1
        brought.left_out += result.left_out
    return brought


def _new_person_props(person_id: str, data: PersonInput) -> dict[str, Any]:
    return {
        "id": person_id,
        **editable_props(data),
        "placeholder": False,
        "has_photo": False,
        "photo_version": 0,
    }


def _namesake_notices(
    data: PersonInput, namesakes: list[dict[str, Any]], saved: UUID
) -> list[Notice]:
    """Warn about a possible duplicate: same name, and no birth years that tell them apart.
    It names both, `saved` and the one already there, for Same person as...."""
    year = data.birth_date.year if data.birth_date else None
    for other in namesakes:
        other_year = other.get("birth_year")
        if year is None or other_year is None or year == other_year:
            born = f" (born {other_year})" if other_year else ""
            return [
                Notice(
                    code="possible_duplicate",
                    message=f"There's already a {other['full_name']}{born} in the tree.",
                    person=saved,
                    other=UUID(str(other["id"])),
                )
            ]
    return []


def _facts(person: PersonDetail | PersonSummary) -> Facts:
    if isinstance(person, PersonDetail):
        birth = person.birth_date.value if person.birth_date else None
        death = person.death_date.value if person.death_date else None
    else:
        birth = PartialDate(year=person.birth_year) if person.birth_year else None
        death = PartialDate(year=person.death_year) if person.death_year else None
    return Facts(name=person.full_name, gender=Gender(person.gender), birth=birth, death=death)


def _plain(props: Mapping[str, Any]) -> dict[str, Any]:
    """Neo4j values as JSON: temporal values become ISO 8601 text."""
    return {
        key: value.iso_format() if hasattr(value, "iso_format") else value
        for key, value in props.items()
    }


def _trash_entry(item: TrashItem) -> TrashEntry:
    person = item.tombstone["person"]
    return TrashEntry(
        entry=item.entry,
        person_id=UUID(person["id"]),
        full_name=person["full_name"],
        deleted_at=item.deleted_at,
        restore_until=item.deleted_at + timedelta(days=TRASH_DAYS),
        link_count=len(item.tombstone["links"]),
    )
