"""The Kinship dictionary: every relation's words in English,
Malay and Javanese, for reading and understanding.

The rows are in `terms/dictionary.yaml`. Each row's words come from the word lists exactly as
an answer gets them, so the dictionary and the answers can't disagree. The word lists add
what only the dictionary shows (other words, address words, speech levels, notes) under
`dictionary:`, by row id.
"""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from functools import cache
from importlib import resources
from typing import Any

import yaml

from ancestree.domain.person import Gender
from ancestree.domain.relationship import RelationshipKind
from ancestree.kinship.blood import Place
from ancestree.kinship.kin import Blood, Compound, Kin, KindSibling, KindStep, Spouse
from ancestree.kinship.terms import TermBook

_GENERATIONS = "generations"


@dataclass(frozen=True)
class Word:
    """One language's words for a row."""

    word: str | None  # what the answers say; None when the language has no word for it
    descr: bool = False  # a description rather than an established word
    also: tuple[str, ...] = ()  # formal, everyday, older and regional words
    address: tuple[str, ...] = ()  # what you call them to their face
    krama: str | None = None  # Javanese polite level
    krama_inggil: str | None = None  # Javanese honorific level
    note: str | None = None


@dataclass(frozen=True)
class Row:
    id: str
    relation: str  # in plain English: "A parent's older brother"
    kin: Kin | None  # the relation it stands for; None for rows about words ("family")
    words: Mapping[str, Word] = field(default_factory=dict)  # "en", "ms", "jv"


@dataclass(frozen=True)
class Section:
    id: str
    title: str
    rows: tuple[Row, ...]


def build(
    books: Mapping[str, TermBook], kinds: Mapping[str, RelationshipKind]
) -> tuple[Section, ...]:
    """The whole dictionary, each word as the answers would say it."""
    return tuple(
        Section(
            section["id"],
            section["title"],
            tuple(_row(spec, books, kinds) for spec in _row_specs(section)),
        )
        for section in _file().get("sections") or ()
    )


def row_for(kin: Kin) -> str | None:
    """The dictionary row an answer belongs to, for its "Dictionary" link: the row that
    matches the most of what the answer knows (gender, seniority, place...), else the row
    for the same kind of relation, e.g. a parent's cousin for any removed cousin above."""
    best: tuple[int, str] | None = None
    for row_id, row_kin in _kin_rows():
        score = _match(row_kin, kin)
        if score is not None and (best is None or score > best[0]):
            best = (score, row_id)
    return best[1] if best else _nearest_row(kin)


# --- Building rows --------------------------------------------------------------------------


@cache
def _file() -> Mapping[str, Any]:
    text = resources.files("ancestree.kinship").joinpath("terms/dictionary.yaml").read_text("utf-8")
    data = yaml.safe_load(text)
    return data if isinstance(data, Mapping) else {}


def _row_specs(section: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    if count := section.get(_GENERATIONS):
        # A row for each generation, up and then down: the Javanese names go to 18.
        for n in range(1, int(count) + 1):
            yield {"id": f"up-{n}", "relation": _generation(n, "up"), "kin": {"blood": f"{n},0"}}
        for n in range(1, int(count) + 1):
            yield {
                "id": f"down-{n}",
                "relation": _generation(n, "down"),
                "kin": {"blood": f"0,{n}"},
            }
    else:
        yield from section.get("rows") or ()


def _generation(n: int, direction: str) -> str:
    return f"{n} generation{'' if n == 1 else 's'} {direction}"


def kin_specs() -> list[tuple[str, Mapping[str, Any]]]:
    """Each row that stands for a relation, with the relation as dictionary.yaml gives it:
    what answers are matched to, in order. A view-only copy's engine matches the same."""
    return [
        (str(spec["id"]), spec["kin"])
        for section in _file().get("sections") or ()
        for spec in _row_specs(section)
        if spec.get("kin")
    ]


@cache
def _kin_rows() -> tuple[tuple[str, Kin], ...]:
    return tuple((row_id, kin_from_spec(spec)) for row_id, spec in kin_specs())


def _row(
    spec: Mapping[str, Any], books: Mapping[str, TermBook], kinds: Mapping[str, RelationshipKind]
) -> Row:
    kin = kin_from_spec(spec["kin"]) if spec.get("kin") else None
    words: dict[str, Word] = {}
    for code, book in books.items():
        notes = book.dictionary_notes(str(spec["id"]))
        if kin is not None:
            word = book.term(kin, kinds)
            described = not book.has_word(kin)
        else:
            word = notes.get("word") or None
            described = False
        words[code] = Word(
            word=str(word) if word else None,
            descr=described or bool(notes.get("descr")),
            also=tuple(str(w) for w in notes.get("also") or ()),
            address=tuple(str(w) for w in notes.get("address") or ()),
            krama=_optional(notes.get("krama")),
            krama_inggil=_optional(notes.get("krama_inggil")),
            note=_optional(notes.get("note")),
        )
    return Row(str(spec["id"]), str(spec["relation"]), kin, words)


def _optional(value: object) -> str | None:
    return str(value) if value else None


def kin_from_spec(spec: Mapping[str, Any]) -> Kin:
    """A row's relation, as the finder would describe it (see the top of dictionary.yaml)."""
    gender = Gender(spec.get("gender") or Gender.UNKNOWN)
    seniority = spec.get("seniority")
    place = _place(spec.get("place"))
    parts = tuple(kin_from_spec(part) for part in spec.get("parts") or ())
    if "blood" in spec:
        up, down = (int(n) for n in str(spec["blood"]).split(","))
        pieces = tuple(part for part in parts if isinstance(part, Blood))
        side = spec.get("side")
        return Blood(up, down, gender, side, seniority, place, bool(spec.get("half")), pieces)
    if "marriage" in spec:
        return Spouse(gender, bool(spec.get("former")))
    if "in_law" in spec:
        key = str(spec["in_law"])
        return Compound(key, "in_law", gender, bool(spec.get("former")), parts, seniority, place)
    if "step" in spec:
        key = str(spec["step"])
        return Compound(key, "step", gender, bool(spec.get("former")), parts, seniority, place)
    if "kind" in spec:
        if spec.get("side") == "sibling":
            return KindSibling(str(spec["kind"]), gender, seniority)
        return KindStep(str(spec["kind"]), spec.get("side") == "parent", gender)
    raise ValueError(f"A dictionary row names no relation: {dict(spec)}")


def _place(value: object) -> Place | None:
    """ "1/4": the eldest of four."""
    if not value:
        return None
    number, of = (int(n) for n in str(value).split("/"))
    return Place(number, of)


# --- Finding an answer's row ----------------------------------------------------------------


def _match(row: Kin, kin: Kin) -> int | None:
    """How well an answer fits a row: None when the row says something else; otherwise the
    number of details they share. A row's detail must hold for the answer."""
    match row, kin:
        case Blood(), Blood() if (row.up, row.down) == (kin.up, kin.down):
            checks = [
                _same(row.gender is not Gender.UNKNOWN, row.gender == kin.gender),
                _same(row.seniority is not None, row.seniority == kin.seniority),
                _same(row.half, kin.half),
                _same(row.side is not None, row.side == kin.side),
                _same(row.place is not None, _same_place(row.place, kin.place), weight=2),
            ]
        case Spouse(), Spouse():
            checks = [
                _same(row.gender is not Gender.UNKNOWN, row.gender == kin.gender),
                _same(True, row.former == kin.former),
            ]
        case Compound(), Compound() if (row.group, row.key) == (kin.group, kin.key):
            checks = [
                _same(row.gender is not Gender.UNKNOWN, row.gender == kin.gender),
                _same(row.seniority is not None, row.seniority == kin.seniority),
                _same(row.place is not None, _same_place(row.place, kin.place), weight=2),
            ]
        case KindStep(), KindStep() if (row.kind, row.upward) == (kin.kind, kin.upward):
            checks = [_same(row.gender is not Gender.UNKNOWN, row.gender == kin.gender)]
        case KindSibling(), KindSibling() if row.kind == kin.kind:
            checks = [_same(row.gender is not Gender.UNKNOWN, row.gender == kin.gender)]
        case _:
            return None
    if any(check is None for check in checks):
        return None
    return sum(check or 0 for check in checks)


def _same(specified: bool, holds: bool, weight: int = 1) -> int | None:
    """`weight` when the row specifies a detail that holds, 0 when it doesn't specify it,
    None when it specifies one that doesn't hold."""
    if not specified:
        return 0
    return weight if holds else None


def _same_place(row: Place | None, kin: Place | None) -> bool:
    if row is None or kin is None:
        return False
    if row.youngest or kin.youngest:
        return row.youngest == kin.youngest
    return row.number == kin.number


def _nearest_row(kin: Kin) -> str | None:
    """For an answer no row fits exactly: the row for the same kind of relation."""
    loose: Kin
    match kin:
        case Blood(up=up, down=down) if up >= 2 and down >= 2 and up != down:
            return "cousin-of-parent" if up > down else "child-of-cousin"
        case Blood(up=up, down=down) if up == down >= 5:
            return "cousin-4"
        case Blood(up=up, down=1) if up >= 4:
            return "great-uncle" if kin.gender is not Gender.FEMALE else "great-aunt"
        case Blood(up=1, down=down) if down >= 4:
            return "great-grandnephew"
        case Blood():
            loose = Blood(kin.up, kin.down, Gender.UNKNOWN)
        case Compound():
            loose = Compound(kin.key, kin.group, Gender.UNKNOWN, False, ())
        case KindStep():
            loose = KindStep(kin.kind, kin.upward, Gender.UNKNOWN)
        case KindSibling():
            loose = KindSibling(kin.kind, Gender.UNKNOWN)
        case _:
            return None
    # The same relation with none of the details: any row of that shape.
    for row_id, row_kin in _kin_rows():
        if _shape(row_kin) == _shape(loose):
            return row_id
    return None


def _shape(kin: Kin) -> tuple[object, ...]:
    match kin:
        case Blood(up=up, down=down):
            return ("blood", up, down)
        case Compound(key=key, group=group):
            return (group, key)
        case KindStep(kind=kind, upward=upward):
            return ("kind", kind, upward)
        case KindSibling(kind=kind):
            return ("kind sibling", kind)
        case _:
            return (type(kin).__name__,)
