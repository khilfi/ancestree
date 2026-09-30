"""Linking people. "Siti is Ali's mother" becomes a stored link, rules checked first."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid7

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.person import Gender
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind, SpouseStatus
from ancestree.domain.requests import Relation, RelationshipCreate, RelationshipUpdate
from ancestree.domain.views import LinkView, Notice, RelationshipResult, Suggestion
from ancestree.repo import kinds as kinds_repo
from ancestree.repo import links as links_repo
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import date_from_props
from ancestree.services.context import Context, NotFoundError, RuleError, write
from ancestree.services.families import by_blood
from ancestree.services.rules import Facts, parent_child_notices
from ancestree.services.snapshots import refresh_snapshots

People = Mapping[str, Mapping[str, Any]]


@dataclass
class Linked:
    links: list[LinkView] = field(default_factory=list)
    notices: list[Notice] = field(default_factory=list)
    suggestions: list[Suggestion] = field(default_factory=list)

    def add(self, other: Linked) -> None:
        self.links += other.links
        self.notices += other.notices
        self.suggestions += [s for s in other.suggestions if s not in self.suggestions]

    @property
    def people(self) -> set[str]:
        return {str(pid) for link in self.links for pid in (link.source, link.target)}

    def result(self) -> RelationshipResult:
        return RelationshipResult(
            links=self.links, notices=self.notices, suggestions=self.suggestions
        )


async def create_relationship(ctx: Context, request: RelationshipCreate) -> RelationshipResult:
    a, b = str(request.person_a), str(request.person_b)
    shared = (
        [str(p) for p in request.shared_parents] if request.shared_parents is not None else None
    )

    async def work(tx: Tx) -> Linked:
        return await connect(
            tx, a, b, request.a_is, kind=request.kind, status=request.status, shared_parents=shared
        )

    linked = await write(ctx, work)
    await refresh_snapshots(ctx, linked.people | {a, b})
    return linked.result()


async def update_relationship(
    ctx: Context, link_id: UUID, request: RelationshipUpdate
) -> RelationshipResult:
    lid = str(link_id)

    async def work(tx: Tx) -> Linked:
        link = await links_repo.fetch_link(tx, lid)
        if link is None:
            raise NotFoundError("That link isn't in the tree.")
        if link["type"] == "SPOUSE_OF":
            if request.kind is not None or request.swap:
                raise RuleError("not_parent_link", "Only parent links have a kind or a direction.")
            status = request.status or SpouseStatus(link["props"].get("status") or "married")
            await links_repo.update_link(tx, lid, {"status": status.value})
            view = LinkView(
                id=link_id,
                type="spouse",
                source=UUID(link["source"]),
                target=UUID(link["target"]),
                kind=None,
                status=status,
            )
            return Linked([view])
        if request.status is not None:
            raise RuleError("not_a_marriage", "Only marriages have a status.")
        parent, child = link["source"], link["target"]
        if request.swap:
            parent, child = child, parent
        current = link["props"].get("kind") or BIOLOGICAL
        kind = request.kind or current
        # Remove, then add back through the same checks, so the rules see the change.
        await links_repo.delete_link(tx, lid)
        people = await people_repo.fetch_people(tx, [parent, child])
        kinds = await kinds_repo.fetch_kinds(tx)
        return await add_parent(
            tx, parent, child, kind, kinds, people, link_id=lid, allow_hidden=kind == current
        )

    linked = await write(ctx, work)
    await refresh_snapshots(ctx, linked.people)
    return linked.result()


async def delete_relationship(ctx: Context, link_id: UUID) -> None:
    lid = str(link_id)

    async def work(tx: Tx) -> set[str]:
        link = await links_repo.fetch_link(tx, lid)
        if link is None:
            raise NotFoundError("That link isn't in the tree.")
        await links_repo.delete_link(tx, lid)
        affected = {link["source"], link["target"]}
        # An unknown parent with no one left to stand in for has no reason to exist.
        parent = await people_repo.fetch_person(tx, link["source"])
        orphaned = parent and parent.get("placeholder")
        if orphaned and not await people_repo.fetch_links_of(tx, link["source"]):
            await people_repo.delete_person(tx, link["source"])
            affected.discard(link["source"])
        return affected

    await refresh_snapshots(ctx, await write(ctx, work))


async def connect(
    tx: Tx,
    a: str,
    b: str,
    a_is: Relation,
    *,
    kind: str = BIOLOGICAL,
    status: SpouseStatus = SpouseStatus.MARRIED,
    shared_parents: list[str] | None = None,
) -> Linked:
    """Store "a is b's <a_is>" as parent or spouse links, or refuse with the reason."""
    if a == b:
        raise RuleError("self_link", "Someone can't be linked to themselves.")
    people = await people_repo.fetch_people(tx, [a, b])
    for person_id in (a, b):
        if person_id not in people:
            raise NotFoundError("That person isn't in the tree.")
        if people[person_id].get("placeholder"):
            raise RuleError(
                "placeholder",
                "An unknown parent only stands in for a missing parent; it can't be linked "
                "to anyone else.",
            )
    kinds = await kinds_repo.fetch_kinds(tx)
    match a_is:
        case "parent":
            return await add_parent(tx, a, b, kind, kinds, people)
        case "child":
            return await add_parent(tx, b, a, kind, kinds, people)
        case "spouse":
            return await add_spouse(tx, a, b, status, people)
        case "sibling":
            return await add_sibling(tx, a, b, shared_parents, kinds, people)


async def add_parent(
    tx: Tx,
    parent: str,
    child: str,
    kind: str,
    kinds: Mapping[str, RelationshipKind],
    people: People,
    *,
    link_id: str | None = None,
    allow_hidden: bool = False,
) -> Linked:
    definition = kinds.get(kind)
    if definition is None:
        raise RuleError("unknown_kind", f"There's no relationship kind called '{kind}'.")
    if not definition.active and not allow_hidden:
        raise RuleError(
            "hidden_kind", f"'{definition.label}' is hidden. Show it again in Settings to use it."
        )
    parent_name, child_name = people[parent]["full_name"], people[child]["full_name"]
    for existing in await links_repo.links_between(tx, parent, child):
        if existing["type"] == "PARENT_OF":
            raise RuleError(
                "already_linked", f"{parent_name} and {child_name} are already parent and child."
            )
        raise RuleError(
            "parent_and_spouse",
            f"{parent_name} and {child_name} are married, so one can't be the other's parent.",
        )
    if await links_repo.is_ancestor(tx, child, parent):
        raise RuleError(
            "cycle",
            f"{child_name} is already an ancestor of {parent_name}. This would make "
            f"{child_name} their own ancestor.",
        )
    if definition.blood:
        blood_parents = await links_repo.blood_parents(tx, child)
        if len(blood_parents) >= 2:
            names = " and ".join(row["name"] for row in blood_parents)
            raise RuleError(
                "third_parent",
                f"{child_name} already has two biological parents: {names}. "
                "Choose another kind, such as adoptive.",
            )

    link_id = link_id or str(uuid7())
    await links_repo.create_parent_link(tx, link_id, parent, child, kind)
    view = LinkView(
        id=UUID(link_id),
        type="parent",
        source=UUID(parent),
        target=UUID(child),
        kind=kind,
        status=None,
    )
    notices = parent_child_notices(
        _facts(people[parent]), _facts(people[child]), blood=definition.blood
    )
    return Linked([view], notices, await _marriage_suggestions(tx, child, kinds))


async def add_spouse(tx: Tx, a: str, b: str, status: SpouseStatus, people: People) -> Linked:
    a_name, b_name = people[a]["full_name"], people[b]["full_name"]
    for existing in await links_repo.links_between(tx, a, b):
        if existing["type"] == "SPOUSE_OF":
            raise RuleError("already_spouses", f"{a_name} and {b_name} are already spouses.")
        raise RuleError(
            "parent_and_spouse",
            f"One of {a_name} and {b_name} is the other's parent, so they can't be married.",
        )
    link_id = str(uuid7())
    await links_repo.create_spouse_link(tx, link_id, a, b, status.value)
    view = LinkView(
        id=UUID(link_id),
        type="spouse",
        source=UUID(a),
        target=UUID(b),
        kind=None,
        status=status,
    )
    return Linked([view])


async def add_sibling(
    tx: Tx,
    a: str,
    b: str,
    shared_parents: list[str] | None,
    kinds: Mapping[str, RelationshipKind],
    people: People,
) -> Linked:
    """Siblings are stored as shared birth parents, so every blood relation stays computable.

    (A foster or adopted brother is recorded as a foster or adopted child of the parents.)
    """
    parents_a = by_blood(await links_repo.parent_ids(tx, a), kinds)
    parents_b = by_blood(await links_repo.parent_ids(tx, b), kinds)
    a_name, b_name = people[a]["full_name"], people[b]["full_name"]

    if shared_parents is None:
        if set(parents_a) & set(parents_b):
            raise RuleError("already_siblings", f"{a_name} and {b_name} already share a parent.")
        if not parents_a and not parents_b:
            return await _join_under_unknown_parent(tx, a, b)
        candidates = await people_repo.fetch_people(tx, sorted({*parents_a, *parents_b}))
        raise RuleError(
            "choose_shared_parents",
            f"Which parents do {a_name} and {b_name} share?",
            candidates=[
                {
                    "id": pid,
                    "full_name": person["full_name"],
                    "parent_of": a if pid in parents_a else b,
                }
                for pid, person in candidates.items()
            ],
        )
    if not shared_parents:
        raise RuleError("no_shared_parents", "Pick at least one parent they share.")

    everyone = {**people, **await people_repo.fetch_people(tx, shared_parents)}
    linked = Linked()
    for parent in shared_parents:
        if parent in parents_a and parent in parents_b:
            continue
        if parent in parents_a:
            child, kind = b, parents_a[parent]
        elif parent in parents_b:
            child, kind = a, parents_b[parent]
        else:
            name = everyone.get(parent, {}).get("full_name", "That person")
            raise RuleError("not_a_parent", f"{name} isn't a parent of {a_name} or {b_name}.")
        linked.add(await add_parent(tx, parent, child, kind, kinds, everyone, allow_hidden=True))
    return linked


async def _join_under_unknown_parent(tx: Tx, a: str, b: str) -> Linked:
    placeholder = str(uuid7())
    await people_repo.create_person(
        tx,
        {
            "id": placeholder,
            "full_name": "Unknown parent",
            "gender": Gender.UNKNOWN.value,
            "placeholder": True,
            "has_photo": False,
            "photo_version": 0,
        },
    )
    linked = Linked()
    for child in (a, b):
        link_id = str(uuid7())
        await links_repo.create_parent_link(tx, link_id, placeholder, child, BIOLOGICAL)
        linked.links.append(
            LinkView(
                id=UUID(link_id),
                type="parent",
                source=UUID(placeholder),
                target=UUID(child),
                kind=BIOLOGICAL,
                status=None,
            )
        )
    return linked


async def _marriage_suggestions(
    tx: Tx, child: str, kinds: Mapping[str, RelationshipKind]
) -> list[Suggestion]:
    """A child with two birth parents who aren't recorded as married: ask whether they were."""
    parents = sorted(by_blood(await links_repo.parent_ids(tx, child), kinds))
    if len(parents) != 2:
        return []
    people = await people_repo.fetch_people(tx, parents)
    if any(person.get("placeholder") for person in people.values()):
        return []
    if any(link["type"] == "SPOUSE_OF" for link in await links_repo.links_between(tx, *parents)):
        return []
    first, second = (people[pid]["full_name"] for pid in parents)
    return [
        Suggestion(
            type="marry",
            person_a=UUID(parents[0]),
            person_b=UUID(parents[1]),
            message=f"Are {first} and {second} married?",
        )
    ]


def _facts(props: Mapping[str, Any]) -> Facts:
    return Facts(
        name=props["full_name"],
        gender=Gender(props.get("gender") or Gender.UNKNOWN),
        birth=date_from_props("birth", props),
        death=date_from_props("death", props),
    )
