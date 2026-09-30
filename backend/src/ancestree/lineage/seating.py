"""Seats on the lineage rings: the centre, generations, lines of descent, and who sits
beside whom.

This part decides; the browser only turns seats into coordinates. Birth years never
decide a generation: a child sits one ring outside the parent further from the
centre, even when born the same year as an uncle.

- The centre is the oldest ancestor: of the people with no recorded parents, the one
  with the most generations below, then the most descendants, then the earliest birth.
- The centre's line of descent fills the rings. Anyone who married into it, or had
  children with someone in it (an unknown parent, too), sits beside that person.
- Everyone else hangs off the rings in clusters, e.g. a wife's parents and siblings,
  seated the same way around their own centre and folded away by default.
- Families with no link to each other each get their own rings.
"""

from collections import defaultdict, deque
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from ancestree.domain.person import Gender, PartialDate
from ancestree.lineage.birth_order import Sibling, order_siblings

_LAST = 1_000_000  # sorts after any real birth year or marriage number


@dataclass(frozen=True)
class Member:
    id: str
    name: str = ""
    gender: Gender = Gender.UNKNOWN
    birth: PartialDate | None = None
    birth_order: int | None = None
    placeholder: bool = False


@dataclass(frozen=True)
class ParentEdge:
    parent: str
    child: str
    in_layout: bool = True  # False for kinds like guardian, which don't place the child


@dataclass(frozen=True)
class SpouseEdge:
    a: str
    b: str
    order: int | None = None


@dataclass(frozen=True)
class Seat:
    """Where one person sits. `parent` and `order` place descendants: `order` counts
    clockwise among that parent's children, eldest first. `partner_of` places a husband,
    wife or unknown parent beside that person, in the order of their families."""

    unit: str
    generation: int  # 1 = the centre
    parent: str | None = None
    order: int = 0
    partner_of: str | None = None
    branch: str | None = None  # where this line's colour starts (see _Family.branches)


@dataclass(frozen=True)
class Unit:
    """One set of rings: a family's own ("main:0"), or a cluster hanging off a person."""

    id: str
    centre: tuple[str, ...]
    anchor: str | None = None  # a cluster's person on the rings it hangs from
    anchor_seat: Seat | None = None  # where that person would sit in the cluster
    size: int = 0


@dataclass
class Seating:
    units: list[Unit]
    seats: dict[str, Seat]
    unlinked: list[str]


def seat_family(
    members: Sequence[Member],
    parents: Iterable[ParentEdge],
    spouses: Iterable[SpouseEdge],
    *,
    centre: str | None = None,
) -> Seating:
    family = _Family(members, parents, spouses)
    linked = {person for person in family.members if family.neighbours[person]}
    seating = Seating([], {}, sorted(set(family.members) - linked, key=family.sort_key))
    # The family holding the chosen centre comes first, as "main:0", even when a family with
    # no link to it is bigger: it's the one at the centre. Then the biggest first.
    groups = sorted(
        family.components(linked),
        key=lambda group: (centre not in group, -len(group), min(group)),
    )
    for number, group in enumerate(groups):
        chosen = centre if centre in group else None
        family.seat_unit(group, f"main:{number}", chosen, None, seating)
    return seating


class _Family:
    def __init__(
        self,
        members: Sequence[Member],
        parents: Iterable[ParentEdge],
        spouses: Iterable[SpouseEdge],
    ) -> None:
        self.members = {member.id: member for member in members}
        self.parents_of: dict[str, list[str]] = defaultdict(list)  # links that place
        self.children_of: dict[str, list[str]] = defaultdict(list)
        self.spouses_of: dict[str, list[str]] = defaultdict(list)
        self.marriage_order: dict[frozenset[str], int] = {}
        self.neighbours: dict[str, set[str]] = defaultdict(set)  # any link at all
        for edge in parents:
            if edge.parent in self.members and edge.child in self.members:
                self.neighbours[edge.parent].add(edge.child)
                self.neighbours[edge.child].add(edge.parent)
                if edge.in_layout:
                    self.parents_of[edge.child].append(edge.parent)
                    self.children_of[edge.parent].append(edge.child)
        for spouse in spouses:
            if spouse.a in self.members and spouse.b in self.members and spouse.a != spouse.b:
                self.neighbours[spouse.a].add(spouse.b)
                self.neighbours[spouse.b].add(spouse.a)
                self.spouses_of[spouse.a].append(spouse.b)
                self.spouses_of[spouse.b].append(spouse.a)
                if spouse.order is not None:
                    self.marriage_order[frozenset((spouse.a, spouse.b))] = spouse.order
        # Parents of the same child belong together, married or not.
        for parents_of_child in self.parents_of.values():
            for parent in parents_of_child:
                self.neighbours[parent].update(p for p in parents_of_child if p != parent)
        # How many clusters hang off each person, across every set of rings: a cluster's own
        # cluster can hang off the same person, and each needs an id of its own.
        self.clusters_at: dict[str, int] = defaultdict(int)

    # --- Small helpers -------------------------------------------------------------------

    def sort_key(self, person: str) -> tuple[int, str, str]:
        member = self.members[person]
        year = member.birth.year if member.birth and member.birth.year else _LAST
        return year, member.name.casefold(), person

    def components(self, people: set[str]) -> list[set[str]]:
        """Groups of people joined by links, using only links inside `people`."""
        seen: set[str] = set()
        groups = []
        for start in sorted(people):
            if start in seen:
                continue
            group, queue = {start}, deque([start])
            seen.add(start)
            while queue:
                for neighbour in self.neighbours[queue.popleft()]:
                    if neighbour in people and neighbour not in seen:
                        seen.add(neighbour)
                        group.add(neighbour)
                        queue.append(neighbour)
            groups.append(group)
        return groups

    def families(self, person: str, group: set[str]) -> list[tuple[str | None, list[str]]]:
        """A person's families, in order: (the other parent or spouse, their children)."""
        by_partner: dict[str | None, list[str]] = defaultdict(list)
        for child in self.children_of[person]:
            if child not in group:
                continue
            others = [p for p in self.parents_of[child] if p != person and p in group]
            by_partner[min(others, key=self.sort_key) if others else None].append(child)
        for spouse in self.spouses_of[person]:
            if spouse in group:
                by_partner.setdefault(spouse, [])

        def key(item: tuple[str | None, list[str]]) -> tuple[int, int, tuple[int, str, str]]:
            partner, children = item
            married = self.marriage_order.get(frozenset((person, partner or "")), _LAST)
            eldest = min((self.sort_key(child)[0] for child in children), default=_LAST)
            return married, eldest, self.sort_key(partner) if partner else (_LAST, "", "")

        return sorted(by_partner.items(), key=key)

    def depths(self, group: set[str]) -> dict[str, int]:
        """Generations below each person, counting only children inside `group`."""
        depth: dict[str, int] = {}
        for start in group:
            stack = [(start, False)]
            while stack:
                person, expanded = stack.pop()
                if person in depth:
                    continue
                children = [c for c in self.children_of[person] if c in group]
                if expanded or not children:
                    depth[person] = 1 + max((depth.get(c, 0) for c in children), default=-1)
                    continue
                stack.append((person, True))
                # A cycle can't be stored (the rules refuse one); `depth` guards anyway.
                stack.extend((c, False) for c in children if c not in depth)
        return depth

    def oldest(self, candidates: set[str], group: set[str]) -> str:
        """The top of the longest line of descent: D2's epicentre."""
        roots = [p for p in candidates if not any(q in group for q in self.parents_of[p])]
        pool = roots or sorted(candidates)
        depth = self.depths(group)
        deepest = max(depth[p] for p in pool)
        tied = [p for p in pool if depth[p] == deepest]
        if len(tied) == 1:
            return tied[0]

        def descendants(person: str) -> int:
            seen, queue = {person}, deque([person])
            while queue:
                for child in self.children_of[queue.popleft()]:
                    if child in group and child not in seen:
                        seen.add(child)
                        queue.append(child)
            return len(seen)

        def rank(person: str) -> tuple[int, int, int, tuple[int, str, str]]:
            member = self.members[person]
            male_first = 0 if member.gender is Gender.MALE else 1
            return -descendants(person), self.sort_key(person)[0], male_first, self.sort_key(person)

        return min(tied, key=rank)

    def topological(self, people: set[str]) -> list[str]:
        """Parents before children (Kahn's algorithm)."""
        waiting = {p: sum(1 for q in self.parents_of[p] if q in people) for p in people}
        queue = deque(sorted((p for p, n in waiting.items() if n == 0), key=self.sort_key))
        order = []
        while queue:
            person = queue.popleft()
            order.append(person)
            for child in self.children_of[person]:
                if child in waiting:
                    waiting[child] -= 1
                    if waiting[child] == 0:
                        queue.append(child)
        return order + sorted(people - set(order), key=self.sort_key)

    def branches(
        self,
        root: str,
        descendants: set[str],
        placed_under: dict[str, str | None],
        kids_of: dict[str, set[str]],
    ) -> dict[str, str | None]:
        """Where each line's colour starts: at the children of the first person whose
        family splits into two or more lines that go on. Above that there's a single line,
        and one colour for nearly everyone would say nothing. No split: the centre's children.
        """
        fork = root
        while len(lines := [child for child in kids_of[fork] if kids_of[child]]) == 1:
            fork = lines[0]
        if len(lines) < 2:
            fork = root
        branch: dict[str, str | None] = {}
        for person in self.topological(descendants):
            parent = placed_under[person]
            if parent is None:
                branch[person] = None
            elif parent == fork:
                branch[person] = person
            else:
                branch[person] = branch[parent]
        return branch

    def in_birth_order(self, children: list[str]) -> list[str]:
        siblings = [
            Sibling(c, m.gender, m.birth, m.birth_order, "|".join(map(str, self.sort_key(c))))
            for c, m in ((c, self.members[c]) for c in children)
        ]
        ordered, _ = order_siblings(siblings)
        return [sibling.id for sibling in ordered]

    # --- Seating one set of rings ------------------------------------------------------------

    def seat_unit(
        self,
        group: set[str],
        unit_id: str,
        centre: str | None,
        anchor: str | None,
        seating: Seating,
    ) -> None:
        root = centre or self.oldest(group - {anchor} if anchor else group, group)

        # The centre's line of descent, and everyone partnered with someone in it.
        descendants = {root}
        partner_of: dict[str, str] = {}
        queue = deque([root])
        while queue:
            person = queue.popleft()
            for child in self.children_of[person]:
                if child in group and child not in descendants:
                    descendants.add(child)
                    partner_of.pop(child, None)  # married a cousin: seated by descent
                    queue.append(child)
            for partner, _ in self.families(person, group):
                if partner and partner not in descendants and partner not in partner_of:
                    partner_of[partner] = person

        generation: dict[str, int] = {}
        for person in self.topological(descendants):
            placed = [generation[p] for p in self.parents_of[person] if p in generation]
            generation[person] = max(placed, default=0) + 1

        def ring_parent(child: str) -> str | None:
            """The parent a child hangs from: the one further out, then the father."""
            candidates = [p for p in self.parents_of[child] if p in descendants]
            if child == root or not candidates:
                return None
            return min(
                candidates,
                key=lambda p: (
                    -generation[p],
                    self.members[p].gender is not Gender.MALE,
                    self.sort_key(p),
                ),
            )

        placed_under: dict[str, str | None] = {p: ring_parent(p) for p in descendants}
        kids_of: dict[str, set[str]] = defaultdict(set)
        for person, parent in placed_under.items():
            if parent is not None:
                kids_of[parent].add(person)
        order: dict[str, int] = {root: 0}
        partner_rank: dict[str, int] = {}
        for person in descendants:
            position = 0
            for rank, (partner, children) in enumerate(self.families(person, group)):
                if partner is not None and partner_of.get(partner) == person:
                    partner_rank[partner] = rank
                for child in self.in_birth_order([c for c in children if c in kids_of[person]]):
                    order[child] = position
                    position += 1
        branch = self.branches(root, descendants, placed_under, kids_of)

        seats = {
            person: Seat(
                unit_id,
                generation[person],
                placed_under[person],
                order.get(person, 0),
                None,
                branch[person],
            )
            for person in descendants
        }
        for partner, person in partner_of.items():
            seats[partner] = Seat(
                unit_id,
                generation[person],
                None,
                partner_rank.get(partner, len(partner_rank)),
                person,
                branch[person],
            )

        anchor_seat = seats.pop(anchor, None) if anchor else None
        # Not the anchor, who sits on the rings the cluster hangs from: a wife whose first
        # husband and their son hang off her is her first husband's partner here too.
        centre_partners = sorted(
            (p for p, person in partner_of.items() if person == root and p in seats),
            key=lambda p: seats[p].order,
        )
        seating.units.append(
            Unit(unit_id, (root, *centre_partners), anchor, anchor_seat, size=len(seats))
        )
        seating.seats.update(seats)

        # Everyone left hangs off the rings in a cluster: a wife's parents and siblings, say.
        seated = set(seats) | ({anchor} if anchor else set())
        rest = group - seated
        clusters_at = self.clusters_at
        for part in sorted(self.components(rest), key=lambda g: (-len(g), min(g))):
            touching = {n for p in part for n in self.neighbours[p] if n in seated}
            hook = min(
                touching,
                key=lambda p: (
                    p not in partner_of,  # a wife's family hangs off her, not her husband
                    seats[p].generation if p in seats else _LAST,
                    self.sort_key(p),
                ),
            )
            clusters_at[hook] += 1
            suffix = f":{clusters_at[hook]}" if clusters_at[hook] > 1 else ""
            self.seat_unit(part | {hook}, f"cluster:{hook}{suffix}", None, hook, seating)
