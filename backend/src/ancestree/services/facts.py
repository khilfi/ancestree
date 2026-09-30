"""Family facts: the whole family at a glance, worked out from the
same rows as the tree, beside the seating. Each fact names its people by id, so the app
can open them. Quick for 2,000 people: the costly ones (the longest chain, the farthest cousins)
are found without comparing everyone with everyone.
"""

import asyncio
import re
from collections import Counter, defaultdict, deque
from collections.abc import Iterable, Mapping, Sequence
from datetime import date
from statistics import mean
from typing import Any
from uuid import UUID

from ancestree.domain.dates import MONTH_NAMES, describe_partial_date, year_of, years_between
from ancestree.domain.facts import (
    Anniversary,
    Counts,
    DecadeCount,
    Descendants,
    FactPerson,
    FamilyFacts,
    GenerationCount,
    NameCount,
    Pair,
    Parents,
    PersonDate,
    PersonYears,
    SiblingGroup,
    ToFillIn,
)
from ancestree.domain.graph import GraphLayout
from ancestree.domain.person import DateQualifier, Gender, PartialDate
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind
from ancestree.kinship.blood import climb
from ancestree.kinship.family import Family as KinFamily
from ancestree.kinship.family import short_name
from ancestree.kinship.finder import relate
from ancestree.kinship.terms import TermBook
from ancestree.lineage.birth_order import Sibling, order_siblings
from ancestree.repo import kinds as kinds_repo
from ancestree.repo.graph import read_family
from ancestree.services.context import Context
from ancestree.services.detail import living_from
from ancestree.services.graph import birth_region, build_graph, date_from_row
from ancestree.services.kinship import family_from_rows
from ancestree.storage.settings import read_tree_settings

EVERYONE_AT_SIZE = 600  # up to this many, the longest chain is found exactly
TOP = 5  # names and places listed

# Words before a name that aren't the name: honorifics and titles. Hereditary names such as
# Wan, Nik or Syed stay: they're part of the name.
_TITLES = {
    "haji", "hajah", "hj", "hjh", "tok", "nenek", "nek", "datuk", "dato", "dato'", "datin",
    "tan", "sri", "puan", "tun", "dr", "prof", "encik", "cik", "allahyarham", "allahyarhamah",
    "arwah",
}  # fmt: skip
_PATRONYMIC = {"bin", "binti", "bte", "bt", "b.", "bt."}


async def family_facts(ctx: Context, today: date | None = None) -> FamilyFacts:
    people, links, in_layout = await read_family(ctx.driver, ctx.database)
    settings = await asyncio.to_thread(read_tree_settings, ctx.data_dir)
    kinds = {k.key: k for k in await kinds_repo.list_relationship_kinds(ctx.driver, ctx.database)}
    return await asyncio.to_thread(
        facts_from_rows, people, links, in_layout, kinds, settings.centre, today or date.today()
    )


def given_name(full_name: str) -> str | None:
    """The first given name: "Siti" for Hajah Siti Aminah binti Hassan."""
    for word in full_name.split():
        cleaned = word.strip('()"“”,.')
        if cleaned.casefold() in _PATRONYMIC:
            return None
        if cleaned and cleaned.casefold() not in _TITLES and re.match(r"\w", cleaned):
            return cleaned[:1].upper() + cleaned[1:]
    return None


class _Family:
    """The rows, read once: names, dates and who is whose."""

    def __init__(
        self,
        people: Sequence[Mapping[str, Any]],
        links: Sequence[Mapping[str, Any]],
        today: date,
    ) -> None:
        self.rows = {str(row["id"]): row for row in people}
        self.real = [pid for pid, row in self.rows.items() if not row.get("placeholder")]
        self.links = links
        self.born = {pid: date_from_row(row, "birth") for pid, row in self.rows.items()}
        self.died = {pid: date_from_row(row, "death") for pid, row in self.rows.items()}
        self.living = {
            pid: living_from(
                row.get("living"), self.born[pid], self.died[pid], this_year=today.year
            )
            for pid, row in self.rows.items()
        }
        self.parents: dict[str, set[str]] = defaultdict(set)  # by birth
        self.children: dict[str, list[str]] = defaultdict(list)
        self.spouses: dict[str, set[str]] = defaultdict(set)
        self.near: dict[str, set[str]] = defaultdict(set)  # linked either way, any link
        for link in links:
            source, target = str(link["source"]), str(link["target"])
            self.near[source].add(target)
            self.near[target].add(source)
            if link["type"] == "spouse":
                self.spouses[source].add(target)
                self.spouses[target].add(source)
            elif (link.get("kind") or BIOLOGICAL) == BIOLOGICAL:
                self.parents[target].add(source)
                self.children[source].append(target)

    def placeholder(self, pid: str) -> bool:
        return bool(self.rows[pid].get("placeholder"))

    def name(self, pid: str) -> str:
        row = self.rows[pid]
        if row.get("placeholder"):
            return "an unknown parent"
        return short_name(str(row["full_name"]), row.get("nickname"))

    def fact(self, pid: str) -> FactPerson:
        return FactPerson(id=UUID(pid), name=self.name(pid))

    def facts(self, ids: Iterable[str]) -> list[FactPerson]:
        return [self.fact(pid) for pid in sorted(ids, key=self.sort_key)]

    def sort_key(self, pid: str) -> tuple[str, str]:
        return self.name(pid).casefold(), pid

    def gender(self, pid: str) -> Gender:
        return Gender(self.rows[pid].get("gender") or Gender.UNKNOWN)


def facts_from_rows(
    people: Sequence[Mapping[str, Any]],
    links: Sequence[Mapping[str, Any]],
    in_layout: Mapping[str, bool],
    kinds: Mapping[str, RelationshipKind],
    centre: UUID | None,
    today: date,
) -> FamilyFacts:
    family = _Family(people, links, today)
    layout = build_graph(people, links, in_layout, centre).layout
    kin = family_from_rows(people, links, kinds)
    english = TermBook.load("en")

    def term(a: str, b: str) -> str | None:
        relations = relate(kin, a, b, english)
        blood = [r for r in relations if r.type == "blood"]
        return (blood or relations)[0].forward.term if relations else None

    oldest, youngest, span = _births(family)
    longest_life, average, lives = _lives(family)
    chain = _longest_chain(family)
    farthest = _farthest_by_blood(family)
    return FamilyFacts(
        counts=Counts(
            people=len(family.real),
            links=len(links),
            couples=sum(1 for link in links if link["type"] == "spouse"),
            unknown_parents=len(family.rows) - len(family.real),
            families=sum(1 for unit in layout.units if unit.anchor is None),
            unlinked=len(layout.unlinked),
        ),
        generations=_generations(family, layout),
        oldest=oldest,
        youngest=youngest,
        span_years=span[0] if span else None,
        span_about=span[1] if span else False,
        longest_life=longest_life,
        average_life=average,
        lives_known=lives,
        oldest_living=_oldest_living(family, today),
        biggest_family=_biggest_family(family),
        most_descendants=_most_descendants(family),
        longest_chain=Pair(a=family.fact(chain[0]), b=family.fact(chain[1]), links=chain[2])
        if chain
        else None,
        farthest_by_blood=Pair(
            a=family.fact(farthest[0]),
            b=family.fact(farthest[1]),
            term=term(farthest[0], farthest[1]),
        )
        if farthest
        else None,
        cousins_married=[
            Pair(a=family.fact(a), b=family.fact(b), term=term(a, b))
            for a, b in _cousins_married(family, kin)
        ],
        names=_names(family),
        birthplaces=_birthplaces(family),
        decades=_decades(family),
        month=MONTH_NAMES[today.month - 1],
        this_month=_this_month(family, today),
        to_fill_in=_to_fill_in(family),
    )


def _generations(family: _Family, layout: GraphLayout) -> list[GenerationCount]:
    """People in each generation of the main family, as on the rings. A married-in family
    lines up with the person who married in, as on the timeline."""
    members: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for seated, seat in layout.seats.items():
        members[seat.unit].append((str(seated), seat.generation))
    standing: dict[str, tuple[int, int]] = {}  # person -> (family, generation)
    for unit in layout.units:
        if unit.anchor is None:
            number = int(unit.id.split(":")[-1]) if unit.id.split(":")[-1].isdigit() else 0
            for person, generation in members[unit.id]:
                standing[person] = (number, generation)
            continue
        anchor = standing.get(str(unit.anchor))
        if anchor is None:
            continue
        shift = anchor[1] - (unit.anchor_seat.generation if unit.anchor_seat else anchor[1])
        for person, generation in members[unit.id]:
            standing[person] = (anchor[0], generation + shift)
    counts = Counter(
        generation
        for person, (number, generation) in standing.items()
        if number == 0 and person in family.rows and not family.placeholder(person)
    )
    return [GenerationCount(generation=g, people=n) for g, n in sorted(counts.items())]


def _births(
    family: _Family,
) -> tuple[PersonDate | None, PersonDate | None, tuple[int, bool] | None]:
    dated = {pid: born for pid in family.real if (born := family.born[pid]) is not None}
    if not dated:
        return None, None, None

    def when(pid: str) -> tuple[float, tuple[str, str]]:
        return year_of(dated[pid]), family.sort_key(pid)

    first, last = min(dated, key=when), max(dated, key=when)
    born_first, born_last = dated[first], dated[last]
    return (
        PersonDate(person=family.fact(first), date=describe_partial_date(born_first)),
        PersonDate(person=family.fact(last), date=describe_partial_date(born_last)),
        years_between(born_first, born_last) if first != last else None,
    )


def _lives(family: _Family) -> tuple[PersonYears | None, int | None, int]:
    lives: dict[str, tuple[int, bool]] = {}
    for pid in family.real:
        born, died = family.born[pid], family.died[pid]
        if born and died and (span := years_between(born, died)):
            lives[pid] = span
    if not lives:
        return None, None, 0
    longest = max(lives, key=lambda pid: (lives[pid][0], not lives[pid][1]))
    years, about = lives[longest]
    return (
        PersonYears(person=family.fact(longest), years=years, about=about),
        round(mean(span[0] for span in lives.values())),
        len(lives),
    )


def _oldest_living(family: _Family, today: date) -> PersonYears | None:
    now = PartialDate(year=today.year, month=today.month, day=today.day)
    ages: dict[str, tuple[int, bool]] = {}
    for pid in family.real:
        born = family.born[pid]
        alive = family.living[pid] and family.died[pid] is None
        if alive and born and (span := years_between(born, now)):
            ages[pid] = span
    if not ages:
        return None
    oldest = max(ages, key=lambda pid: (ages[pid][0], -year_of(family.born[pid] or now)))
    return PersonYears(person=family.fact(oldest), years=ages[oldest][0], about=ages[oldest][1])


def _sibling_groups(family: _Family) -> dict[frozenset[str], list[str]]:
    """Children by birth, grouped by their parents."""
    groups: dict[frozenset[str], list[str]] = defaultdict(list)
    for child, parents in family.parents.items():
        if child in family.rows:
            groups[frozenset(parents)].append(child)
    return groups


def _biggest_family(family: _Family) -> Parents | None:
    groups = [
        (parents, children)
        for parents, children in _sibling_groups(family).items()
        if any(not family.placeholder(p) for p in parents if p in family.rows)
    ]
    if not groups:
        return None
    parents, children = max(
        groups, key=lambda group: (len(group[1]), [family.name(p) for p in sorted(group[0])])
    )
    return Parents(
        parents=family.facts(p for p in parents if not family.placeholder(p)),
        children=len(children),
    )


def _most_descendants(family: _Family) -> Descendants | None:
    """Someone at the top of a line has more descendants than anyone below them, so only
    those without parents are counted."""
    best: tuple[int, int, str] | None = None  # (descendants, generations, person)
    counted: dict[str, tuple[int, int]] = {}
    for root in family.real:
        if family.parents.get(root):
            continue
        depth = {root: 0}
        queue = deque([root])
        while queue:
            person = queue.popleft()
            for child in family.children.get(person, []):
                if child not in depth:
                    depth[child] = depth[person] + 1
                    queue.append(child)
        counted[root] = (len(depth) - 1, max(depth.values()))
        key = (counted[root][0], counted[root][1], root)
        if best is None or (key[0], key[1]) > (best[0], best[1]):
            best = key
    if best is None or best[0] == 0:
        return None
    count, generations, person = best
    # A couple at the top shares their descendants: both are named.
    partners = [p for p in family.spouses.get(person, ()) if counted.get(p) == (count, generations)]
    people = [person, *partners[:1]]
    return Descendants(
        people=[
            family.fact(p) for p in sorted(people, key=lambda p: family.gender(p) != Gender.MALE)
        ],
        count=count,
        generations=generations,
    )


def _distances(family: _Family, start: str) -> dict[str, int]:
    distance = {start: 0}
    queue = deque([start])
    while queue:
        person = queue.popleft()
        for other in family.near.get(person, ()):
            if other not in distance:
                distance[other] = distance[person] + 1
                queue.append(other)
    return distance


def _longest_chain(family: _Family) -> tuple[str, str, int] | None:
    """The two people furthest apart by links (unknown parents can be on the way, but not at
    the ends). Exact for a family your size; at 2,000, two sweeps from each end find it for a
    tree and come close otherwise."""
    real = set(family.real)

    def farthest(start: str) -> tuple[int, str]:
        distance = _distances(family, start)
        return max(
            ((d, p) for p, d in distance.items() if p in real and p != start),
            key=lambda item: (item[0], item[1]),
            default=(0, start),
        )

    best: tuple[int, str, str] | None = None
    if len(family.rows) <= EVERYONE_AT_SIZE:
        for person in sorted(real):
            links, other = farthest(person)
            if links and (best is None or links > best[0]):
                best = (links, person, other)
    else:
        seen: set[str] = set()
        for person in sorted(real):
            if person in seen:
                continue
            seen |= set(_distances(family, person))
            _, first = farthest(person)
            links, second = farthest(first)
            again, third = farthest(second)
            if again > links:
                links, first, second = again, second, third
            if links and (best is None or links > best[0]):
                best = (links, first, second)
    if best is None:
        return None
    links, a, b = best
    a, b = sorted((a, b), key=lambda pid: year_of(family.born[pid] or PartialDate(year=9999)))
    return a, b, links


def _farthest_by_blood(family: _Family) -> tuple[str, str] | None:
    """The two blood relatives furthest apart: cousins of the highest degree, then the most
    times removed. For each ancestor, the deepest descendants down two different children."""
    deepest: dict[str, tuple[int, str]] = {}

    def deep(person: str) -> tuple[int, str]:
        if person not in deepest:
            best = (0, person)
            for child in family.children.get(person, []):
                depth, who = deep(child)
                best = max(best, (depth + 1, who), key=lambda item: (item[0], item[1]))
            deepest[person] = best
        return deepest[person]

    best: tuple[tuple[int, int], str, str] | None = None
    for ancestor in family.rows:
        branches = sorted(
            {
                deep(child)[1]: deep(child)[0] + 1 for child in family.children.get(ancestor, [])
            }.items(),
            key=lambda item: (-item[1], item[0]),
        )
        if len(branches) < 2:
            continue
        (far, far_depth), (near, near_depth) = branches[0], branches[1]
        if far == near or family.placeholder(far) or family.placeholder(near):
            continue
        score = (near_depth, far_depth - near_depth)
        if best is None or score > best[0]:
            best = (score, near, far)
    return (best[1], best[2]) if best else None


def _cousins_married(family: _Family, kin: KinFamily) -> list[tuple[str, str]]:
    """Couples who are also related by blood: they share an ancestor."""
    couples: list[tuple[str, str]] = []
    for link in family.links:
        if link["type"] != "spouse":
            continue
        a, b = str(link["source"]), str(link["target"])
        if family.placeholder(a) or family.placeholder(b):
            continue
        if (set(climb(kin, a).depth) - {a}) & (set(climb(kin, b).depth) - {b}):
            husband, wife = sorted((a, b), key=lambda p: family.gender(p) != Gender.MALE)
            couples.append((husband, wife))
    return sorted(couples, key=lambda pair: family.sort_key(pair[0]))


def _counted(family: _Family, found: Mapping[str, list[str]], least: int) -> list[NameCount]:
    ranked = sorted(found.items(), key=lambda item: (-len(item[1]), item[0].casefold()))
    return [
        NameCount(name=name, people=family.facts(ids))
        for name, ids in ranked[:TOP]
        if len(ids) >= least
    ]


def _names(family: _Family) -> list[NameCount]:
    """Given names shared by two or more: without bin/binti, titles or honorifics."""
    found: dict[str, list[str]] = defaultdict(list)
    spelling: dict[str, str] = {}
    for pid in family.real:
        if name := given_name(str(family.rows[pid]["full_name"])):
            key = name.casefold()
            spelling.setdefault(key, name)
            found[key].append(pid)
    return _counted(family, {spelling[key]: ids for key, ids in found.items()}, least=2)


def _birthplaces(family: _Family) -> list[NameCount]:
    """By state; the town where no state is given; the country outside Malaysia."""
    found: dict[str, list[str]] = defaultdict(list)
    for pid in family.real:
        if place := birth_region(family.rows[pid]):
            found[place].append(pid)
    return _counted(family, found, least=1)


def _decades(family: _Family) -> list[DecadeCount]:
    years = [born.year for pid in family.real if (born := family.born[pid]) and born.year]
    if not years:
        return []
    counts = Counter(year // 10 * 10 for year in years)
    first, last = min(counts), max(counts)
    return [DecadeCount(decade=d, people=counts[d]) for d in range(first, last + 1, 10)]


def _this_month(family: _Family, today: date) -> list[Anniversary]:
    """Birthdays of the living, and the anniversaries of deaths, for dates known to the month."""
    found: list[Anniversary] = []
    for pid in family.real:
        born, died = family.born[pid], family.died[pid]
        if (
            family.living[pid]
            and born
            and born.month == today.month
            and born.qualifier is DateQualifier.EXACT
            and born.year
        ):
            found.append(
                Anniversary(
                    person=family.fact(pid),
                    kind="birthday",
                    day=born.day,
                    date=describe_partial_date(born),
                    years=today.year - born.year,
                )
            )
        if (
            died
            and died.month == today.month
            and died.qualifier is DateQualifier.EXACT
            and died.year
        ):
            found.append(
                Anniversary(
                    person=family.fact(pid),
                    kind="death",
                    day=died.day,
                    date=describe_partial_date(died),
                    years=today.year - died.year,
                )
            )
    return sorted(found, key=lambda a: (a.day or 99, a.person.name.casefold()))


def _to_fill_in(family: _Family) -> ToFillIn:
    groups = []
    for parents, children in _sibling_groups(family).items():
        if len(children) < 2:
            continue
        ordered, decided = order_siblings(
            [
                Sibling(
                    child,
                    family.gender(child),
                    family.born[child],
                    family.rows[child].get("birth_order"),
                    tiebreak=child,
                )
                for child in children
            ]
        )
        if not decided:
            groups.append(
                SiblingGroup(
                    parents=family.facts(p for p in parents if not family.placeholder(p)),
                    children=[family.fact(s.id) for s in ordered],
                )
            )
    return ToFillIn(
        no_gender=family.facts(p for p in family.real if family.gender(p) is Gender.UNKNOWN),
        no_birth_year=family.facts(p for p in family.real if family.born[p] is None),
        no_birth_order=sorted(groups, key=lambda g: [p.name.casefold() for p in g.parents]),
    )
