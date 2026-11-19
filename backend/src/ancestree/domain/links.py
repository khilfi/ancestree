"""The rules every link keeps: the same for a link made in the app
as for one that comes back, from the Trash, Undo, a merge, a backup or another computer.

- No one is linked to themselves, nor twice to the same person.
- Two people are parent and child, or married, never both.
- No one is their own ancestor: a loop of parents (A is B's parent, B is C's, C is A's).
- No one has more than two birth parents.

The database's own checks are in services/relationships.py, worded by the sentences here. These
are the same rules over a family held in memory, as a backup or the family folder brings it;
and the loops of parents and children with three birth parents a family could store before
0.8.7, found so the tree never walks a loop for ever, and What's missing lists each, with
the link to take out.
"""

from collections import defaultdict, deque
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

# --- The sentences, the same wherever a rule refuses a link --------------------------------------


def self_link() -> str:
    return "Someone can't be linked to themselves."


def already_parent_and_child(parent: str, child: str) -> str:
    return f"{parent} and {child} are already parent and child."


def married_not_parent(parent: str, child: str) -> str:
    return f"{parent} and {child} are married, so one can't be the other's parent."


def own_ancestor(parent: str, child: str) -> str:
    return (
        f"{child} is already an ancestor of {parent}. This would make {child} their own ancestor."
    )


def third_parent(child: str, parents: Sequence[str]) -> str:
    return (
        f"{child} already has two biological parents: {' and '.join(parents)}. "
        "Choose another kind, such as adoptive."
    )


def already_spouses(a: str, b: str) -> str:
    return f"{a} and {b} are already spouses."


def parent_not_married(a: str, b: str) -> str:
    return f"One of {a} and {b} is the other's parent, so they can't be married."


# --- A family's links, one by one --------------------------------------------------------------


@dataclass(frozen=True)
class Link:
    """A stored link, as the rules see it. A parent link's `source` is the parent; `blood` says
    whether its kind is by birth, so counts towards the two birth parents."""

    id: str
    type: Literal["PARENT_OF", "SPOUSE_OF"]
    source: str
    target: str
    blood: bool = False


@dataclass
class Rules:
    """A family's links, taken in one at a time through the rules: each one refused is said,
    and left out. `names` says who's who in the sentences."""

    names: Mapping[str, str]
    children: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    birth_parents: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    pairs: dict[frozenset[str], set[str]] = field(default_factory=lambda: defaultdict(set))

    def name(self, person: str) -> str:
        return self.names.get(person) or "Someone"

    def refusal(self, link: Link) -> str | None:
        """Why `link` would break the rules among those taken in so far; None if it wouldn't."""
        a, b = link.source, link.target
        if a == b:
            return self_link()
        between = self.pairs.get(frozenset((a, b)), set())
        if link.type == "SPOUSE_OF":
            if "SPOUSE_OF" in between:
                return already_spouses(self.name(a), self.name(b))
            if between:
                return parent_not_married(self.name(a), self.name(b))
            return None
        if "PARENT_OF" in between:
            return already_parent_and_child(self.name(a), self.name(b))
        if between:
            return married_not_parent(self.name(a), self.name(b))
        if self.descends(b, a):
            return own_ancestor(self.name(a), self.name(b))
        theirs = self.birth_parents.get(b, [])
        if link.blood and len(theirs) >= 2:
            return third_parent(self.name(b), [self.name(p) for p in theirs])
        return None

    def add(self, link: Link) -> str | None:
        """Take the link in, if the rules let it; why not, if they don't."""
        refused = self.refusal(link)
        if refused is None:
            self.take(link)
        return refused

    def take(self, link: Link) -> None:
        """Take the link in as it is, unchecked: one kept already, such as the keeper's."""
        self.pairs[frozenset((link.source, link.target))].add(link.type)
        if link.type == "PARENT_OF":
            self.children[link.source].append(link.target)
            if link.blood:
                self.birth_parents[link.target].append(link.source)

    def descends(self, ancestor: str, person: str) -> bool:
        """Whether `person` is `ancestor`'s child, grandchild, and so on, by the links so far."""
        seen, queue = {ancestor}, deque([ancestor])
        while queue:
            for child in self.children.get(queue.popleft(), []):
                if child == person:
                    return True
                if child not in seen:
                    seen.add(child)
                    queue.append(child)
        return False


def family_refusal(links: Sequence[Link], names: Mapping[str, str]) -> str | None:
    """The first rule a whole family's links break, as a backup holds them; None if they
    keep them all. Quick for a family of thousands, unlike taking each in through `Rules`."""

    def name(person: str) -> str:
        return names.get(person) or "Someone"

    pairs: dict[frozenset[str], list[str]] = defaultdict(list)
    for link in links:
        a, b = link.source, link.target
        if a == b:
            return f"{name(a)} is linked to themselves"
        pairs[frozenset((a, b))].append(link.type)
    for pair, types in pairs.items():
        a, b = sorted(pair, key=lambda person: (name(person), person))
        if types.count("PARENT_OF") > 1:
            return f"{name(a)} and {name(b)} are linked as parent and child twice"
        if types.count("SPOUSE_OF") > 1:
            return f"{name(a)} and {name(b)} are married twice"
        if len(set(types)) > 1:
            return f"{name(a)} and {name(b)} are parent and child, and married too"
    crowded = three_birth_parents(
        (link.id, link.source, link.target)
        for link in links
        if link.type == "PARENT_OF" and link.blood
    )
    if crowded:
        return crowded[0].sentence(names)
    loops = parent_loops(
        (link.id, link.source, link.target) for link in links if link.type == "PARENT_OF"
    )
    return loops[0].sentence(names) if loops else None


# --- Stored before 0.8.7: three birth parents, and loops of parents -----------------------------


@dataclass(frozen=True)
class ThreeBirthParents:
    """A child with more than two birth parents, and the link to take out: the newest of them,
    the likeliest mistake. `parents` in the order their links were made, `link`'s the last."""

    child: str
    parents: tuple[str, ...]
    link: str

    def sentence(self, names: Mapping[str, str]) -> str:
        """ "Ali has three birth parents: Hassan, Siti and Yusof" """

        def name(person: str) -> str:
            return names.get(person) or "Someone"

        listed = [name(parent) for parent in self.parents]
        many = {3: "three", 4: "four", 5: "five"}.get(len(listed), str(len(listed)))
        return (
            f"{name(self.child)} has {many} birth parents: "
            f"{', '.join(listed[:-1])} and {listed[-1]}"
        )


def three_birth_parents(links: Iterable[tuple[str, str, str]]) -> list[ThreeBirthParents]:
    """Each child with more than two birth parents in these birth links, (id, parent, child):
    none in a family the rules have always kept."""
    theirs: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for link, parent, child in sorted(
        set(links), key=lambda edge: (_made_in_the_app(edge[0]), edge)
    ):
        theirs[child].append((link, parent))
    return [
        ThreeBirthParents(child, tuple(parent for _, parent in found), found[-1][0])
        for child, found in sorted(theirs.items())
        if len(found) > 2
    ]


# --- Loops of parents ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Loop:
    """A loop of parents, and the link to take out to end it: the newest in the loop, which
    closed it. `people` go down the loop from that link's child to its parent, each the parent
    of the next; the link makes the last the parent of the first."""

    link: str
    parent: str
    child: str
    people: tuple[str, ...]

    def sentence(self, names: Mapping[str, str]) -> str:
        """ "a loop of parents: Ismail is Hassan's parent, Hassan is Ali's, and Ali is
        Ismail's" """

        def name(person: str) -> str:
            return names.get(person) or "someone"

        steps = [*zip(self.people, self.people[1:], strict=False), (self.parent, self.child)]
        said = [f"{name(steps[0][0])} is {name(steps[0][1])}'s parent"]
        said += [f"{name(parent)} is {name(child)}'s" for parent, child in steps[1:]]
        if len(said) > 1:
            said[-1] = f"and {said[-1]}"
        return "a loop of parents: " + (", " if len(said) > 2 else " ").join(said)


def parent_loops(links: Iterable[tuple[str, str, str]]) -> list[Loop]:
    """Every loop of parents in these parent links, (id, parent, child), by the link to take out
    of each: none in a family the rules have always kept. Quick for a family of thousands: only
    the people in a loop are looked at twice."""
    edges = sorted(set(links), key=lambda edge: (_made_in_the_app(edge[0]), edge))  # oldest first
    following: dict[str, list[str]] = defaultdict(list)
    for _, parent, child in edges:
        following[parent].append(child)
    group = _strongly_joined(following)
    found: list[Loop] = []
    kept: dict[str, list[str]] = defaultdict(list)
    for link, parent, child in edges:
        joined = group.get(parent)
        if parent != child and (joined is None or joined != group.get(child)):
            continue  # not in a loop: nothing leads back
        way = _way_down(kept, child, parent)
        if way is None:
            kept[parent].append(child)
        else:
            found.append(Loop(link, parent, child, way))
    return found


def _made_in_the_app(link: str) -> bool:
    """Whether a link's id says it was made in the app: a UUID of version 7, which sorts by
    when it was made. A test family's (version 5) came before anything made since."""
    try:
        return UUID(link).version == 7
    except ValueError:
        return False


def _way_down(kept: Mapping[str, list[str]], start: str, end: str) -> tuple[str, ...] | None:
    """The people from `start` down to `end` by the links kept, each the parent of the next."""
    if start == end:
        return (start,)
    came_from = {start: start}
    queue = deque([start])
    while queue:
        person = queue.popleft()
        for child in kept.get(person, []):
            if child in came_from:
                continue
            came_from[child] = person
            if child == end:
                way = [end]
                while way[-1] != start:
                    way.append(came_from[way[-1]])
                return tuple(reversed(way))
            queue.append(child)
    return None


def _strongly_joined(following: Mapping[str, list[str]]) -> dict[str, int]:
    """Each person in a loop, by a number shared with everyone in the same loops (Tarjan's
    strongly connected components, without recursion)."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    group: dict[str, int] = {}
    counter = 0
    for root in sorted(following):
        if root in index:
            continue
        work: list[tuple[str, int]] = [(root, 0)]
        while work:
            person, at = work.pop()
            if at == 0:
                index[person] = low[person] = counter
                counter += 1
                stack.append(person)
                on_stack.add(person)
            children = following.get(person, [])
            if at < len(children):
                work.append((person, at + 1))
                child = children[at]
                if child not in index:
                    work.append((child, 0))
                elif child in on_stack:
                    low[person] = min(low[person], index[child])
                continue
            if low[person] == index[person]:
                members = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    members.append(member)
                    if member == person:
                        break
                if len(members) > 1:
                    for member in members:
                        group[member] = index[person]
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[person])
    return group
