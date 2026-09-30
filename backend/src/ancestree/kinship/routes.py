"""Ways round the family through any link: parents and children of every kind, and
marriages. In-laws, step-family and adoptive relations are found this way."""

from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal

from ancestree.kinship.family import Family

type Move = Literal["u", "d", "="]  # to a parent, to a child, to a spouse

MAX_STEPS = 24  # far beyond any useful answer, but it keeps a search bounded
MAX_ROUTES = 64


@dataclass(frozen=True)
class Step:
    move: Move
    to: str
    link: str  # the link's id, for highlighting
    kind: str | None = None  # parent links: the relationship kind


def steps_from(family: Family, person: str) -> Iterator[Step]:
    for link in family.up[person]:
        yield Step("u", link.parent, link.id, link.kind)
    for link in family.down[person]:
        yield Step("d", link.child, link.id, link.kind)
    for marriage in family.wed[person]:
        yield Step("=", marriage.other(person), marriage.id)


def shortest_routes(family: Family, a: str, b: str) -> list[list[Step]]:
    """Every shortest way from A to B (up to MAX_ROUTES of them); none if unconnected."""
    reached = {a: 0}
    before: dict[str, list[tuple[str, Step]]] = defaultdict(list)
    frontier, depth = [a], 0
    while frontier and b not in reached and depth < MAX_STEPS:
        depth += 1
        found = []
        for person in frontier:
            for step in steps_from(family, person):
                if step.to not in reached:
                    reached[step.to] = depth
                    found.append(step.to)
                if reached[step.to] == depth:
                    before[step.to].append((person, step))
        frontier = found
    if b not in reached:
        return []

    routes: list[list[Step]] = []

    def back(person: str, tail: list[Step]) -> None:
        if len(routes) >= MAX_ROUTES:
            return
        if person == a:
            routes.append(tail[::-1])
            return
        for previous, step in before[person]:
            back(previous, [*tail, step])

    back(b, [])
    return routes


def short_routes(family: Family, a: str, b: str, most: int) -> list[list[Step]]:
    """Every way from A to B in at most `most` steps that never visits anyone twice. For
    the relations a closer tie hides, e.g. a cousin who is also a sister-in-law."""
    routes: list[list[Step]] = []

    def walk(person: str, seen: frozenset[str], taken: list[Step]) -> None:
        if len(routes) >= MAX_ROUTES:
            return
        for step in steps_from(family, person):
            if step.to == b:
                routes.append([*taken, step])
            elif step.to not in seen and len(taken) + 1 < most:
                walk(step.to, seen | {step.to}, [*taken, step])

    walk(a, frozenset({a}), [])
    return sorted(routes, key=len)
