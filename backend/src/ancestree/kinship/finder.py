"""Every way two people are related, both ways round, with the path to highlight.

The order of preference: a direct marriage, then blood (closest first), then in-law
and step relations, then a chain. The others are the "Also related as..." lines.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from ancestree.domain.person import Gender
from ancestree.kinship.blood import BloodTie, blood_ties, seniority
from ancestree.kinship.explain import Explanation, explain_blood, explain_route
from ancestree.kinship.family import Family
from ancestree.kinship.kin import (
    Blood,
    Chain,
    Compound,
    Kin,
    KindSibling,
    KindStep,
    Spouse,
    blood_kin,
    combine,
    generations,
    pieces,
    route_kin,
)
from ancestree.kinship.routes import Move, Step, short_routes, shortest_routes
from ancestree.kinship.terms import TermBook
from ancestree.lineage.birth_order import compare_births

# The longest in-law and step shapes take 4 steps: enough to find the relations a closer tie hides.
SHORT_ROUTE = 4

type RelationType = Literal["marriage", "blood", "in_law", "step", "kind", "chain"]


@dataclass(frozen=True)
class Said:
    """A statement in one kinship language: its word, and the sentence with it. The
    sentence stays English in every language: "Hassan is Ali's pak long". `english`
    says the language had no word, so the English one stands in."""

    term: str
    sentence: str
    english: bool = False


@dataclass(frozen=True)
class Statement:
    term: str  # "first cousin once removed"
    sentence: str  # "Siti is Ali's first cousin once removed"
    detail: str | None = None  # "his mother's first cousin; one generation above him"
    kin: Kin | None = None  # the relation itself, e.g. to find it in the dictionary
    words: Mapping[str, Said] = field(default_factory=dict)  # "en", "ms", "jv"


@dataclass(frozen=True)
class Relation:
    type: RelationType
    forward: Statement  # B, as seen from A
    reverse: Statement  # A, as seen from B
    generations: int  # how many generations above A that B is; negative for below
    shared_ancestors: tuple[str, ...]  # blood relatives: the nearest shared ancestors
    path: tuple[str, ...]  # from A to B
    links: tuple[str, ...]  # the links along the path
    explanation: Explanation | None = None  # "What does this mean?", with names


def relate(
    family: Family, a: str, b: str, english: TermBook, books: Mapping[str, TermBook] | None = None
) -> list[Relation]:
    """How B is related to A, closest first; empty if there's no recorded link. Each
    statement is said in every language of `books` ("en", "ms", "jv")."""
    books = books if books is not None else {"en": english}
    if a == b or a not in family.members or b not in family.members:
        return []
    found: list[Relation] = []
    if marriage := family.marriage(a, b):
        found.append(_route_relation(family, a, [Step("=", b, marriage.id)], english, books))
    found += [
        _blood_relation(family, a, b, tie, english, books) for tie in blood_ties(family, a, b)
    ]
    if found:
        # What a closer tie hides: a cousin who is also a sister-in-law, a grandmother who
        # adopted you. Only relations with a name; chains would just be noise.
        for route in short_routes(family, a, b, SHORT_ROUTE):
            if isinstance(route_kin(family, a, route), Compound | KindStep | KindSibling):
                found.append(_route_relation(family, a, route, english, books))
    elif routes := shortest_routes(family, a, b):
        best = min(routes, key=lambda route: _route_score(family, a, route))
        found.append(_route_relation(family, a, best, english, books))
    unique: dict[str, Relation] = {}
    for relation in found:
        unique.setdefault(relation.forward.sentence, relation)
    return list(unique.values())


def _route_score(family: Family, a: str, route: list[Step]) -> tuple[object, ...]:
    """Among equally short routes, the one that says it best: the fewest pieces, birth links
    before other kinds, unknown parents last, then a stable order."""
    parts = combine(family, pieces(family, a, route))
    unusual = sum(step.move != "=" and not family.is_blood(step.kind) for step in route)
    unknown = sum(family.members[step.to].placeholder for step in route)
    return len(parts), unusual, unknown, [family.order_key(step.to) for step in route]


# --- Building relations -------------------------------------------------------------------


def _blood_relation(
    family: Family,
    a: str,
    b: str,
    tie: BloodTie,
    english: TermBook,
    books: Mapping[str, TermBook],
) -> Relation:
    back = tie.reversed()
    return Relation(
        "blood",
        _statement(
            family,
            a,
            b,
            blood_kin(family, a, b, tie),
            _blood_detail(family, english, a, b, tie),
            english,
            books,
        ),
        _statement(
            family,
            b,
            a,
            blood_kin(family, b, a, back),
            _blood_detail(family, english, b, a, back),
            english,
            books,
        ),
        tie.up - tie.down,
        tie.ancestors if tie.up and tie.down else (),
        tie.path,
        tie.links,
        explain_blood(family, english, a, b, tie),
    )


def _route_relation(
    family: Family, a: str, route: list[Step], english: TermBook, books: Mapping[str, TermBook]
) -> Relation:
    b = route[-1].to
    kin = route_kin(family, a, route)
    back = route_kin(family, b, _reversed(a, route))
    return Relation(
        _type(kin),
        _statement(family, a, b, kin, _route_detail(family, english, a, kin), english, books),
        _statement(family, b, a, back, _route_detail(family, english, b, back), english, books),
        generations(kin),
        (),
        (a, *(step.to for step in route)),
        tuple(step.link for step in route),
        explain_route(family, english, a, route),
    )


def _reversed(a: str, route: list[Step]) -> list[Step]:
    """The same route walked from the other end."""
    people = [a, *(step.to for step in route)]
    flip: dict[Move, Move] = {"u": "d", "d": "u", "=": "="}
    return [
        Step(flip[step.move], people[index], step.link, step.kind)
        for index, step in reversed(list(enumerate(route)))
    ]


def _type(kin: Kin) -> RelationType:
    match kin:
        case Blood():
            return "blood"
        case Spouse():
            return "marriage"
        case Compound(group=group):
            return group
        case KindStep() | KindSibling():
            return "kind"
        case Chain():
            return "chain"


def _statement(
    family: Family,
    a: str,
    b: str,
    kin: Kin,
    detail: str | None,
    english: TermBook,
    books: Mapping[str, TermBook],
) -> Statement:
    """ "Siti is Ali's aunt", and the same in each language: "Siti is Ali's mak su".
    A language with no word for it shows the English one, marked as such."""
    name_a, name_b = family.members[a].name, family.members[b].name

    def sentence(term: str) -> str:
        return english.sentence(name_b, name_a, term) or f"{name_b} is {name_a}'s {term}"

    term = english.term(kin, family.kinds) or "relative"
    words: dict[str, Said] = {}
    for code, book in books.items():
        word = book.term(kin, family.kinds)
        words[code] = Said(word, sentence(word)) if word else Said(term, sentence(term), True)
    return Statement(term, sentence(term), detail, kin, words)


# --- Details, in English ------------------------------------------------------------------


def _his(gender: Gender) -> str:
    return {Gender.MALE: "his", Gender.FEMALE: "her"}.get(gender, "their")


def _him(gender: Gender) -> str:
    return {Gender.MALE: "him", Gender.FEMALE: "her"}.get(gender, "them")


_NUMBERS = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")


def _generations_apart(gap: int, gender: Gender) -> str:
    count = abs(gap)
    number = _NUMBERS[count - 1] if count <= len(_NUMBERS) else str(count)
    noun = "generation" if count == 1 else "generations"
    return f"{number} {noun} {'above' if gap > 0 else 'below'} {_him(gender)}"


def _blood_detail(family: Family, english: TermBook, a: str, b: str, tie: BloodTie) -> str | None:
    """Who they are to each other, through the people in between: "her father's elder
    brother", "his mother's first cousin; one generation above him"."""
    up, down, path = tie.up, tie.down, tie.path
    his = _his(family.gender(a))

    def say(kin: Blood) -> str:
        return english.blood(kin) or "relative"

    def gender(person: str) -> Gender:
        return family.gender(person)

    parts: list[str] = []
    if down == 1 and up >= 2:  # an uncle or aunt: a sibling of A's parent (or grandparent)
        parent = path[up - 1]
        older = seniority(family, b, parent)
        parts.append(
            f"{his} {say(Blood(up - 1, 0, gender(parent)))}'s "
            f"{say(Blood(1, 1, gender(b), seniority=older))}"
        )
    elif up == 1 and down >= 2:  # a nephew or niece: descended from A's brother or sister
        sibling = path[2]
        older = seniority(family, sibling, a)
        parts.append(
            f"{his} {say(Blood(1, 1, gender(sibling), seniority=older))}'s "
            f"{say(Blood(0, down - 1, gender(b)))}"
        )
    elif up == down == 2:
        parent, aunt = path[1], path[3]
        parts.append(
            f"{his} {say(Blood(1, 0, gender(parent)))}'s {say(Blood(1, 1, gender(aunt)))}'s "
            f"{say(Blood(0, 1, gender(b)))}"
        )
    elif up > down >= 2:  # a cousin of A's parent (or grandparent)
        ancestor = path[up - down]
        parts.append(
            f"{his} {say(Blood(up - down, 0, gender(ancestor)))}'s "
            f"{say(Blood(down, down, gender(b)))}"
        )
    elif down > up >= 2:  # a child (or grandchild) of A's cousin
        cousin = path[2 * up]
        parts.append(
            f"{his} {say(Blood(up, up, gender(cousin)))}'s {say(Blood(0, down - up, gender(b)))}"
        )

    gap = up - down
    if gap and up and down:
        age = _age_against_lineage(family, a, b, gap)
        if min(up, down) >= 2 or age:
            parts.append(_generations_apart(gap, family.gender(a)) + (f", {age}" if age else ""))
    return "; ".join(parts) or None


def _age_against_lineage(family: Family, a: str, b: str, gap: int) -> str | None:
    """Lineage decides, never age: say so when the two disagree, like an uncle born
    after his nephew."""
    order = compare_births(family.members[b].birth, family.members[a].birth)
    if gap > 0 and order and order > 0:
        return f"though born after {_him(family.gender(a))}"
    if gap < 0 and order and order < 0:
        return f"though born before {_him(family.gender(a))}"
    return None


def _route_detail(family: Family, english: TermBook, a: str, kin: Kin) -> str | None:
    """For in-laws and step-family, whose: "his wife's brother", "her father's wife"."""
    if not isinstance(kin, Compound):
        return None
    term, pieces_said = english.term(kin, family.kinds), english.chain(kin.parts, family.kinds)
    if not pieces_said or pieces_said == term:
        return None
    return f"{_his(family.gender(a))} {pieces_said}"
