"""What a relationship is, as a structure that any language can put into words.

A route through the family is cut into pieces: a stretch of blood relation (up m
generations, down n), a marriage, or a parent or child of another kind (adoptive,
foster...). Known combinations become one relation, e.g. a spouse's parent is a
parent-in-law; anything else is said as a chain: "stepmother's younger brother".
"""

from dataclasses import dataclass, field
from typing import Literal

from ancestree.domain.person import Gender
from ancestree.domain.relationship import SpouseStatus
from ancestree.kinship.blood import (
    BloodTie,
    Place,
    Seniority,
    birth_place,
    blood_ties,
    seniority,
)
from ancestree.kinship.family import Family
from ancestree.kinship.routes import Step

type Side = Literal["paternal", "maternal"]


@dataclass(frozen=True)
class Blood:
    """B is A's relative by blood: A climbs `up` generations to the nearest shared ancestor,
    B is `down` below it.

    `seniority` says whether B's line is the elder or the younger: it compares the two
    brothers or sisters just below the shared ancestors, B's side against A's. For a brother
    that is B against A; for an uncle, B against A's parent; for a nephew, B's parent against
    A; for cousins, their parents. `place` is B's own place among B's brothers and sisters.
    """

    up: int
    down: int
    gender: Gender
    # Grandparents and above: the father's or the mother's side. Half-siblings: the side of
    # the parent they share.
    side: Side | None = None
    seniority: Seniority | None = None
    place: Place | None = None
    half: bool = False
    # The same relation in two pieces, for a language with no word for it: a parent's
    # cousin, a cousin's child, a grandparent's brother, a brother's great-grandchild.
    parts: tuple[Blood, ...] = field(default=(), compare=False, repr=False)


@dataclass(frozen=True)
class Spouse:
    gender: Gender
    former: bool = False  # divorced


@dataclass(frozen=True)
class KindStep:
    """A parent or child by a kind other than birth: adoptive father, foster daughter..."""

    kind: str
    upward: bool  # B is A's parent of this kind; otherwise A's child
    gender: Gender


@dataclass(frozen=True)
class KindSibling:
    """A brother or sister through adoption or fostering."""

    kind: str
    gender: Gender
    seniority: Seniority | None = None


@dataclass(frozen=True)
class Compound:
    """An in-law or step relation. `key` is its shape: "=u" is a spouse's parent,
    "u=" a parent's spouse. `parts` say the same thing piece by piece, for a language
    without a single word for it.

    Some words follow the blood relative inside: Malay abang ipar or adik ipar by
    the sibling in between, and Mak Long for Pak Long's wife. `seniority` and `place` are
    that relative's; for step-brothers and sisters, `seniority` compares their ages."""

    key: str
    group: Literal["in_law", "step"]
    gender: Gender
    former: bool
    parts: tuple[Kin, ...]
    seniority: Seniority | None = None
    place: Place | None = None


@dataclass(frozen=True)
class Chain:
    """Anything else, said piece by piece: "wife's cousin's son"."""

    parts: tuple[Kin, ...]


type Kin = Blood | Spouse | KindStep | KindSibling | Compound | Chain


@dataclass(frozen=True)
class Piece:
    kin: Kin
    start: str
    end: str
    shape: str  # "m,n" for blood, "=" for a marriage, "" for anything else
    size: int  # how many steps of the route it covers


# The in-law and step relations, by the shapes of their pieces. Longest first.
COMPOUNDS: tuple[tuple[str, Literal["in_law", "step"], tuple[str, ...]], ...] = (
    ("=ud=", "in_law", ("=", "1,1", "=")),  # spouse's sibling's spouse
    ("d=u", "in_law", ("0,1", "=", "1,0")),  # child's spouse's parent
    ("u=d", "step", ("1,0", "=", "0,1")),  # stepbrother, stepsister
    ("uud=", "in_law", ("2,1", "=")),  # uncle or aunt by marriage
    ("dd=", "in_law", ("0,2", "=")),  # grandchild's spouse
    ("=ud", "in_law", ("=", "1,1")),  # spouse's sibling
    ("ud=", "in_law", ("1,1", "=")),  # sibling's spouse
    ("==", "in_law", ("=", "=")),  # a spouse's other spouse: a co-wife
    ("=u", "in_law", ("=", "1,0")),  # parent-in-law
    ("d=", "in_law", ("0,1", "=")),  # child-in-law
    ("u=", "step", ("1,0", "=")),  # stepparent
    ("=d", "step", ("=", "0,1")),  # stepchild
)


def side_of(family: Family, parent: str) -> Side | None:
    gender = family.gender(parent)
    if gender is Gender.MALE:
        return "paternal"
    if gender is Gender.FEMALE:
        return "maternal"
    return None


def blood_kin(family: Family, a: str, b: str, tie: BloodTie) -> Blood:
    """How B is related to A by blood through `tie`, with everything a term may depend on."""
    up, down = tie.up, tie.down
    side = side_of(family, tie.path[1]) if up >= 2 and down == 0 else None
    older: Seniority | None = None
    if up and down and tie.via_a and tie.via_b:
        # Whose line is the elder: the siblings just below the shared ancestors.
        older = seniority(family, tie.via_b, tie.via_a)
    place = birth_place(family, b) if down == 1 and up >= 1 else None
    half = (
        # Half only when both have two recorded parents and share exactly one.
        up == 1
        and down == 1
        and len(tie.ancestors) == 1
        and len(family.blood_parents(a)) == 2
        and len(family.blood_parents(b)) == 2
    )
    if half:
        side = side_of(family, tie.ancestors[0])
    return Blood(up, down, family.gender(b), side, older, place, half, _in_two(family, a, b, tie))


def _in_two(family: Family, a: str, b: str, tie: BloodTie) -> tuple[Blood, ...]:
    """The relation in two pieces, where languages often have no single word: a
    parent's cousin, a cousin's child, a grandparent's brother, a brother's grandchild's
    child. Cut where the pieces are words: at the cousin's generation, or at a sibling."""
    up, down, path = tie.up, tie.down, tie.path
    if up >= 2 and down >= 2 and up != down:
        cut = up - down if up > down else 2 * up  # A's ancestor, or A's cousin
    elif down == 1 and up >= 3:
        cut = up - 1  # A's ancestor, whose brother or sister B is
    elif up == 1 and down >= 3:
        cut = 2  # A's brother or sister, whose descendant B is
    else:
        return ()
    middle = path[cut]
    first = _sub_tie(tie, 0, cut, (middle,) if cut <= up else tie.ancestors)
    second = _sub_tie(tie, cut, len(path) - 1, (middle,) if cut >= up else tie.ancestors)
    return (
        blood_kin(family, a, middle, first),
        blood_kin(family, middle, b, second),
    )


def _sub_tie(tie: BloodTie, start: int, end: int, ancestors: tuple[str, ...]) -> BloodTie:
    """The stretch of a tie from path[start] to path[end]."""
    top = tie.up  # the index of the shared ancestor on the path
    up = max(0, min(end, top) - start)
    down = max(0, end - max(start, top))
    return BloodTie(up, down, ancestors, tie.path[start : end + 1], tie.links[start:end])


def pieces(family: Family, a: str, route: list[Step]) -> list[Piece]:
    """Cut a route into pieces: blood stretches, marriages, and other kinds of link."""
    found: list[Piece] = []
    here, i = a, 0
    while i < len(route):
        step = route[i]
        following = route[i + 1] if i + 1 < len(route) else None
        if (
            step.move == "u"
            and following is not None
            and following.move == "d"
            and not (family.is_blood(step.kind) and family.is_blood(following.kind))
            and family.makes_family(step.kind)
            and family.makes_family(following.kind)
        ):
            # Up to a parent and down to another of their children, one of them adopted or
            # fostered: an adoptive or foster brother or sister.
            kind = following.kind if family.is_blood(step.kind) else step.kind
            end = following.to
            found.append(
                Piece(
                    KindSibling(kind or "", family.gender(end), seniority(family, end, here)),
                    here,
                    end,
                    "",
                    2,
                )
            )
            here, i = end, i + 2
        elif step.move == "=":
            marriage = family.marriage(here, step.to)
            former = marriage is not None and marriage.status is SpouseStatus.DIVORCED
            found.append(Piece(Spouse(family.gender(step.to), former), here, step.to, "=", 1))
            here, i = step.to, i + 1
        elif not family.is_blood(step.kind):
            other = KindStep(step.kind or "", step.move == "u", family.gender(step.to))
            found.append(Piece(other, here, step.to, "", 1))
            here, i = step.to, i + 1
        else:
            # A blood stretch: up as far as it goes, then down.
            j = i
            while j < len(route) and route[j].move == "u" and family.is_blood(route[j].kind):
                j += 1
            while j < len(route) and route[j].move == "d" and family.is_blood(route[j].kind):
                j += 1
            end = route[j - 1].to
            ties = blood_ties(family, here, end)
            if ties:
                blood = blood_kin(family, here, end, ties[0])
            else:  # can't happen for a blood stretch, but never guess
                ups = sum(s.move == "u" for s in route[i:j])
                blood = Blood(ups, j - i - ups, family.gender(end))
            found.append(Piece(blood, here, end, f"{blood.up},{blood.down}", j - i))
            here, i = end, j
    return found


def _fits(family: Family, key: str, start: str, end: str) -> bool:
    """A parent's spouse is only a step-parent if they aren't your parent too."""
    if key == "u=":
        return end not in family.parents(start)
    if key == "=d":
        return end not in family.children(start)
    if key == "u=d":
        return not family.parents(start) & family.parents(end)
    return True


def combine(family: Family, found: list[Piece]) -> list[Kin]:
    """Known combinations become one relation. Of all the ways to group the pieces, the one
    with the fewest parts wins, then the one whose longest part is shortest: "Ali is Kamal's
    sister's stepson" rather than "brother-in-law's son"."""
    best: dict[int, tuple[tuple[int, int], list[Kin]]] = {len(found): ((0, 0), [])}
    for i in reversed(range(len(found))):
        options: list[tuple[int, Kin, int]] = []  # (next piece, the relation, steps it covers)
        for key, group, shapes in COMPOUNDS:
            chunk = found[i : i + len(shapes)]
            if tuple(p.shape for p in chunk) != shapes:
                continue
            if not _fits(family, key, chunk[0].start, chunk[-1].end):
                continue
            former = any(isinstance(p.kin, Spouse) and p.kin.former for p in chunk)
            gender = family.gender(chunk[-1].end)
            # Words that follow the blood relative inside: the sibling or uncle in between.
            blood = next(
                (p.kin for p in chunk if isinstance(p.kin, Blood) and p.kin.up and p.kin.down),
                None,
            )
            older = blood.seniority if blood else None
            if key == "u=d":  # step-brothers and sisters: by age
                older = seniority(family, chunk[-1].end, chunk[0].start)
            compound = Compound(
                key,
                group,
                gender,
                former,
                tuple(p.kin for p in chunk),
                older,
                blood.place if blood else None,
            )
            options.append((i + len(shapes), compound, sum(p.size for p in chunk)))
        options.append((i + 1, found[i].kin, found[i].size))
        scored = []
        for after, kin, size in options:
            (count, longest), rest = best[after]
            scored.append(((count + 1, max(longest, size)), [kin, *rest]))
        best[i] = min(scored, key=lambda option: option[0])  # ties: compounds, longest first
    return best[0][1]


def route_kin(family: Family, a: str, route: list[Step]) -> Kin:
    parts = combine(family, pieces(family, a, route))
    return parts[0] if len(parts) == 1 else Chain(tuple(parts))


def generations(kin: Kin) -> int:
    """How many generations above A the relative is; negative for below."""
    match kin:
        case Blood(up=up, down=down):
            return up - down
        case KindStep(upward=upward):
            return 1 if upward else -1
        case Compound(parts=parts) | Chain(parts=parts):
            return sum(generations(part) for part in parts)
        case _:
            return 0
