"""What a relative's computer sends back: a three-way
comparison, first made for the copy to edit, which it outlived.

Pure: the family their changes were made on, what they sent, the tree now and your answers in;
the changes to review, and how to carry out each, out. Nothing here writes: every change is
carried out later through the app's own rules (services/returns.py).

- The family their changes were made on is the keeper's own record of it, never what was
  sent: the family folder's record as it was then (familyfolder/computers.py).
- What only they changed is offered, ticked. What the tree has changed too since, and
  differently, is a clash: the tree's stays unless you tick theirs. Whatever takes something
  out waits for its own tick.
- Someone new who looks like someone already in the tree is asked about, as a spreadsheet's
  rows are (importing/matching.py).
"""

from collections import defaultdict
from collections.abc import Collection, Container, Mapping
from dataclasses import dataclass
from itertools import pairwise
from typing import Any, Literal
from uuid import UUID

from pydantic import ValidationError

from ancestree.domain.imports import (
    ImportChange,
    ImportLeftOut,
    ImportOption,
    ImportQuestion,
    ImportSecondLook,
)
from ancestree.domain.person import Gender, PartialDate
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind, SpouseStatus
from ancestree.domain.requests import PersonInput
from ancestree.exchange.returned import Returned, ReturnedPerson
from ancestree.exchange.spreadsheet import VERSIONED, shown
from ancestree.importing.matching import Tree, dates_agree, name_key, skeleton
from ancestree.media.photos import Crop
from ancestree.repo.mapping import date_from_props, date_props, place_from, place_props
from ancestree.services.biography import join_sources, split_sources
from ancestree.storage.biography import pictures_in

type Props = dict[str, Any]

_DETAILS = {name: label for label, name in VERSIONED}  # "birth_date" -> "Born"
_MOST_OPTIONS = 8  # people offered for a look-alike, as for a spreadsheet's rows
_SKELETON_AT_LEAST = 6
_SPOUSE_WORDS = {
    SpouseStatus.MARRIED: "married to {}",
    SpouseStatus.DIVORCED: "formerly married to {}",
    SpouseStatus.WIDOWED: "married to {} (widowed)",
}
_EXCERPT = 160  # characters of a story shown in the review
_LAST = 10_000  # where someone with no birth order goes


# --- What goes in ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Base:
    """The family their changes were made on, from the keeper's own record: everyone, every
    link and the stories; and how their people are known here."""

    people: dict[str, Props]  # records by id (exchange/records.py)
    links: dict[str, Props]  # {id, type, source, target, kind, status, order} by id
    stories: dict[str, Props]  # {story, sources} by person
    ids: dict[str, str]  # their person id -> the tree's, where the two differ


@dataclass(frozen=True)
class TreeNow:
    """The tree as it is: everyone's properties (unknown parents too), every link, the kinds,
    and the stories of those whose story they may have changed (asked_stories)."""

    people: dict[str, Props]
    links: list[Props]  # {id, type ("parent" or "spouse"), source, target, kind, status}
    kinds: dict[str, RelationshipKind]
    stories: dict[str, str | None]


def asked_stories(base: Base, returned: Returned) -> set[str]:
    """Whose stories to read from the tree: those they may have changed, by tree id."""
    people = returned.stories.keys() | base.stories.keys()
    return {base.ids.get(pid, pid) for pid in people}


# --- What comes out ----------------------------------------------------------------------------


@dataclass(frozen=True)
class AddPerson:
    person: str  # their id in the tree to be: the one they have there
    props: Props  # all a new person holds


@dataclass(frozen=True)
class SetDetail:
    person: str
    field: str  # as in PersonInput
    props: Props  # the properties that hold it, as they'll be


@dataclass(frozen=True)
class AddLink:
    type: Literal["parent", "spouse"]
    a: str  # the parent, or a spouse
    b: str  # the child, or the other spouse
    kind: str
    status: SpouseStatus
    link: str  # their id for it, kept when it's free


@dataclass(frozen=True)
class Siblings:
    """Brothers and sisters joined under an unknown parent, as they did."""

    placeholder: str  # their id for the unknown parent, kept when it's free
    children: tuple[str, ...]
    links: tuple[str, ...]  # their ids for the links, in the same order


@dataclass(frozen=True)
class FillIn:
    placeholder: str  # the unknown parent, in the tree
    parent: str  # who fills them in
    children: tuple[str, ...]  # as they had them


@dataclass(frozen=True)
class Remove:
    person: str


@dataclass(frozen=True)
class Unlink:
    link: str  # in the tree


@dataclass(frozen=True)
class Relink:
    link: str  # in the tree
    kind: str | None  # a parent link's new kind; None: as it is
    status: SpouseStatus | None  # a marriage's new status; None: as it is
    swap: bool  # the parent becomes the child


@dataclass(frozen=True)
class Order:
    parents: frozenset[str]  # the birth parents they share, in the tree
    children: tuple[str, ...]  # eldest first


@dataclass(frozen=True)
class Story:
    person: str
    text: str  # biography.md as it'll be; "" takes the story out
    was: str | None  # the tree's biography.md when compared: if it's changed since, it stays
    pictures: dict[str, str]  # new pictures it shows: their name in the story -> the address


@dataclass(frozen=True)
class Photo:
    person: str
    display: str | None  # the photo, as a data: address; None takes the photo out
    crop: Crop | None
    avatar: str | None  # their small one, by its address: shown in the review
    version: int | None  # the tree's photo_version when compared: if it's changed since, stays


type Operation = (
    AddPerson | SetDetail | AddLink | Siblings | FillIn | Remove | Unlink | Relink | Order
    | Story | Photo
)  # fmt: skip


@dataclass
class ReturnedPlan:
    changes: list[ImportChange]
    questions: list[ImportQuestion]
    left_out: list[ImportLeftOut]
    second_look: list[ImportSecondLook]
    operations: dict[str, Operation]  # by change id
    ids: dict[str, str]  # their person id -> the tree's, where the two differ

    def carried_out(self, chosen: Collection[str] | None) -> set[str]:
        """The changes that happen when these are ticked (None: those ticked to begin with):
        each needs what it needs, and goes when something it needs is removed."""
        ticked = {c.id for c in self.changes if (c.ticked if chosen is None else c.id in chosen)}
        return {
            c.id
            for c in self.changes
            if c.id in ticked
            and all(need in ticked for need in c.needs)
            and not any(block in ticked for block in c.blocked_by)
        }

    def reached(self, done: Container[str]) -> tuple[set[str], set[str]]:
        """The people and links these changes touch, for the Undo step."""
        people: set[str] = set()
        links: set[str] = set()
        for change_id, operation in self.operations.items():
            if change_id not in done:
                continue
            match operation:
                case SetDetail(person=person):
                    people.add(person)
                case AddLink(a=a, b=b):
                    people |= {a, b}
                case Siblings(children=children):
                    people |= set(children)
                case FillIn(placeholder=placeholder, parent=parent, children=children):
                    people |= {placeholder, parent, *children}
                case Unlink(link=link) | Relink(link=link):
                    links.add(link)
                case Order(parents=parents, children=children):
                    people |= set(parents) | set(children)
                case _:
                    pass
        return people, links


# --- Details -----------------------------------------------------------------------------------


def _detail(props: Mapping[str, Any], name: str) -> object:
    """One detail as the app holds it: a PartialDate, a Place, a Gender, text or yes/no. An
    empty one is None. Raises ValueError for a date that isn't one."""
    if name in ("birth_date", "death_date"):
        return date_from_props(name.removesuffix("_date"), props)
    if name in ("birth_place", "death_place", "residence"):
        place = place_from(
            "residence" if name == "residence" else name.removesuffix("_place"), props
        )
        return None if place is None or place.is_empty else place
    if name == "gender":
        return Gender(props.get("gender") or Gender.UNKNOWN)
    if name == "living":
        return props.get("living")
    value = props.get(name)
    if not isinstance(value, str):
        return None
    return " ".join(value.split()) if name == "full_name" else value.strip() or None


def _detail_or_none(props: Mapping[str, Any], name: str) -> object:
    try:
        return _detail(props, name)
    except ValueError:
        return None


def _empty(value: object) -> bool:
    return value is None or value == "" or value == Gender.UNKNOWN


def detail_props(name: str, value: Any) -> Props:
    """A detail as the properties that hold it; an empty one clears them."""
    if name in ("birth_date", "death_date"):
        return date_props(name.removesuffix("_date"), value)
    if name in ("birth_place", "death_place"):
        return place_props(name.removesuffix("_place"), value)
    if name == "residence":
        return place_props("residence", value)
    if name == "gender":
        return {"gender": Gender(value or Gender.UNKNOWN).value}
    return {name: value}


def new_person_props(data: PersonInput) -> Props:
    """All a new person holds, from the details they sent, as the app's own create makes it."""
    props: Props = {
        "full_name": data.full_name,
        "nickname": data.nickname,
        "title": data.title,
        "name_jawi": data.name_jawi,
        "gender": data.gender.value,
        "burial_place": data.burial_place,
        "living": data.living,
        "occupation": data.occupation,
        "notes": data.notes,
        "placeholder": False,
        "has_photo": False,
        "photo_version": 0,
    }
    props |= date_props("birth", data.birth_date)
    props |= place_props("birth", data.birth_place)
    props |= date_props("death", data.death_date)
    props |= place_props("death", data.death_place)
    props |= place_props("residence", data.residence)
    return props


# --- Stories -----------------------------------------------------------------------------------


def _story_text(story: Mapping[str, Any] | None) -> str:
    """A story as biography.md holds it, whichever side it's from: "" for none."""
    if not story:
        return ""
    return join_sources(str(story.get("story") or ""), list(story.get("sources") or []))


def _file_text(text: str | None) -> str:
    """The tree's biography.md, written the way the app writes it, to compare like with like."""
    if not text:
        return ""
    story, sources = split_sources(text)
    return join_sources(story, sources)


def _excerpt(text: str) -> str:
    story, _ = split_sources(text)
    flat = " ".join(story.split())
    return flat if len(flat) <= _EXCERPT else flat[: _EXCERPT - 1].rstrip() + "…"


def _ranked(orders: list[Any]) -> bool:
    """Birth orders all recorded, each after the one before."""
    return all(order is not None for order in orders) and all(a < b for a, b in pairwise(orders))


def _in_order(people: Mapping[str, Props], them: list[str]) -> list[str]:
    """Brothers and sisters by the birth order they have there; those without it last."""
    return sorted(them, key=lambda pid: ((people.get(pid) or {}).get("birth_order") or _LAST, pid))


def _names(names: list[str]) -> str:
    if len(names) <= 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


# --- The comparison ----------------------------------------------------------------------------


class _Planner:
    def __init__(
        self, base: Base, returned: Returned, tree: TreeNow, answers: Mapping[str, str]
    ) -> None:
        self.base = base
        self.returned = returned
        self.tree = tree
        self.answers = answers
        self.ids = dict(base.ids)
        # Their links, the same shape as the base's: {id, type, source, target, kind, status}
        self.links: dict[str, Props] = {
            lid: link.model_dump(mode="json") for lid, link in returned.links.items()
        }
        self.changes: list[ImportChange] = []
        self.questions: list[ImportQuestion] = []
        self.left_out: list[ImportLeftOut] = []
        self.second_look: list[ImportSecondLook] = []
        self.operations: dict[str, Operation] = {}
        self.look = Tree(list(tree.people.values()), tree.links, tree.kinds)
        self.new: set[str] = set()  # their ids of people they add
        self.removing: set[str] = set()  # their ids of people they take out
        self.values: dict[str, dict[str, object]] = {}  # each returned person's details, read
        self.parent_links: dict[tuple[str, str], Props] = {}
        self.spouse_links: dict[frozenset[str], Props] = {}
        for link in tree.links:
            ends = (str(link["source"]), str(link["target"]))
            if link["type"] == "parent":
                self.parent_links[ends] = link
            else:
                self.spouse_links[frozenset(ends)] = link

    # --- Who is who ---

    def tid(self, pid: str) -> str:
        """Someone of theirs, by their id in the tree."""
        return self.ids.get(pid, pid)

    def name(self, pid: str) -> str:
        """Their name as sent; or as their changes started; or in the tree."""
        if (person := self.returned.people.get(pid)) is not None:
            return person.full_name
        if (record := self.base.people.get(pid)) is not None:
            return str(record["full_name"])
        props = self.tree.people.get(self.tid(pid))
        return str(props["full_name"]) if props else "someone"

    def gender(self, pid: str) -> Gender:
        if (person := self.returned.people.get(pid)) is not None:
            return person.gender
        props = self.tree.people.get(self.tid(pid)) or {}
        return Gender(props.get("gender") or Gender.UNKNOWN)

    def _eldest_first(self, pid: str) -> tuple[int, int, str]:
        person = self.returned.people.get(pid)
        if person is None:
            return (_LAST, _LAST, self.name(pid))
        return (person.birth_year or _LAST, person.birth_order or _LAST, person.full_name)

    def in_tree(self, pid: str) -> Props | None:
        return self.tree.people.get(self.tid(pid))

    def add(self, change: ImportChange, operation: Operation) -> None:
        self.changes.append(change)
        self.operations[change.id] = operation

    def leave_out(self, who: str, what: str, why: str) -> None:
        self.left_out.append(ImportLeftOut(row=None, column=who, written=what, why=why))

    def needs_of(self, *people: str) -> list[str]:
        return [f"add:{pid}" for pid in dict.fromkeys(people) if pid in self.new]

    def blocked_of(self, *people: str) -> list[str]:
        return [f"remove:{pid}" for pid in dict.fromkeys(people) if pid in self.removing]

    # --- People ---

    def _read(self, person: ReturnedPerson) -> None:
        """Their details as the app would take them; what it can't is left out."""
        props = person.model_dump(mode="json")
        values: dict[str, object] = {}
        for name, label in _DETAILS.items():
            try:
                values[name] = _detail(props, name)
            except ValueError:
                self.leave_out(
                    person.full_name,
                    label,
                    f"The {label.lower()} sent for them isn't one the app can read.",
                )
        try:
            PersonInput.model_validate({k: v for k, v in values.items() if v is not None})
        except ValidationError as error:
            for problem in error.errors():
                name = str(problem["loc"][0]) if problem["loc"] else ""
                if name in values:
                    self.leave_out(person.full_name, _DETAILS[name], f"Not kept: {problem['msg']}.")
                    del values[name]
        self.values[str(person.id)] = values

    def _look_alike(self, pid: str) -> str | None:
        """Someone new they sent may be someone already in the tree: ask, as an import does.
        Their id in the tree when you say they are, else None."""
        person = self.returned.people[pid]
        key = name_key(person.full_name)
        birth = self.values[pid].get("birth_date")
        born = birth if isinstance(birth, PartialDate) else None
        look = self.look
        exact = [p for p in look.by_key.get(key, []) if dates_agree(look.born[p], born)]
        near: list[str] = []
        if len(bones := skeleton(key)) >= _SKELETON_AT_LEAST:
            near = [
                p
                for p in look.by_skeleton.get(bones, [])
                if p not in exact and dates_agree(look.born[p], born)
            ]
        candidates = (exact + near)[:_MOST_OPTIONS]
        if not candidates:
            return None
        year = born.year if born is not None else None

        def born_in(p: str) -> int | None:
            date = look.born[p]
            return date.year if date is not None else None

        default = (
            f"person:{exact[0]}"
            if len(exact) == 1 and year and born_in(exact[0]) == year
            else "new"
        )
        options = [
            ImportOption(
                id=f"person:{p}",
                label=f"The same person: {look.name(p)}",
                detail=look.describe(p) or None,
            )
            for p in candidates
        ] + [ImportOption(id="new", label="Someone new")]
        qid = f"same:{pid}"
        chosen = self.answers.get(qid)
        answer = chosen if chosen in {option.id for option in options} else default
        alike = " or ".join(
            f"{look.name(p)} (b. {born_in(p)})" if born_in(p) else look.name(p)
            for p in candidates[:3]
        )
        self.questions.append(
            ImportQuestion(
                id=qid,
                row=None,
                column="Someone new",
                written=person.full_name + (f", b. {year}" if year else ""),
                kind="same_person",
                text=f"Looks like {alike}, already in the tree.",
                options=options,
                answer=answer,
            )
        )
        return answer.removeprefix("person:") if answer.startswith("person:") else None

    def _details(self, pid: str, now: Props, then: Props | None) -> None:
        """What they changed about someone in the tree, detail by detail. `then` is them as
        their changes started; None when they didn't start with them, so it can't say what they
        changed: then what they say differently waits for your tick, and blanks say nothing."""
        tid = self.tid(pid)
        values = self.values[pid]
        for detail, label in _DETAILS.items():
            if detail not in values:
                continue  # it couldn't be read: left out
            after = values[detail]
            tree = _detail_or_none(now, detail)
            before = _detail_or_none(then, detail) if then is not None else None
            if then is not None and after == before:
                continue  # unchanged there
            if then is None and _empty(after):
                continue  # a blank in someone it didn't start with says nothing
            if after == tree:
                continue  # the tree says so already
            if detail == "living" and after is None:
                continue  # worked out from the dates
            known = then is not None
            clash = known and tree != before
            self.add(
                ImportChange(
                    id=f"set:{tid}:{detail}",
                    kind="set",
                    row=None,
                    person=UUID(tid),
                    name=str(now["full_name"]),
                    column=label,
                    before=shown(tree),
                    after=shown(after),
                    clash=clash,
                    unsure=not known,
                    ticked=known and not clash,
                ),
                SetDetail(tid, detail, detail_props(detail, after)),
            )

    def _new_person(self, pid: str) -> None:
        values = self.values[pid]
        try:
            data = PersonInput.model_validate({k: v for k, v in values.items() if v is not None})
        except ValidationError:
            self.leave_out(self.name(pid), "", "Their name can't be read, so they're left out.")
            return
        self.new.add(pid)
        about = [
            f"b. {data.birth_date.year}" if data.birth_date and data.birth_date.year else "",
            shown(data.birth_place),
        ]
        self.add(
            ImportChange(
                id=f"add:{pid}",
                kind="add_person",
                row=None,
                name=data.full_name,
                detail=" · ".join(part for part in about if part) or None,
                ticked=True,
            ),
            AddPerson(pid, props={"id": pid, **new_person_props(data)}),
        )

    def _people(self) -> None:
        base, returned = self.base, self.returned
        for person in returned.people.values():
            if not person.placeholder:
                self._read(person)
        for pid in sorted(returned.people.keys() - base.people.keys()):
            if returned.people[pid].placeholder:
                continue  # an unknown parent comes with the links it stands for (_siblings)
            if self.in_tree(pid) is None and (same := self._look_alike(pid)) is not None:
                self.ids[pid] = same
            now = self.in_tree(pid)
            if now is None:
                self._new_person(pid)
            elif not now.get("placeholder"):
                # Someone their changes didn't start with, but the tree has.
                self._details(pid, now, None)
        for pid in sorted(returned.people.keys() & base.people.keys()):
            if returned.people[pid].placeholder:
                continue
            now = self.in_tree(pid)
            if now is not None:
                self._details(pid, now, base.people[pid])
            elif any(
                self.values[pid].get(d) != _detail_or_none(base.people[pid], d)
                for d in self.values[pid]
            ):
                self.leave_out(
                    self.name(pid),
                    "",
                    "Taken out of the tree since, so what was changed about them is left out.",
                )
        for pid in sorted(base.people.keys() - returned.people.keys()):
            if base.people[pid].get("placeholder"):
                continue  # an unknown parent goes with its links, or is filled in
            now = self.in_tree(pid)
            if now is None:
                continue  # gone from both
            self.removing.add(pid)
            tid = self.tid(pid)
            self.add(
                ImportChange(
                    id=f"remove:{pid}",
                    kind="remove_person",
                    row=None,
                    person=UUID(tid),
                    name=str(now["full_name"]),
                    detail=(self.look.describe(tid) or None) if tid in self.look.props else None,
                    removes=True,
                    ticked=False,
                ),
                Remove(tid),
            )

    # --- Links ---

    def _words(self, link_type: str, a: str, b: str, kind: str, status: SpouseStatus) -> str:
        """ "father of Siti", "married to Ali": from the first person's side."""
        other = self.name(b)
        if link_type == "spouse":
            return _SPOUSE_WORDS[status].format(other)
        definition = self.tree.kinds.get(kind)
        label = definition.parent_label.for_gender(self.gender(a)) if definition else "parent"
        return f"{label} of {other}"

    def _kind_label(self, kind: str | None) -> str:
        definition = self.tree.kinds.get(kind or BIOLOGICAL)
        return definition.label.lower() if definition else str(kind)

    def _tree_link(self, link_type: str, a: str, b: str) -> Props | None:
        if link_type == "parent":
            return self.parent_links.get((self.tid(a), self.tid(b)))
        return self.spouse_links.get(frozenset((self.tid(a), self.tid(b))))

    def _children_of(self, links: Mapping[str, Props], parent: str) -> list[Props]:
        return [
            link
            for link in links.values()
            if link["type"] == "parent" and str(link["source"]) == parent
        ]

    def _fill_ins(self) -> set[str]:
        """Unknown parents they filled in: gone from theirs, with a new parent standing where
        they stood for each of their children. Returns the links that stand for it."""
        base, returned = self.base, self.returned
        new_links = sorted(self.links.keys() - base.links.keys())
        used: set[str] = set()
        for placeholder in sorted(base.people.keys() - returned.people.keys()):
            if not base.people[placeholder].get("placeholder"):
                continue
            theirs = self._children_of(base.links, placeholder)
            children = [str(link["target"]) for link in theirs if link["target"] in returned.people]
            if not children:
                continue
            found: tuple[str, list[str]] | None = None
            for lid in new_links:
                link = self.links[lid]
                parent = str(link["source"])
                if link["type"] != "parent" or str(link["target"]) != children[0]:
                    continue
                if returned.people[parent].placeholder:
                    continue
                made = [
                    other
                    for other in new_links
                    if self.links[other]["type"] == "parent"
                    and str(self.links[other]["source"]) == parent
                    and str(self.links[other]["target"]) in children
                ]
                if {str(self.links[other]["target"]) for other in made} == set(children):
                    found = (parent, made)
                    break
            if found is None:
                continue
            parent, made = found
            used |= {str(link["id"]) for link in theirs} | set(made)
            who = _names([self.name(child) for child in children])
            now = self.in_tree(placeholder)
            if now is None or not now.get("placeholder"):
                self.leave_out(
                    self.name(parent),
                    "",
                    f"The unknown parent of {who} was filled in with them, but has been "
                    "filled in or taken out in the tree since.",
                )
                continue
            self.add(
                ImportChange(
                    id=f"fill:{placeholder}",
                    kind="fill_in",
                    row=None,
                    person=UUID(self.tid(placeholder)),
                    name=self.name(parent),
                    detail=f"fills in the unknown parent of {who}",
                    needs=self.needs_of(parent, *children),
                    blocked_by=self.blocked_of(parent),
                    ticked=True,
                ),
                FillIn(
                    self.tid(placeholder),
                    self.tid(parent),
                    tuple(self.tid(child) for child in children),
                ),
            )
        return used

    def _siblings(self) -> set[str]:
        """Brothers and sisters they joined under an unknown parent of their own. Returns
        the links that stand for it."""
        base, returned = self.base, self.returned
        used: set[str] = set()
        for placeholder in sorted(returned.people.keys() - base.people.keys()):
            if not returned.people[placeholder].placeholder:
                continue
            links = sorted(
                self._children_of(self.links, placeholder),
                key=lambda link: self._eldest_first(str(link["target"])),
            )
            used |= {str(link["id"]) for link in links}
            children = [str(link["target"]) for link in links]
            if len(children) < 2:
                continue
            genders = {self.gender(child) for child in children}
            one = genders.pop() if len(genders) == 1 else None
            what = {Gender.MALE: "brothers", Gender.FEMALE: "sisters"}.get(
                one or Gender.UNKNOWN, "brothers and sisters"
            )
            self.add(
                ImportChange(
                    id=f"siblings:{placeholder}",
                    kind="add_link",
                    row=None,
                    name=_names([self.name(child) for child in children]),
                    detail=f"{what}, their parents not known yet",
                    needs=self.needs_of(*children),
                    blocked_by=self.blocked_of(*children),
                    ticked=True,
                ),
                Siblings(
                    placeholder,
                    tuple(self.tid(child) for child in children),
                    tuple(str(link["id"]) for link in links),
                ),
            )
        return used

    def _links(self) -> None:
        base, returned = self.base, self.returned
        used = self._fill_ins() | self._siblings()
        gone = {
            pid
            for pid in base.people.keys() - returned.people.keys()
            if not base.people[pid].get("placeholder")
        }
        for lid in sorted(self.links.keys() | base.links.keys()):
            if lid in used:
                continue
            now, then = self.links.get(lid), base.links.get(lid)
            if now is not None and then is None:
                self._new_link(lid, now)
            elif now is None and then is not None:
                if {str(then["source"]), str(then["target"])} & gone:
                    continue  # goes with the person taken out
                self._gone_link(lid, then)
            elif now is not None and then is not None:
                self._changed_link(lid, now, then)

    def _new_link(self, lid: str, link: Props) -> None:
        a, b = str(link["source"]), str(link["target"])
        if self._tree_link(link["type"], a, b) is not None:
            return  # linked in the tree already
        kind = link.get("kind") or BIOLOGICAL
        status = SpouseStatus(link.get("status") or SpouseStatus.MARRIED)
        if link["type"] == "parent" and kind not in self.tree.kinds:
            self.leave_out(
                self.name(a),
                "",
                f"Linked to {self.name(b)} as '{kind}', a kind the app doesn't have here, so "
                "the link is left out.",
            )
            return
        kind = kind if link["type"] == "parent" else ""
        self.add(
            ImportChange(
                id=f"link:{lid}",
                kind="add_link",
                row=None,
                name=self.name(a),
                detail=self._words(link["type"], a, b, kind, status),
                needs=self.needs_of(a, b),
                blocked_by=self.blocked_of(a, b),
                ticked=True,
            ),
            AddLink(link["type"], self.tid(a), self.tid(b), kind, status, lid),
        )

    def _gone_link(self, lid: str, then: Props) -> None:
        a, b = str(then["source"]), str(then["target"])
        now = self._tree_link(str(then["type"]), a, b)
        if now is None:
            return  # gone from the tree already
        words = self._words(
            str(then["type"]),
            a,
            b,
            str(then.get("kind") or BIOLOGICAL),
            SpouseStatus(then.get("status") or SpouseStatus.MARRIED),
        )
        self.add(
            ImportChange(
                id=f"unlink:{lid}",
                kind="remove_link",
                row=None,
                name=self.name(a),
                detail=f"no longer {words}",
                removes=True,
                ticked=False,
            ),
            Unlink(str(now["id"])),
        )

    def _changed_link(self, lid: str, link: Props, then: Props) -> None:
        a, b = str(link["source"]), str(link["target"])
        was_a, was_b = str(then["source"]), str(then["target"])
        swap = link["type"] == "parent" and (a, b) == (was_b, was_a)
        if (a, b) != (was_a, was_b) and not swap:
            return  # a link is never moved to other people
        kind, was_kind = link.get("kind") or BIOLOGICAL, then.get("kind") or BIOLOGICAL
        status = SpouseStatus(link.get("status") or SpouseStatus.MARRIED)
        was_status = SpouseStatus(then.get("status") or SpouseStatus.MARRIED)
        if not swap and kind == was_kind and status == was_status:
            return
        now = self._tree_link(str(then["type"]), was_a, was_b)
        pair = f"{self.name(a)} and {self.name(b)}"
        if now is None:
            if swap and self._tree_link("parent", a, b) is not None:
                return  # turned round in the tree already
            self.leave_out(pair, "", "Their link was changed, but it's no longer in the tree.")
            return
        if swap:
            label = self._kind_label(kind)
            self.add(
                ImportChange(
                    id=f"relink:{lid}",
                    kind="change_link",
                    row=None,
                    name=pair,
                    column="Which is the parent",
                    before=f"{self.name(b)} is the parent ({label})",
                    after=f"{self.name(a)} is the parent ({label})",
                    ticked=True,
                ),
                Relink(str(now["id"]), None, None, swap=True),
            )
        elif link["type"] == "parent":
            tree_kind = now.get("kind") or BIOLOGICAL
            if kind == tree_kind:
                return
            if kind not in self.tree.kinds:
                self.leave_out(pair, "", f"'{kind}' isn't a kind the app has, so it's left out.")
                return
            clash = tree_kind != was_kind
            self.add(
                ImportChange(
                    id=f"relink:{lid}",
                    kind="change_link",
                    row=None,
                    name=pair,
                    column="Kind of link",
                    before=self._kind_label(tree_kind),
                    after=self._kind_label(kind),
                    clash=clash,
                    ticked=not clash,
                ),
                Relink(str(now["id"]), kind, None, swap=False),
            )
        else:
            tree_status = SpouseStatus(now.get("status") or SpouseStatus.MARRIED)
            if status == tree_status:
                return
            clash = tree_status != was_status
            self.add(
                ImportChange(
                    id=f"relink:{lid}",
                    kind="change_link",
                    row=None,
                    name=pair,
                    column="Marriage",
                    before=tree_status.value,
                    after=status.value,
                    clash=clash,
                    ticked=not clash,
                ),
                Relink(str(now["id"]), None, status, swap=False),
            )

    # --- Birth order ---

    def _blood_parents(self, links: Mapping[str, Props], child: str) -> frozenset[str]:
        found = set()
        for link in links.values():
            if link["type"] != "parent" or str(link["target"]) != child:
                continue
            definition = self.tree.kinds.get(link.get("kind") or BIOLOGICAL)
            if definition is not None and definition.blood:
                found.add(str(link["source"]))
        return frozenset(found)

    def _orders(self) -> None:
        """Brothers and sisters put in a new birth order: a change for each family."""
        base, returned = self.base, self.returned
        families: dict[frozenset[str], list[str]] = defaultdict(list)
        for pid, person in returned.people.items():
            if person.placeholder or person.birth_order is None:
                continue
            if person.birth_order == (base.people.get(pid) or {}).get("birth_order"):
                continue
            if parents := self._blood_parents(self.links, pid):
                families[parents].append(pid)
        for parents in sorted(families, key=sorted):
            children = sorted(
                (
                    pid
                    for pid, person in returned.people.items()
                    if not person.placeholder and self._blood_parents(self.links, pid) == parents
                ),
                key=lambda pid: (returned.people[pid].birth_order or _LAST, self.name(pid)),
            )
            if len(children) < 2:
                continue
            in_tree = [pid for pid in children if self.in_tree(pid) is not None]
            now = {pid: (self.in_tree(pid) or {}).get("birth_order") for pid in in_tree}
            if len(in_tree) == len(children) and _ranked([now[pid] for pid in children]):
                continue  # the tree records this order already
            then = {
                pid: base.people[pid].get("birth_order") for pid in in_tree if pid in base.people
            }
            clash = any(now[pid] != order for pid, order in then.items())
            tree_order = _in_order({pid: self.in_tree(pid) or {} for pid in in_tree}, in_tree)
            real = sorted(
                (p for p in parents if not returned.people[p].placeholder),
                key=lambda p: (self.gender(p) != Gender.MALE, self.name(p)),
            )
            whose = " & ".join(self.name(p) for p in real) or "an unknown parent"
            self.add(
                ImportChange(
                    id=f"order:{'+'.join(sorted(parents))}",
                    kind="order",
                    row=None,
                    name=f"The children of {whose}",
                    column="Birth order",
                    before=", ".join(self.name(pid) for pid in tree_order),
                    after=", ".join(self.name(pid) for pid in children),
                    clash=clash,
                    needs=self.needs_of(*children),
                    ticked=not clash,
                ),
                Order(
                    frozenset(self.tid(p) for p in parents),
                    tuple(self.tid(pid) for pid in children),
                ),
            )

    # --- Stories and photos ---

    def _stories(self) -> None:
        base, returned = self.base, self.returned
        for pid in sorted(returned.stories.keys() | base.stories.keys()):
            story = returned.stories.get(pid)
            text = _story_text(story.model_dump() if story is not None else None)
            then = _story_text(base.stories.get(pid))
            if text == then or pid not in returned.people:
                continue  # unchanged, or goes with the person taken out
            tid = self.tid(pid)
            if pid not in self.new and tid not in self.tree.people:
                continue  # taken out of the tree since: said so with their details
            was = self.tree.stories.get(tid)
            tree = _file_text(was)
            if tree == text:
                continue
            clash = pid not in self.new and tree != then
            pictures = {}
            for picture in sorted(set(pictures_in(text)) - set(pictures_in(then))):
                address = f"/api/persons/{pid}/media/{picture}"
                if returned.picture(address) is None:
                    self.second_look.append(
                        ImportSecondLook(
                            row=None,
                            message=f"A picture in {self.name(pid)}'s story wasn't sent, so "
                            "the story comes in without it.",
                        )
                    )
                else:
                    pictures[picture] = address
            what = "written" if not tree else ("taken out" if not text else "changed")
            self.add(
                ImportChange(
                    id=f"story:{pid}",
                    kind="story",
                    row=None,
                    person=UUID(tid),
                    name=self.name(pid),
                    column="Life story",
                    before=_excerpt(tree) if tree else "",
                    after=_excerpt(text) if text else "",
                    detail=what,
                    clash=clash,
                    removes=not text,
                    needs=self.needs_of(pid),
                    ticked=not clash and bool(text),
                ),
                Story(tid, text, was, pictures),
            )

    def _photos(self) -> None:
        base, returned = self.base, self.returned
        for pid in sorted(returned.people):
            person = returned.people[pid]
            if person.placeholder:
                continue
            then = base.people.get(pid) or {}
            now_version = person.photo_version if person.has_photo else None
            then_version = then.get("photo_version") if then.get("has_photo") else None
            if now_version == then_version:
                continue
            tid = self.tid(pid)
            tree = self.tree.people.get(tid) or {}
            tree_version = tree.get("photo_version") if tree.get("has_photo") else None
            clash = pid not in self.new and tree_version != then_version
            chosen = returned.photos.get(pid)
            if person.has_photo and chosen is not None:
                self.add(
                    ImportChange(
                        id=f"photo:{pid}",
                        kind="photo",
                        row=None,
                        person=UUID(tid),
                        name=person.full_name,
                        column="Photo",
                        detail="replaced" if tree_version is not None else "added",
                        clash=clash,
                        needs=self.needs_of(pid),
                        ticked=not clash,
                    ),
                    Photo(
                        tid,
                        chosen.display,
                        chosen.crop,
                        f"/api/persons/{pid}/photo/avatar?size=128",
                        tree_version,
                    ),
                )
            elif not person.has_photo and then_version is not None and tree_version is not None:
                self.add(
                    ImportChange(
                        id=f"photo:{pid}",
                        kind="photo",
                        row=None,
                        person=UUID(tid),
                        name=person.full_name,
                        column="Photo",
                        detail="taken out",
                        clash=clash,
                        removes=True,
                        ticked=False,
                    ),
                    Photo(tid, None, None, None, tree_version),
                )

    def plan(self) -> ReturnedPlan:
        self._people()
        self._links()
        self._orders()
        self._stories()
        self._photos()
        return ReturnedPlan(
            changes=self.changes,
            questions=self.questions,
            left_out=self.left_out,
            second_look=self.second_look,
            operations=self.operations,
            ids={pid: tid for pid, tid in self.ids.items() if pid != tid},
        )


def plan_returned(
    base: Base, returned: Returned, tree: TreeNow, answers: Mapping[str, str]
) -> ReturnedPlan:
    return _Planner(base, returned, tree, answers).plan()
