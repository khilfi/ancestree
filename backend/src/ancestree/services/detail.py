"""Building the person view from database rows: labels, families and birth order."""

from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import date, datetime
from typing import Any
from uuid import UUID

from neo4j import AsyncManagedTransaction

from ancestree.domain.dates import describe_partial_date, format_partial_date
from ancestree.domain.person import Gender, PartialDate, Person
from ancestree.domain.relationship import BIOLOGICAL, SpouseStatus
from ancestree.domain.views import ChildGroup, DateView, PersonDetail, PersonSummary, Relative
from ancestree.kinship.blood import Seniority
from ancestree.kinship.kin import Blood, Kin, KindSibling, KindStep, Side, Spouse
from ancestree.kinship.terms import TermBook
from ancestree.lineage.birth_order import (
    Sibling,
    compare_births,
    compare_siblings,
    order_siblings,
    position_label,
)
from ancestree.repo import kinds as kinds_repo
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import date_from_props, person_from_props
from ancestree.services.context import NotFoundError
from ancestree.services.families import Kinds, blood_parents, family_key, is_blood, makes_family

# With no death recorded, someone born within this many years is taken to be alive.
LIVING_WITHIN_YEARS = 110

_GENDER_ORDER = {Gender.MALE: 0, Gender.FEMALE: 1, Gender.UNKNOWN: 2}


def summary(props: Mapping[str, Any]) -> PersonSummary:
    return PersonSummary(
        id=UUID(props["id"]),
        full_name=props["full_name"],
        nickname=props.get("nickname"),
        gender=Gender(props.get("gender") or Gender.UNKNOWN),
        birth_year=props.get("birth_year"),
        death_year=props.get("death_year"),
        photo_version=props.get("photo_version") if props.get("has_photo") else None,
        placeholder=bool(props.get("placeholder", False)),
    )


def display_name(props: Mapping[str, Any]) -> str:
    if props.get("placeholder"):
        return "an unknown parent"
    return str(props.get("nickname") or props["full_name"])


def is_living(person: Person, *, this_year: int | None = None) -> bool | None:
    return living_from(person.living, person.birth_date, person.death_date, this_year=this_year)


def living_from(
    living: bool | None,
    born: PartialDate | None,
    died: PartialDate | None,
    *,
    this_year: int | None = None,
) -> bool | None:
    """Alive or not: as set by hand; else no death recorded and born within 110 years.
    None when there's nothing to go on."""
    if living is not None:
        return living
    if died is not None:
        return False
    if born is None or born.year is None:
        return None
    return born.year > (this_year or date.today().year) - LIVING_WITHIN_YEARS


async def load_detail(
    tx: AsyncManagedTransaction, person_id: str, language: str = "en"
) -> PersonDetail:
    """A person with their relatives, labelled in the kinship language. person.json
    snapshots always ask for English, whatever the setting."""
    props = await people_repo.fetch_person(tx, person_id)
    if props is None:
        raise NotFoundError("That person isn't in the tree.")
    kinds = await kinds_repo.fetch_kinds(tx)
    parents = await people_repo.fetch_parents(tx, person_id)
    spouses = await people_repo.fetch_spouses(tx, person_id)
    children = await people_repo.fetch_children(tx, person_id)
    siblings = await people_repo.fetch_siblings(tx, person_id)
    co_parent_ids = {parent["id"] for row in children for parent in row["parents"]} - {person_id}
    co_parents = await people_repo.fetch_people(tx, sorted(co_parent_ids))
    book = TermBook.load(language)
    return build_detail(props, kinds, parents, spouses, children, siblings, co_parents, book)


class FamilyRows:
    """The whole family in memory, read the way the person view's database queries read it
    (repo/people.py): for a copy to edit, which works out each person's view itself, and
    for the golden files that prove it does so as Python does.

    `people` are the stored properties; `links` are {id, type ("parent" or "spouse"), source (the
    parent), target, kind, status, order}. Where the database would give rows in no set order,
    these come in the order of the links, by type, then id, as the tree reads them."""

    def __init__(
        self, people: Iterable[Mapping[str, Any]], links: Iterable[Mapping[str, Any]]
    ) -> None:
        self.people = {str(props["id"]): props for props in people}
        self._up: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
        self._down: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
        self._married: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
        for link in sorted(links, key=lambda link: (link["type"], str(link["id"]))):
            if link["type"] == "parent":
                self._up[str(link["target"])].append(link)
                self._down[str(link["source"])].append(link)
            else:
                self._married[str(link["source"])].append(link)
                self._married[str(link["target"])].append(link)

    @staticmethod
    def _link(link: Mapping[str, Any]) -> dict[str, Any]:
        """A link's stored properties, as `properties(link)` gives them."""
        if link["type"] == "parent":
            return {"id": str(link["id"]), "kind": link.get("kind")}
        return {"id": str(link["id"]), "status": link.get("status"), "order": link.get("order")}

    @staticmethod
    def _kind(link: Mapping[str, Any]) -> str:
        return str(link.get("kind") or BIOLOGICAL)

    def _parents_of(self, person_id: str) -> list[dict[str, Any]]:
        return [
            {"id": str(link["source"]), "kind": self._kind(link)} for link in self._up[person_id]
        ]

    def parents(self, person_id: str) -> list[dict[str, Any]]:
        return [
            {"person": self.people[str(link["source"])], "link": self._link(link)}
            for link in self._up[person_id]
        ]

    def spouses(self, person_id: str) -> list[dict[str, Any]]:
        rows = []
        for link in self._married[person_id]:
            other = link["target"] if str(link["source"]) == person_id else link["source"]
            rows.append({"person": self.people[str(other)], "link": self._link(link)})
        return rows

    def children(self, person_id: str) -> list[dict[str, Any]]:
        return [
            {
                "person": self.people[str(link["target"])],
                "link": self._link(link),
                "parents": self._parents_of(str(link["target"])),
            }
            for link in self._down[person_id]
        ]

    def siblings(self, person_id: str) -> list[dict[str, Any]]:
        shared: dict[str, list[dict[str, Any]]] = {}
        for mine in self._up[person_id]:
            for theirs in self._down[str(mine["source"])]:
                sibling = str(theirs["target"])
                if sibling != person_id:
                    shared.setdefault(sibling, []).append(
                        {
                            "id": str(mine["source"]),
                            "mine": self._kind(mine),
                            "theirs": self._kind(theirs),
                        }
                    )
        return [
            {"person": self.people[sibling], "shared": rows, "parents": self._parents_of(sibling)}
            for sibling, rows in shared.items()
        ]

    def detail(
        self,
        person_id: str,
        kinds: Kinds,
        book: TermBook | None = None,
        *,
        this_year: int | None = None,
    ) -> PersonDetail:
        """What GET /api/persons/{id} answers, as load_detail works it out from the database."""
        children = self.children(person_id)
        co_parents = {row["id"] for child in children for row in child["parents"]} - {person_id}
        return build_detail(
            self.people[person_id],
            kinds,
            self.parents(person_id),
            self.spouses(person_id),
            children,
            self.siblings(person_id),
            {pid: dict(self.people[pid]) for pid in sorted(co_parents)},
            book,
            this_year=this_year,
        )


def build_detail(
    props: Mapping[str, Any],
    kinds: Kinds,
    parents: list[dict[str, Any]],
    spouses: list[dict[str, Any]],
    children: list[dict[str, Any]],
    siblings: list[dict[str, Any]],
    co_parents: Mapping[str, dict[str, Any]],
    book: TermBook | None = None,
    *,
    this_year: int | None = None,
) -> PersonDetail:
    words = _Words(book or TermBook.load("en"), kinds)
    person = person_from_props(props)
    # Father and mother first, then adoptive, foster and other parents. Two of one gender come
    # in the order of their links, as the tree reads them: never as the database hands them
    # back, which a restore changes.
    parents = sorted(
        parents,
        key=lambda row: (
            not is_blood(kinds, _kind(row["link"])),
            _gender(row["person"]),
            str(row["link"]["id"]),
        ),
    )
    birth_parents = [row for row in parents if is_blood(kinds, _kind(row["link"]))]

    return PersonDetail(
        id=person.id,
        full_name=person.full_name,
        nickname=person.nickname,
        title=person.title,
        name_jawi=person.name_jawi,
        gender=person.gender,
        birth_date=_date_view(person.birth_date),
        birth_place=person.birth_place,
        death_date=_date_view(person.death_date),
        death_place=person.death_place,
        burial_place=person.burial_place,
        residence=person.residence,
        living=person.living,
        is_living=is_living(person, this_year=this_year),
        occupation=person.occupation,
        notes=person.notes,
        placeholder=person.placeholder,
        photo_version=person.photo_version if person.has_photo else None,
        sibling_position=_sibling_position(props, birth_parents, siblings, kinds),
        parents=[_parent(row, words) for row in parents],
        spouses=[_spouse(row, words) for row in sorted(spouses, key=_spouse_sort)],
        siblings=_siblings(props, siblings, birth_parents, words),
        child_groups=_child_groups(str(person.id), children, co_parents, words),
        link_count=len(parents) + len(spouses) + len(children),
        created_at=_native(props.get("created_at")),
        updated_at=_native(props.get("updated_at")),
    )


def _date_view(value: PartialDate | None) -> DateView | None:
    if value is None:
        return None
    return DateView(
        value=value, text=format_partial_date(value), description=describe_partial_date(value)
    )


def _native(value: Any) -> datetime | None:
    to_native = getattr(value, "to_native", None)
    return to_native() if callable(to_native) else None


def _gender(props: Mapping[str, Any]) -> int:
    return _GENDER_ORDER[Gender(props.get("gender") or Gender.UNKNOWN)]


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def _kind(link: Mapping[str, Any]) -> str:
    return str(link.get("kind") or BIOLOGICAL)


def _sibling(props: Mapping[str, Any]) -> Sibling:
    return Sibling(
        id=props["id"],
        gender=Gender(props.get("gender") or Gender.UNKNOWN),
        birth_date=date_from_props("birth", props),
        birth_order=props.get("birth_order"),
        tiebreak=str(props.get("created_at") or props["full_name"]),
    )


class _Words:
    """A relative's label in the kinship language: the relationship finder's own words, so
    the Relatives tab and the answers agree. English where a language has none."""

    def __init__(self, book: TermBook, kinds: Kinds) -> None:
        self.book, self.kinds = book, kinds

    def say(self, kin: Kin, fallback: str) -> str:
        word = self.book.term(kin, self.kinds) or TermBook.load("en").term(kin, self.kinds)
        return _cap(word or fallback)

    def by_kind(self, key: str, gender: Gender, *, upward: bool) -> Kin:
        """A parent or child: by birth (father, son) or of another kind (adoptive father)."""
        if is_blood(self.kinds, key):
            return Blood(1, 0, gender) if upward else Blood(0, 1, gender)
        return KindStep(key, upward, gender)


def _parent(row: Mapping[str, Any], words: _Words) -> Relative:
    person, link = row["person"], row["link"]
    if person.get("placeholder"):
        label = f"{words.say(Blood(1, 0, Gender.UNKNOWN), 'parent')} (unknown)"
    else:
        gender = Gender(person.get("gender") or Gender.UNKNOWN)
        label = words.say(words.by_kind(_kind(link), gender, upward=True), "parent")
    return Relative(
        **summary(person).model_dump(), label=label, link_id=UUID(link["id"]), kind=link.get("kind")
    )


def _spouse_sort(row: Mapping[str, Any]) -> tuple[int, int, str]:
    link = row["link"]
    divorced = link.get("status") == SpouseStatus.DIVORCED
    return (int(divorced), link.get("order") or 99, row["person"]["full_name"])


def _spouse(row: Mapping[str, Any], words: _Words) -> Relative:
    person, link = row["person"], row["link"]
    status = SpouseStatus(link.get("status") or SpouseStatus.MARRIED)
    gender = Gender(person.get("gender") or Gender.UNKNOWN)
    label = words.say(Spouse(gender, former=status is SpouseStatus.DIVORCED), "spouse")
    return Relative(
        **summary(person).model_dump(), label=label, link_id=UUID(link["id"]), status=status
    )


def _shares_blood(row: Mapping[str, Any], kinds: Kinds) -> list[Mapping[str, Any]]:
    """The parents a sibling row shares with this person by birth, on both sides."""
    return [s for s in row["shared"] if is_blood(kinds, s["mine"]) and is_blood(kinds, s["theirs"])]


def _sibling_position(
    props: Mapping[str, Any],
    birth_parents: list[dict[str, Any]],
    siblings: list[dict[str, Any]],
    kinds: Kinds,
) -> str | None:
    """ "Eldest son of Tok Ismail & Nenek Fatimah": birth order among the same parents."""
    my_parents = frozenset(row["person"]["id"] for row in birth_parents)
    if not my_parents:
        return None
    by_birth = [row for row in siblings if _shares_blood(row, kinds)]
    family = [_sibling(props)] + [
        _sibling(row["person"])
        for row in by_birth
        if blood_parents(row["parents"], kinds) == my_parents
    ]
    ordered, decided = order_siblings(family)
    gender = Gender(props.get("gender") or Gender.UNKNOWN)
    # With one parent recorded, "only child of Rahman" would be wrong if Rahman has children
    # with someone else: then the position waits until the other parent is known.
    others_children = len(by_birth) > len(family) - 1
    if decided and not (len(my_parents) < 2 and others_children):
        position = position_label(ordered, props["id"])
    else:
        position = {Gender.MALE: "son", Gender.FEMALE: "daughter"}.get(gender, "child")
    names = " & ".join(display_name(row["person"]) for row in birth_parents)
    return f"{_cap(position)} of {names}"


def _siblings(
    props: Mapping[str, Any],
    siblings: list[dict[str, Any]],
    birth_parents: list[dict[str, Any]],
    words: _Words,
) -> list[Relative]:
    """Brothers and sisters by birth in birth order, then half-siblings and siblings
    through adoption or fostering by birth year. A guardian's children aren't siblings."""
    kinds = words.kinds
    my_parents = frozenset(row["person"]["id"] for row in birth_parents)
    parent_gender = {
        row["person"]["id"]: Gender(row["person"].get("gender") or Gender.UNKNOWN)
        for row in birth_parents
    }
    me = _sibling(props)
    family = [me] + [
        _sibling(row["person"])
        for row in siblings
        if my_parents and blood_parents(row["parents"], kinds) == my_parents
    ]
    ordered, _ = order_siblings(family)
    rank = {sibling.id: n for n, sibling in enumerate(ordered)}

    ranked = []
    for row in siblings:
        person = row["person"]
        them = _sibling(person)
        if them.id in rank:
            order = compare_siblings(me, them, family)
            key: tuple[int, int, str] = (0, rank[them.id], "")
        else:
            order = compare_births(me.birth_date, them.birth_date)
            key = (1, person.get("birth_year") or 9999, person["full_name"])
        seniority: Seniority | None = None if not order else ("younger" if order < 0 else "elder")
        kin: Kin
        if shared := _shares_blood(row, kinds):
            their_parents = blood_parents(row["parents"], kinds)
            # Half only when both have two recorded parents and share exactly one.
            half = len(my_parents) == 2 and len(their_parents) == 2 and len(shared) == 1
            side = _side(parent_gender.get(shared[0]["id"])) if half else None
            kin = Blood(1, 1, them.gender, side, seniority, None, half)
        else:
            through = next(
                (
                    s
                    for s in row["shared"]
                    if makes_family(kinds, s["mine"]) and makes_family(kinds, s["theirs"])
                ),
                None,
            )
            if through is None:
                continue  # e.g. the children of someone's guardian
            kind = through["theirs"] if is_blood(kinds, through["mine"]) else through["mine"]
            kin = KindSibling(kind, them.gender, seniority)
        view = Relative(
            **summary(person).model_dump(), label=words.say(kin, "sibling"), link_id=None
        )
        ranked.append((key, view))
    return [view for _, view in sorted(ranked, key=lambda item: item[0])]


_SIDES: dict[Gender, Side] = {Gender.MALE: "paternal", Gender.FEMALE: "maternal"}


def _side(gender: Gender | None) -> Side | None:
    """The side of a shared parent: a half-brother through the father is paternal."""
    return _SIDES.get(gender or Gender.UNKNOWN)


def _child_groups(
    person_id: str,
    children: list[dict[str, Any]],
    co_parents: Mapping[str, dict[str, Any]],
    words: _Words,
) -> list[ChildGroup]:
    """Children by birth, one group per other parent; then adopted, fostered and other
    children, one group per kind and co-parent."""
    kinds = words.kinds
    families: dict[tuple[str | None, frozenset[str]], list[dict[str, Any]]] = defaultdict(list)
    for row in children:
        families[family_key(row, person_id, kinds)].append(row)

    groups = []
    for (group_kind, others), rows in families.items():
        by_id = {row["person"]["id"]: row for row in rows}
        ordered, decided = order_siblings([_sibling(row["person"]) for row in rows])
        views = []
        for sibling in ordered:
            person, link = by_id[sibling.id]["person"], by_id[sibling.id]["link"]
            label = words.say(words.by_kind(_kind(link), sibling.gender, upward=False), "child")
            views.append(
                Relative(
                    **summary(person).model_dump(),
                    label=label,
                    link_id=UUID(link["id"]),
                    kind=_kind(link),
                )
            )
        other_parents = sorted(
            (co_parents[pid] for pid in others if pid in co_parents), key=lambda p: _gender(p)
        )
        groups.append(
            ChildGroup(
                kind=group_kind,
                other_parents=[summary(p) for p in other_parents],
                order_decided=decided,
                children=views,
            )
        )

    def order(group: ChildGroup) -> tuple[int, int, int]:
        eldest = min((c.birth_year or 9999 for c in group.children), default=9999)
        if group.kind is None:
            return 0, 0, eldest
        definition = kinds.get(group.kind)
        return 1, definition.sort_order if definition else 0, eldest

    return sorted(groups, key=order)
