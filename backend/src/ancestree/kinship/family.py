"""The family as the relationship finder sees it: people, parent links and marriages."""

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from ancestree.domain.person import Gender, PartialDate
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind, SpouseStatus
from ancestree.lineage.birth_order import Sibling


def short_name(full_name: str, nickname: str | None = None) -> str:
    """How answers name someone: "Tok Ismail" by their nickname, "Hassan" for Hassan bin
    Ismail. The same rule as the tree's link picker."""
    if nickname:
        return nickname
    words = full_name.split()
    for index, word in enumerate(words):
        if index and word.casefold() in {"bin", "binti", "bte", "bt"}:
            return " ".join(words[:index])
    return full_name


@dataclass(frozen=True)
class Member:
    id: str
    name: str  # as answers say it: "Siti", "Tok Ismail"
    gender: Gender = Gender.UNKNOWN
    birth: PartialDate | None = None
    birth_order: int | None = None
    placeholder: bool = False  # an unknown parent

    def as_sibling(self) -> Sibling:
        return Sibling(self.id, self.gender, self.birth, self.birth_order, self.name)


@dataclass(frozen=True)
class ParentLink:
    id: str
    parent: str
    child: str
    kind: str = BIOLOGICAL


@dataclass(frozen=True)
class Marriage:
    id: str
    a: str
    b: str
    status: SpouseStatus = SpouseStatus.MARRIED

    def other(self, person: str) -> str:
        return self.b if person == self.a else self.a


class Family:
    """Everyone and every link, indexed both ways. Links to people who aren't here, or of
    kinds that don't exist, are ignored rather than trusted."""

    def __init__(
        self,
        members: Iterable[Member],
        parent_links: Iterable[ParentLink],
        marriages: Iterable[Marriage],
        kinds: Mapping[str, RelationshipKind],
    ) -> None:
        self.members = {member.id: member for member in members}
        self.kinds = dict(kinds)
        self.up: dict[str, list[ParentLink]] = defaultdict(list)  # a child's links to parents
        self.down: dict[str, list[ParentLink]] = defaultdict(list)  # a parent's to children
        self.wed: dict[str, list[Marriage]] = defaultdict(list)
        for link in parent_links:
            if link.parent in self.members and link.child in self.members and link.kind in kinds:
                self.up[link.child].append(link)
                self.down[link.parent].append(link)
        for marriage in marriages:
            if marriage.a in self.members and marriage.b in self.members:
                self.wed[marriage.a].append(marriage)
                self.wed[marriage.b].append(marriage)
        # Fathers before mothers, then by name: answers and paths come out the same every time.
        for links in self.up.values():
            links.sort(key=lambda link: self.order_key(link.parent))
        for links in self.down.values():
            links.sort(key=lambda link: self.order_key(link.child))

    def order_key(self, person: str) -> tuple[int, str, str]:
        member = self.members[person]
        rank = {Gender.MALE: 0, Gender.FEMALE: 1}.get(member.gender, 2)
        return rank, member.name.casefold(), member.id

    def gender(self, person: str) -> Gender:
        return self.members[person].gender

    def is_blood(self, kind: str | None) -> bool:
        definition = self.kinds.get(kind or "")
        return definition is not None and definition.blood

    def makes_family(self, kind: str | None) -> bool:
        """Kinds placed on the rings (adoptive, foster) make brothers and sisters."""
        definition = self.kinds.get(kind or "")
        return definition is not None and definition.in_layout

    def blood_parents(self, person: str) -> list[str]:
        return [link.parent for link in self.up[person] if self.is_blood(link.kind)]

    def blood_children(self, person: str) -> list[str]:
        return [link.child for link in self.down[person] if self.is_blood(link.kind)]

    def blood_link(self, parent: str, child: str) -> str:
        """The id of the birth link from a parent to their child."""
        return next(
            link.id for link in self.up[child] if link.parent == parent and self.is_blood(link.kind)
        )

    def parents(self, person: str) -> set[str]:
        """Parents of any kind: birth, adoptive, foster, guardian..."""
        return {link.parent for link in self.up[person]}

    def children(self, person: str) -> set[str]:
        return {link.child for link in self.down[person]}

    def marriage(self, a: str, b: str) -> Marriage | None:
        return next((m for m in self.wed[a] if m.other(a) == b), None)

    def full_siblings(self, person: str) -> list[Member]:
        """The children of exactly the same birth parents, this person included: the family
        that birth order counts within."""
        mine = frozenset(self.blood_parents(person))
        if not mine:
            return [self.members[person]]
        candidates = {child for parent in mine for child in self.blood_children(parent)}
        return [
            self.members[child]
            for child in sorted(candidates)
            if frozenset(self.blood_parents(child)) == mine
        ]
