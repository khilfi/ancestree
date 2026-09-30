"""Blood relations: climbing from both people to the nearest shared ancestors.

Only biological links count. The counts alone decide the term: A climbs `up` generations
to the shared ancestor and B is `down` generations below it. Ages never enter into it.
"""

from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from ancestree.kinship.family import Family
from ancestree.lineage.birth_order import compare_births, compare_siblings, order_siblings

MAX_GENERATIONS = 20
MAX_LINES = 4096  # lines up through every parent; a fully recorded pedigree doubles each step

type Seniority = Literal["elder", "younger"]

_ORDINALS = ("eldest", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
             "ninth", "tenth")  # fmt: skip


@dataclass(frozen=True)
class Place:
    """Where someone comes among their brothers and sisters: `number` 1 is the eldest, of
    `of` in all. Some words depend on it, e.g. Malay pak long and pak su."""

    number: int
    of: int

    @property
    def youngest(self) -> bool:
        return self.of >= 2 and self.number == self.of

    def keys(self) -> tuple[str, ...]:
        """The names a word list may give this place, the most specific first: "youngest",
        then "eldest", "second", "third" ..., then "other" for any place not listed."""
        named = ["youngest"] if self.youngest else []
        if self.number <= len(_ORDINALS):
            named.append(_ORDINALS[self.number - 1])
        return (*named, "other")


@dataclass(frozen=True)
class Climb:
    """Everyone a person descends from by birth, with the shortest way back down."""

    depth: dict[str, int]  # ancestor -> generations above the person (the person: 0)
    below: dict[str, str]  # ancestor -> the next person down, towards the person
    via: dict[str, str]  # ancestor -> the link between them


def climb(family: Family, person: str) -> Climb:
    depth, below, via = {person: 0}, {}, {}
    frontier = [person]
    for generation in range(1, MAX_GENERATIONS + 1):
        found = []
        for child in frontier:
            for link in family.up[child]:
                if family.is_blood(link.kind) and link.parent not in depth:
                    depth[link.parent] = generation
                    below[link.parent] = child
                    via[link.parent] = link.id
                    found.append(link.parent)
        if not found:
            break
        frontier = found
    return Climb(depth, below, via)


@dataclass(frozen=True)
class BloodTie:
    """One way two people are related by blood. `path` runs from A up to the first of the
    shared ancestors and down to B; `links` are the parent links along it."""

    up: int
    down: int
    ancestors: tuple[str, ...]  # the nearest shared ancestors: one person, or a couple
    path: tuple[str, ...]
    links: tuple[str, ...]

    @property
    def via_a(self) -> str | None:
        """A's side just below the shared ancestors: A's parent, for an uncle."""
        return self.path[self.up - 1] if self.up else None

    @property
    def via_b(self) -> str | None:
        """B's side just below the shared ancestors: B's parent, for a nephew."""
        return self.path[self.up + 1] if self.down else None

    def reversed(self) -> BloodTie:
        return BloodTie(self.down, self.up, self.ancestors, self.path[::-1], self.links[::-1])


def lines_up(family: Family, person: str) -> dict[str, list[tuple[str, ...]]] | None:
    """Every way up by birth from `person` to each ancestor: (person, parent, ..., ancestor).
    None when there are too many to list: a big, fully recorded pedigree."""
    found: dict[str, list[tuple[str, ...]]] = {person: [(person,)]}
    frontier: list[tuple[str, ...]] = [(person,)]
    count = 1
    for _ in range(MAX_GENERATIONS):
        grown = []
        for line in frontier:
            for parent in family.blood_parents(line[-1]):
                if parent in line:
                    continue  # the rules refuse cycles; never loop anyway
                longer = (*line, parent)
                found.setdefault(parent, []).append(longer)
                grown.append(longer)
                count += 1
                if count > MAX_LINES:
                    return None
        if not grown:
            break
        frontier = grown
    return found


def blood_ties(family: Family, a: str, b: str) -> list[BloodTie]:
    """Every way A and B are related by blood, closest first. Usually one; there are more
    when cousins married, for their children, or for double cousins.

    Each tie is a line up from A and a line up from B that meet first at a shared ancestor:
    they have no one else in common. A couple at the top of the same two lines is one tie.
    """
    from_a, from_b = lines_up(family, a), lines_up(family, b)
    if from_a is None or from_b is None:
        return _nearest_ties(family, a, b)
    groups: dict[tuple[tuple[str, ...], tuple[str, ...]], list[str]] = {}
    for ancestor in from_a.keys() & from_b.keys():
        for line_a in from_a[ancestor]:
            for line_b in from_b[ancestor]:
                below_a, below_b = line_a[:-1], line_b[:-1]
                if not set(below_a) & set(below_b):
                    groups.setdefault((below_a, below_b), []).append(ancestor)
    ties = []
    for (below_a, below_b), ancestors in groups.items():
        ancestors.sort(key=family.order_key)
        up = len(below_a)
        path = (*below_a, ancestors[0], *reversed(below_b))
        # Climbing, each link is (child, parent); coming down, (parent, child).
        links = tuple(
            family.blood_link(path[i + 1], path[i])
            if i < up
            else family.blood_link(path[i], path[i + 1])
            for i in range(len(path) - 1)
        )
        ties.append(BloodTie(up, len(below_b), tuple(ancestors), path, links))
    return _closest_first(family, ties)


def _closest_first(family: Family, ties: list[BloodTie]) -> list[BloodTie]:
    # The order is the same whichever way round the question is asked.
    return sorted(
        ties,
        key=lambda tie: (
            tie.up + tie.down,
            abs(tie.up - tie.down),
            [family.order_key(p) for p in tie.ancestors],
        ),
    )


def _nearest_ties(family: Family, a: str, b: str) -> list[BloodTie]:
    """For pedigrees too big to list every line: the nearest shared ancestors only, each by
    its shortest line."""
    from_a, from_b = climb(family, a), climb(family, b)
    shared = from_a.depth.keys() & from_b.depth.keys()
    # The nearest shared ancestors: none of their children is a shared ancestor too.
    nearest = [p for p in shared if not any(c in shared for c in family.blood_children(p))]
    # A couple reached through the same child on each side is one relationship, not two.
    groups: dict[tuple[int, int, str | None, str | None], list[str]] = defaultdict(list)
    for ancestor in nearest:
        key = (
            from_a.depth[ancestor],
            from_b.depth[ancestor],
            from_a.below.get(ancestor),
            from_b.below.get(ancestor),
        )
        groups[key].append(ancestor)

    ties = []
    for (up, down, _, _), ancestors in groups.items():
        ancestors.sort(key=family.order_key)
        top = ancestors[0]
        up_people, up_links = _route(from_a, top)
        down_people, down_links = _route(from_b, top)
        ties.append(
            BloodTie(
                up,
                down,
                tuple(ancestors),
                (*up_people, *reversed(down_people[:-1])),
                (*up_links, *reversed(down_links)),
            )
        )
    return _closest_first(family, ties)


def _route(climbed: Climb, top: str) -> tuple[list[str], list[str]]:
    """From the person who climbed up to `top`: the people (theirs first) and the links."""
    people, links = [top], []
    while people[-1] in climbed.below:
        links.append(climbed.via[people[-1]])
        people.append(climbed.below[people[-1]])
    return people[::-1], links[::-1]


def seniority(family: Family, person: str, than: str) -> Seniority | None:
    """Whether `person` is the elder or younger of two siblings. Among the children of
    the same parents birth order decides, set by hand where dates can't; otherwise dates."""
    them, me = family.members[person], family.members[than]
    household = family.full_siblings(than)
    if them in household:
        order = compare_siblings(
            me.as_sibling(), them.as_sibling(), [s.as_sibling() for s in household]
        )
    else:
        order = compare_births(me.birth, them.birth)
    if not order:
        return None
    return "younger" if order < 0 else "elder"


def birth_place(family: Family, person: str) -> Place | None:
    """Where someone comes among their brothers and sisters, once the order is known. Some
    terms depend on it, e.g. Malay words for an eldest or youngest uncle."""
    household = family.full_siblings(person)
    if len(household) < 2:
        return None
    ordered, decided = order_siblings([s.as_sibling() for s in household])
    if not decided:
        return None
    return Place([s.id for s in ordered].index(person) + 1, len(ordered))
