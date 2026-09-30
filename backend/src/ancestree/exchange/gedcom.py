"""GEDCOM 5.5.1: the family for other genealogy programs, such as Gramps.

What goes in: each person's names (with nickname, title and the name in Jawi), sex, birth,
death, burial, residence, occupation, notes, life story and its Sources; and the families:
couples, marriages and divorces, children in birth order, with adoption and fostering
marked. Unknown parents aren't people in GEDCOM: children who share one stay together in a
family without them. Other kinds of parent, such as a guardian, become associations. Photos
stay in the full archive. Written as UTF-8 with Windows line ends.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from ancestree import __version__
from ancestree.domain.person import DateQualifier, Gender, PartialDate
from ancestree.domain.relationship import SpouseStatus
from ancestree.exchange.family import FamilyData, SpouseRow, place_text
from ancestree.services.detail import is_living

MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
LINE_END = "\r\n"
WIDTH = 200  # characters of text per line, well inside the 255 allowed for a whole line
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_QUALIFIER = {
    DateQualifier.ABOUT: "ABT ",
    DateQualifier.BEFORE: "BEF ",
    DateQualifier.AFTER: "AFT ",
}
_SEX = {Gender.MALE: "M", Gender.FEMALE: "F", Gender.UNKNOWN: "U"}
_PEDIGREE = {"adoptive": "adopted", "foster": "foster"}  # kinds GEDCOM has words for
_ROLE_ORDER = {Gender.MALE: 0, Gender.UNKNOWN: 1, Gender.FEMALE: 2}


def gedcom_date(date: PartialDate) -> str | None:
    """ "12 MAR 1950", "ABT 1950", "BET 1910 AND 1915", or the words as typed: "(in the war)"."""
    if date.year is None:
        phrase = (date.original_text or "").replace("(", "[").replace(")", "]").strip()
        return f"({phrase})" if phrase else None
    if date.qualifier is DateQualifier.BETWEEN:
        return f"BET {date.year} AND {date.year_to}"
    parts = [str(date.day)] if date.day else []
    if date.month:
        parts.append(MONTHS[date.month - 1])
    return _QUALIFIER.get(date.qualifier, "") + " ".join([*parts, str(date.year)])


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    return _CONTROL.sub("", text)


def _cost(text: str) -> int:
    return len(text) + text.count("@")  # every @ is written twice


def chunks(text: str, width: int = WIDTH) -> list[str]:
    """Pieces of at most `width` characters once written, never cut next to a space:
    readers may trim a line's first or last space, and CONC joins pieces with nothing."""
    pieces = []
    while _cost(text) > width:
        cut, cost = 0, 0
        while cost + 1 + (text[cut] == "@") <= width:
            cost += 1 + (text[cut] == "@")
            cut += 1
        good = cut
        while good > 0 and (text[good - 1] == " " or text[good] == " "):
            good -= 1
        if good == 0:
            good = cut  # spaces all the way back: cut where it fits
        pieces.append(text[:good])
        text = text[good:]
    pieces.append(text)
    return pieces


class Lines:
    """GEDCOM lines, with long and multi-line text continued on CONC and CONT lines."""

    def __init__(self) -> None:
        self.lines: list[str] = []

    def add(self, level: int, tag: str, value: str | None = None, *, xref: str = "") -> None:
        head = f"{level} {xref} {tag}" if xref else f"{level} {tag}"
        if value is None:
            self.lines.append(head)
            return
        first, *rest = _clean(value).split("\n")
        self._text(head, level, first)
        for line in rest:
            self._text(f"{level + 1} CONT", level, line)

    def pointer(self, level: int, tag: str, xref: str) -> None:
        self.lines.append(f"{level} {tag} {xref}")

    def _text(self, head: str, level: int, text: str) -> None:
        first, *more = chunks(text)
        self.lines.append(f"{head} {first.replace('@', '@@')}" if first else head)
        self.lines.extend(f"{level + 1} CONC {piece.replace('@', '@@')}" for piece in more)


@dataclass
class _Family:
    parents: tuple[str, ...]  # the known parents, at most two
    children: list[tuple[str, str]] = field(default_factory=list)  # (child, pedigree)
    marriage: SpouseRow | None = None
    xref: str = ""


def write_gedcom(data: FamilyData, *, made_at: datetime, file_name: str) -> str:
    people = data.people()
    ids = {member.id: f"@I{n}@" for n, member in enumerate(people, start=1)}
    rank = {member.id: n for n, member in enumerate(people)}
    known = ids.__contains__

    families: dict[frozenset[str], _Family] = {}

    def family(key: frozenset[str]) -> _Family:
        if key not in families:
            parents = sorted(
                (p for p in key if known(p)),
                key=lambda p: (_ROLE_ORDER[data.members[p].person.gender], rank[p]),
            )
            families[key] = _Family(tuple(parents))
        return families[key]

    by_child: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for parent_link in data.parents:
        by_child[parent_link.child][parent_link.kind].append(parent_link.parent)
    associations: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for child, kinds in by_child.items():
        if not known(child):
            continue
        for kind, parents in kinds.items():
            pedigree = "birth" if data.is_blood(kind) else _PEDIGREE.get(kind)
            if pedigree is None:  # a guardian, say: not a family of their own
                associations[child].extend((p, kind) for p in parents if known(p))
                continue
            ordered = sorted(parents, key=lambda p: rank.get(p, len(rank)))
            for group in [ordered[:2], *([p] for p in ordered[2:])]:
                family(frozenset(group)).children.append((child, pedigree))
    for marriage in data.spouses:
        family(frozenset((marriage.a, marriage.b))).marriage = marriage

    # A family needs someone known in it: a parent, or brothers and sisters.
    kept = [f for f in families.values() if f.parents or len(f.children) > 1]
    for f in kept:
        order = data.eldest_first([child for child, _ in f.children])
        pedigrees = dict(f.children)
        f.children = [(child, pedigrees[child]) for child in order]
    kept.sort(
        key=lambda f: (
            min((rank[p] for p in f.parents), default=len(rank)),
            rank[f.children[0][0]] if f.children else len(rank),
        )
    )
    as_child: dict[str, list[tuple[_Family, str]]] = defaultdict(list)
    as_parent: dict[str, list[_Family]] = defaultdict(list)
    for n, f in enumerate(kept, start=1):
        f.xref = f"@F{n}@"
        for parent in f.parents:
            as_parent[parent].append(f)
        for child, pedigree in f.children:
            as_child[child].append((f, pedigree))

    out = Lines()
    _header(out, made_at, file_name)
    sources: list[str] = []
    for member in people:
        p = member.person
        out.add(0, "INDI", xref=ids[member.id])
        out.add(1, "NAME", p.full_name.replace("/", " "))
        if p.title:
            out.add(2, "NPFX", p.title)
        if p.nickname:
            out.add(2, "NICK", p.nickname)
        if p.name_jawi:
            out.add(1, "NAME", p.name_jawi.replace("/", " "))
            out.add(2, "TYPE", "aka")
        out.add(1, "SEX", _SEX[p.gender])
        _event(out, "BIRT", p.birth_date, place_text(p.birth_place))
        if not _event(out, "DEAT", p.death_date, place_text(p.death_place)) and (
            is_living(p) is False
        ):
            out.add(1, "DEAT", "Y")
        if p.burial_place:
            out.add(1, "BURI")
            out.add(2, "PLAC", p.burial_place)
        if residence := place_text(p.residence):
            out.add(1, "RESI")
            out.add(2, "PLAC", residence)
        if p.occupation:
            out.add(1, "OCCU", p.occupation)
        for f, pedigree in as_child[member.id]:
            out.pointer(1, "FAMC", f.xref)
            out.add(2, "PEDI", pedigree)
        for f in sorted(as_parent[member.id], key=lambda f: _marriage_order(f)):
            out.pointer(1, "FAMS", f.xref)
        for other, kind in associations[member.id]:
            gender = data.members[other].person.gender
            label = data.kinds[kind].parent_label.for_gender(gender) if kind in data.kinds else kind
            out.pointer(1, "ASSO", ids[other])
            out.add(2, "RELA", label[:1].upper() + label[1:])
        if p.notes:
            out.add(1, "NOTE", p.notes)
        if member.story:
            out.add(1, "NOTE", member.story)
        for source in member.sources:
            sources.append(source)
            out.pointer(1, "SOUR", f"@S{len(sources)}@")
        out.add(1, "REFN", member.id)
        out.add(2, "TYPE", "AncesTree")

    for f in kept:
        out.add(0, "FAM", xref=f.xref)
        for role, parent in zip(_roles(f.parents, data), f.parents, strict=True):
            out.pointer(1, role, ids[parent])
        if f.marriage is not None:
            out.add(1, "MARR", "Y")
            if f.marriage.status is SpouseStatus.DIVORCED:
                out.add(1, "DIV", "Y")
        for child, _ in f.children:
            out.pointer(1, "CHIL", ids[child])

    for n, source in enumerate(sources, start=1):
        out.add(0, "SOUR", xref=f"@S{n}@")
        out.add(1, "TITL", source)
    out.add(0, "TRLR")
    return LINE_END.join(out.lines) + LINE_END


def _header(out: Lines, made_at: datetime, file_name: str) -> None:
    out.add(0, "HEAD")
    out.add(1, "SOUR", "ANCESTREE")
    out.add(2, "VERS", __version__)
    out.add(2, "NAME", "AncesTree")
    out.add(1, "DATE", f"{made_at.day} {MONTHS[made_at.month - 1]} {made_at.year}")
    out.add(2, "TIME", f"{made_at:%H:%M:%S}")
    out.pointer(1, "SUBM", "@U1@")
    out.add(1, "FILE", file_name)
    out.add(1, "GEDC")
    out.add(2, "VERS", "5.5.1")
    out.add(2, "FORM", "LINEAGE-LINKED")
    out.add(1, "CHAR", "UTF-8")
    out.add(0, "SUBM", xref="@U1@")
    out.add(1, "NAME", "AncesTree")


def _event(out: Lines, tag: str, date: PartialDate | None, place: str | None) -> bool:
    when = gedcom_date(date) if date else None
    if not when and not place:
        return False
    out.add(1, tag)
    if when:
        out.add(2, "DATE", when)
    if place:
        out.add(2, "PLAC", place)
    return True


def _roles(parents: tuple[str, ...], data: FamilyData) -> list[str]:
    """HUSB, then WIFE: parents come sorted men first and women last. A mother on her own
    is the WIFE."""
    if len(parents) == 2:
        return ["HUSB", "WIFE"]
    if len(parents) == 1:
        woman = data.members[parents[0]].person.gender is Gender.FEMALE
        return ["WIFE" if woman else "HUSB"]
    return []


def _marriage_order(f: _Family) -> int:
    """A person's families: marriages in their order, then the rest."""
    if f.marriage is None:
        return 99
    return f.marriage.order or 50
