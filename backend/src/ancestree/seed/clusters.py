"""Made-up families whose married-in families hang off them in hard ways, to
try ways of placing those families side by side. Each is the same every time, and exists only in
memory: nothing is stored. The seventh family is the generated sample of 2,000 (`generated.py`).
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid5

from ancestree.seed.generated import _MEN, _WOMEN

_NAMESPACE = UUID("2b9e6c41-7d3a-4f58-8e0b-5a1c9d4f7e23")


@dataclass
class ClusteredFamily:
    """One made-up family, in rows shaped like the database's, as `generated_family` gives."""

    key: str
    title: str
    about: str
    people: list[dict[str, Any]] = field(default_factory=list)
    links: list[dict[str, Any]] = field(default_factory=list)
    # Generations below the couple at the centre (0 for them), for the family's own line;
    # those who married in, and their families, aren't counted.
    depth: dict[str, int] = field(default_factory=dict)
    spouse: dict[str, str] = field(default_factory=dict)
    children_of: dict[str, list[str]] = field(default_factory=dict)
    born: dict[str, int] = field(default_factory=dict)
    gender: dict[str, str] = field(default_factory=dict)

    def person(self, gender: str, born: int, depth: int | None = None) -> str:
        number = len(self.people)
        names = _MEN if gender == "male" else _WOMEN
        first = names[(number * 7 + len(self.key)) % len(names)]
        person = str(uuid5(_NAMESPACE, f"{self.key}:{number}"))
        self.people.append(
            {
                "id": person,
                "full_name": f"{first} ({number})",
                "nickname": None,
                "gender": gender,
                "birth_year": born,
                "birth_month": 1 + number % 12,
                "birth_day": 1 + number % 28,
                "death_year": None,
                "birth_order": None,
                "placeholder": False,
                "photo_version": None,
                "x": None,
                "y": None,
            }
        )
        self.born[person], self.gender[person] = born, gender
        if depth is not None:
            self.depth[person] = depth
        return person

    def _link(self, kind: str, source: str, target: str) -> None:
        self.links.append(
            {
                "id": str(uuid5(_NAMESPACE, f"{self.key}:{kind}:{source}>{target}")),
                "type": kind,
                "source": source,
                "target": target,
                "kind": "biological" if kind == "parent" else None,
                "status": "married" if kind == "spouse" else None,
            }
        )
        if kind == "spouse":
            self.spouse[source], self.spouse[target] = target, source
        else:
            self.children_of.setdefault(source, []).append(target)

    def couple(self, born: int, depth: int | None = None) -> tuple[str, str]:
        """A husband and wife who start a family."""
        husband = self.person("male", born, depth)
        wife = self.person("female", born + 3, depth)
        self._link("spouse", husband, wife)
        return husband, wife

    def children(self, parents: Sequence[str], count: int) -> list[str]:
        """`count` children of `parents`, sons and daughters in turn, eldest first."""
        born = max(self.born[parent] for parent in parents) + 24
        depth = self.depth.get(parents[0])
        kids = []
        for index in range(count):
            gender = "male" if index % 2 == 0 else "female"
            child = self.person(gender, born + 2 * index, None if depth is None else depth + 1)
            for parent in parents:
                self._link("parent", parent, child)
            kids.append(child)
        return kids

    def marry(self, person: str) -> str:
        """`person` marries someone from outside the family: who they marry."""
        other = "female" if self.gender[person] == "male" else "male"
        spouse = self.person(other, self.born[person] + 1)
        self._link("spouse", person, spouse)
        return spouse

    def in_laws(self, spouse: str, siblings: int) -> tuple[str, str]:
        """A married-in `spouse`'s own family, their parents and `siblings` brothers and
        sisters: a cluster off the rings. Their parents."""
        parents = self.couple(self.born[spouse] - 28)
        for parent in parents:
            self._link("parent", parent, spouse)
        self.children(parents, siblings)
        return parents

    def descend(self, parents: Sequence[str], sizes: Sequence[Sequence[int]]) -> None:
        """Generations below `parents`: the i-th couple of each generation has `sizes[g][i]`
        children (going round the list), and all but the youngest marry, while there's a
        generation to come."""
        couples: list[Sequence[str]] = [parents]
        for generation, counts in enumerate(sizes):
            next_couples: list[Sequence[str]] = []
            for index, couple in enumerate(couples):
                kids = self.children(couple, counts[index % len(counts)])
                if generation + 1 < len(sizes):
                    next_couples += [
                        (kid, self.marry(kid)) for kid in kids[: max(1, len(kids) - 1)]
                    ]
            couples = next_couples

    def at(self, depth: int, gender: str | None = None, married: bool = True) -> list[str]:
        """The family's own people that many generations below the centre, eldest first."""
        return [
            person
            for person, found in self.depth.items()
            if found == depth
            and (gender is None or self.gender[person] == gender)
            and (person in self.spouse) == married
        ]


def _like_planned() -> ClusteredFamily:
    family = ClusteredFamily(
        "planned",
        "1. Married-in families on generations 3 and 4",
        "About 85 people on six rings. A wife on generation 3 brings her parents and 12 brothers "
        "and sisters, on two rings; a husband on generation 4 brings his line, four rings deep.",
    )
    family.descend(family.couple(1880, 0), [[5], [3, 3, 2, 3], [2, 3, 2], [2, 2, 1], [1]])
    wife = family.spouse[family.at(2, "male")[1]]
    family.in_laws(wife, 12)
    husband = family.spouse[family.at(3, "female")[1]]
    great = family.couple(family.born[husband] - 80)
    (grandfather,) = family.children(great, 1)
    grandmother = family.marry(grandfather)
    (father,) = family.children((grandfather, grandmother), 1)
    mother = family.marry(father)
    for parent in (father, mother):
        family._link("parent", parent, husband)
    family.children((father, mother), 1)  # his brother
    return family


def _neighbours() -> ClusteredFamily:
    family = ClusteredFamily(
        "neighbours",
        "2. Married-in families on neighbours",
        "A brother and sister side by side on generation 3 each married into a family of their "
        "own, of five and six people.",
    )
    family.descend(family.couple(1900, 0), [[4], [3, 2, 3, 3], [2]])
    brother, sister = family.at(2)[:2]
    family.in_laws(family.spouse[brother], 3)
    family.in_laws(family.spouse[sister], 4)
    return family


def _six() -> ClusteredFamily:
    family = ClusteredFamily(
        "six",
        "3. Six married-in families around one ring",
        "Every child of the couple at the centre married into a family of their own, of three "
        "to seven people.",
    )
    centre = family.couple(1900, 0)
    for child, siblings in zip(family.children(centre, 6), (3, 1, 5, 4, 2, 3), strict=True):
        spouse = family.marry(child)
        family.in_laws(spouse, siblings)
        family.descend((child, spouse), [[3, 2], [2]])
    return family


def _three_deep() -> ClusteredFamily:
    family = ClusteredFamily(
        "deep",
        "4. A married-in family's married-in family's, three deep",
        "A son's wife brought her family; her sister's husband brought his; and his brother's "
        "wife brought hers.",
    )
    family.descend(family.couple(1890, 0), [[3], [3, 2, 3], [2]])
    wife = family.spouse[family.at(1, "male")[0]]
    # Each family a little smaller than the one it hangs from: the seating centres a married-in
    # family on its biggest line, so the three hang off each other in this order.
    first = family.in_laws(wife, 4)
    sister = next(
        p for p in family.children_of[first[0]] if p != wife and family.gender[p] == "female"
    )
    her_husband = family.marry(sister)
    second = family.in_laws(her_husband, 2)
    brother = next(
        p for p in family.children_of[second[0]] if p != her_husband and family.gender[p] == "male"
    )
    family.in_laws(family.marry(brother), 1)
    return family


def _big_and_small() -> ClusteredFamily:
    family = ClusteredFamily(
        "sizes",
        "5. A married-in family of 60 beside one of 5",
        "A brother and sister side by side on generation 3 married: one into a family of 60 "
        "people over four generations, the other into a family of five.",
    )
    # On generation 3, so that the family of 60's parents, a generation further in, can't
    # outnumber the couple at the centre and take their place there.
    family.descend(family.couple(1870, 0), [[3], [3, 2, 3], [2, 2], [2, 1]])
    big, small = family.at(2)[:2]
    wife = family.spouse[big]
    parents = family.in_laws(wife, 5)
    for sibling in family.children_of[parents[0]]:
        if sibling != wife:
            family.descend((sibling, family.marry(sibling)), [[3, 2], [3, 2]])
    family.in_laws(family.spouse[small], 2)
    return family


def _parent_and_child() -> ClusteredFamily:
    family = ClusteredFamily(
        "generations",
        "6. Married-in families on a parent and their child",
        "A son's wife brought her family, and so did their own son's wife, a ring further out.",
    )
    family.descend(family.couple(1890, 0), [[3], [2, 3, 2], [2]])
    son = family.at(1, "male")[0]
    family.in_laws(family.spouse[son], 3)
    grandson = next(
        p for p in family.children_of[son] if family.gender[p] == "male" and p in family.spouse
    )
    family.in_laws(family.spouse[grandson], 4)
    return family


def clustered_families() -> list[ClusteredFamily]:
    """The six made-up families, in the plan's order."""
    return [
        _like_planned(),
        _neighbours(),
        _six(),
        _three_deep(),
        _big_and_small(),
        _parent_and_child(),
    ]
