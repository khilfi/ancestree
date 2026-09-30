"""Reading the older files into one shape: people, the parents a row names, and the chart's
marriages with their children in the order they were drawn.
"""

import base64
import csv
import html
import re
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import unquote
from xml.etree.ElementTree import Element

import defusedxml.ElementTree as SafeET

from ancestree.domain.person import Gender, Place
from ancestree.importing.names import clean_spaces, split_nickname

SourceKind = Literal["csv", "drawio"]


@dataclass(frozen=True)
class SourcePerson:
    """One person as a file describes them. `name` is None for a blank chart box."""

    key: str  # stable within the file: "csv:9" (the row), "drawio:<box id>"
    where: str  # for people: "ini_record.csv row 9", "the chart box 'Asiah'"
    name: str | None
    nickname: str | None = None
    gender: Gender | None = None
    birth_text: str | None = None
    death_text: str | None = None
    living: bool | None = None
    birth_place: Place | None = None
    residence: Place | None = None
    extra: tuple[str, ...] = ()  # other lines in a chart box, kept as notes
    x: float = 0.0  # position in the chart, for left-to-right order
    y: float = 0.0


@dataclass(frozen=True)
class ParentClaim:
    """A spreadsheet row naming a parent, matched to a person later."""

    child: str  # key
    name: str
    role: Literal["father", "mother"]
    where: str


@dataclass(frozen=True)
class Marriage:
    """A "Kahwin" circle in the chart: who married, and their children as drawn."""

    key: str
    spouses: tuple[str, ...]  # keys, blank boxes included
    children: tuple[str, ...]  # keys, left to right


@dataclass
class Source:
    path: Path
    kind: SourceKind
    people: list[SourcePerson] = field(default_factory=list)
    parent_claims: list[ParentClaim] = field(default_factory=list)
    marriages: list[Marriage] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return self.path.name


class SourceError(Exception):
    """A file that can't be read at all."""


# --- The spreadsheet ------------------------------------------------------------------------

_TRUE = frozenset({"true", "yes", "y", "1", "ya"})
_GENDERS = {"male": Gender.MALE, "m": Gender.MALE, "female": Gender.FEMALE, "f": Gender.FEMALE}
_UNUSED_COLUMNS = ("age", "status")


def read_csv(path: Path) -> Source:
    """One person per row: name, alias, father, mother, gender, places, bday, deceased_*."""
    source = Source(path, "csv")
    try:
        with path.open(encoding="utf-8-sig", newline="") as file:
            rows = [
                {clean_spaces(k).casefold(): (v or "") for k, v in row.items() if k}
                for row in csv.DictReader(file)
            ]
    except (OSError, UnicodeDecodeError, csv.Error) as error:
        raise SourceError(f"Couldn't read {path.name}: {error}") from error
    if rows and "name" not in rows[0]:
        raise SourceError(f"{path.name} has no 'name' column.")
    if rows and any(column in rows[0] for column in _UNUSED_COLUMNS):
        source.notices.append(
            f"{path.name}: the 'age' and 'status' columns are left out. Ages are worked out "
            "from the dates, and marriages come from the parents each row names."
        )

    for number, row in enumerate(rows, start=2):  # row 1 is the header

        def cell(column: str, row: dict[str, str] = row) -> str | None:
            return clean_spaces(row.get(column, "")) or None

        where = f"{path.name} row {number}"
        name = cell("name")
        if name is None:
            if any(value.strip() for value in row.values()):
                source.notices.append(f"{where} has no name, so it was skipped.")
            continue
        key = f"csv:{number}"
        gender = None
        if (text := cell("gender")) is not None:
            gender = _GENDERS.get(text.casefold())
            if gender is None:
                source.notices.append(f"{where}: gender '{text}' isn't male or female; left out.")
        deceased = cell("deceased_status")
        source.people.append(
            SourcePerson(
                key=key,
                where=where,
                name=name,
                nickname=cell("alias"),
                gender=gender,
                birth_text=cell("bday"),
                death_text=_joined_date(
                    cell("deceased_day"), cell("deceased_month"), cell("deceased_year")
                ),
                living=None if deceased is None else deceased.casefold() not in _TRUE,
                birth_place=_place(
                    cell("birthplace_city"), cell("birthplace_state"), cell("birthplace_country")
                ),
                residence=_place(
                    cell("current_location_city"),
                    cell("current_location_state"),
                    cell("current_location_country"),
                ),
            )
        )
        for role in _ROLES:
            if (parent := cell(role)) is not None:
                source.parent_claims.append(ParentClaim(key, parent, role, where))
    return source


_ROLES: tuple[Literal["father", "mother"], ...] = ("father", "mother")


def _joined_date(day: str | None, month: str | None, year: str | None) -> str | None:
    parts = [part for part in (day, month, year) if part]
    return "/".join(parts) or None


def _place(town: str | None, state: str | None, country: str | None) -> Place | None:
    if town is None and state is None and country is None:
        return None
    return Place(town=town, state=state, country=country or "Malaysia")


# --- The draw.io chart ----------------------------------------------------------------------

_JUNCTION = "kahwin"
_DATE_LINE = re.compile(r"^(?:c\.?\s*|about\s+|sekitar\s+)?[\d/.\-\s]+$", re.IGNORECASE)
_LINE_BREAKS = re.compile(r"<br\s*/?>|</div>|</p>|<div[^>]*>|<p[^>]*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class _Box:
    id: str
    lines: tuple[str, ...]
    x: float
    y: float


def read_drawio(path: Path) -> Source:
    """People are boxes; each "Kahwin" circle joins its spouses (lines in) to its children
    (lines out). Children are read left to right, which is how the chart shows birth order.
    """
    source = Source(path, "drawio")
    try:
        root = SafeET.parse(path).getroot()
    except (OSError, SafeET.ParseError) as error:
        raise SourceError(f"Couldn't read {path.name}: {error}") from error
    if root is None:
        raise SourceError(f"{path.name} is empty.")

    models = _graph_models(root)
    for page, model in enumerate(models, start=1):
        prefix = "drawio:" if len(models) == 1 else f"drawio:p{page}:"
        _read_page(source, model, prefix)
    return source


def _graph_models(root: Element) -> list[Element]:
    """Each page's mxGraphModel; draw.io may store a page compressed."""
    if root.tag == "mxGraphModel":
        return [root]
    models = []
    for diagram in root.iter("diagram"):
        model = diagram.find("mxGraphModel")
        if model is None and (diagram.text or "").strip():
            try:
                packed = base64.b64decode(diagram.text or "")
                text = unquote(zlib.decompress(packed, -15).decode("utf-8"))
                model = SafeET.fromstring(text)
            except (ValueError, zlib.error, SafeET.ParseError) as error:
                raise SourceError(f"A page of the chart couldn't be unpacked: {error}") from error
        if model is not None:
            models.append(model)
    return models


def _read_page(source: Source, model: Element, prefix: str) -> None:
    cells = {cell.get("id", ""): cell for cell in model.iter("mxCell")}
    boxes: dict[str, _Box] = {}
    for cell_id, cell in cells.items():
        if cell.get("vertex") == "1":
            x, y = _position(cell_id, cells)
            boxes[cell_id] = _Box(cell_id, _label_lines(cell.get("value", "")), x, y)
    junctions = {box_id for box_id, box in boxes.items() if _is_junction(box)}

    spouses: dict[str, list[str]] = {junction: [] for junction in junctions}
    children: dict[str, list[str]] = {junction: [] for junction in junctions}
    for cell in cells.values():
        if cell.get("edge") != "1":
            continue
        start, end = cell.get("source"), cell.get("target")
        if start not in boxes or end not in boxes:
            continue  # a loose line; nothing to read from it
        if end in junctions and start not in junctions:
            spouses[end].append(start)
        elif start in junctions and end not in junctions:
            children[start].append(end)
        else:
            source.notices.append(
                f"A line between '{_describe(boxes[start])}' and '{_describe(boxes[end])}' "
                "doesn't go through a Kahwin circle, so it was ignored."
            )

    in_families = {box for group in (*spouses.values(), *children.values()) for box in group}
    for box_id in sorted(set(boxes) - junctions - in_families):
        if boxes[box_id].lines:
            source.notices.append(
                f"The chart box '{_describe(boxes[box_id])}' isn't joined to any Kahwin circle, "
                "so it was left out."
            )
    for box_id in sorted(in_families, key=lambda b: (boxes[b].y, boxes[b].x)):
        source.people.append(_person(boxes[box_id], prefix))

    for junction in sorted(junctions, key=lambda j: (boxes[j].y, boxes[j].x)):
        drawn = sorted(dict.fromkeys(children[junction]), key=lambda c: (boxes[c].x, boxes[c].y))
        if not spouses[junction] and not drawn:
            continue
        source.marriages.append(
            Marriage(
                key=f"{prefix}{junction}",
                spouses=tuple(f"{prefix}{s}" for s in dict.fromkeys(spouses[junction])),
                children=tuple(f"{prefix}{c}" for c in drawn),
            )
        )


def _position(cell_id: str, cells: dict[str, Element]) -> tuple[float, float]:
    """Where a box sits on the page: positions inside a group are relative to the group."""
    x = y = 0.0
    seen: set[str] = set()
    current: str | None = cell_id
    while current and current in cells and current not in seen:
        seen.add(current)
        geometry = cells[current].find("mxGeometry")
        if geometry is not None and geometry.get("relative") != "1":
            x += float(geometry.get("x", 0))
            y += float(geometry.get("y", 0))
        current = cells[current].get("parent")
    return x, y


def _label_lines(value: str) -> tuple[str, ...]:
    text = html.unescape(_TAGS.sub("", _LINE_BREAKS.sub("\n", value)))
    return tuple(line for line in (clean_spaces(raw) for raw in text.splitlines()) if line)


def _is_junction(box: _Box) -> bool:
    return len(box.lines) == 1 and box.lines[0].casefold() == _JUNCTION


def _describe(box: _Box) -> str:
    return " ".join(box.lines) or "a blank box"


def _person(box: _Box, prefix: str) -> SourcePerson:
    name = nickname = birth = None
    extra: list[str] = []
    for line in box.lines:
        if line.startswith("(") and line.endswith(")"):
            nickname = nickname or clean_spaces(line[1:-1]) or None
        elif _DATE_LINE.match(line) and any(ch.isdigit() for ch in line):
            birth = birth or line
        elif name is None:
            name, inline = split_nickname(line)
            nickname = nickname or inline
        else:
            extra.append(line)
    where = f"the chart box '{name}'" if name else "a blank box in the chart"
    return SourcePerson(
        key=f"{prefix}{box.id}",
        where=where,
        name=name or None,
        nickname=nickname,
        birth_text=birth,
        extra=tuple(extra),
        x=box.x,
        y=box.y,
    )
