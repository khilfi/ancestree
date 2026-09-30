"""Who is who in a spreadsheet, and what an import adds.

Pure: the rows, the tree and your answers in; a plan out. Nothing here writes: when the plan
is carried out (services/imports.py), every link still goes through the app's own rules.

- A row is someone new, or someone already in the tree: by their AncesTree ID, or by your
  answer when their name looks like someone's.
- Each name in Parents, Spouses and Children is found by an ID (the file's own or
  AncesTree's), then a full name in the file, then a full name in the tree. When several
  people fit, or only part of a name does, it's a question; when nobody does, the name
  becomes someone new.
- What a row says differently about someone already in the tree is a change to review.
  The row's Version says what each detail was when the file was exported, so a detail changed
  only in the file is offered, one changed only in the tree since is the newer and stays, and
  one changed in both is a clash for you to settle. Remove marks someone to take out.
- Every change can be left out: new people and links, details, and removals.
"""

import math
import re
from collections import defaultdict
from collections.abc import Callable, Collection, Container, Mapping, Sequence
from dataclasses import dataclass, field
from functools import partial
from typing import Any, Literal
from uuid import UUID

from ancestree.domain.dates import format_partial_date
from ancestree.domain.imports import (
    ImportChange,
    ImportDifference,
    ImportLeftOut,
    ImportOption,
    ImportPerson,
    ImportQuestion,
    ImportSecondLook,
)
from ancestree.domain.person import DateQualifier, Gender, PartialDate
from ancestree.domain.relationship import RelationshipKind, SpouseStatus
from ancestree.domain.requests import PersonInput
from ancestree.exchange.spreadsheet import VERSIONED, fingerprint, place_shown, read_version, shown
from ancestree.importing.cells import (
    CellError,
    Mention,
    limit,
    link_kind,
    read_date,
    read_gender,
    read_living,
    read_mentions,
    read_place,
    read_remove,
    read_text,
    spouse_status,
    written_date,
)
from ancestree.importing.names import match_key
from ancestree.importing.sheet import Sheet, SheetRow
from ancestree.kinship.family import short_name
from ancestree.repo.mapping import date_from_props, detail_props, person_from_props
from ancestree.services.detail import is_living

type Ref = tuple[Literal["tree", "new"], str]  # someone in the tree by id, or someone new by key

# --- Names ------------------------------------------------------------------------------------

_TITLES = frozenset(
    {"haji", "hj", "hajah", "hjh", "dato'", "dato", "datuk", "datin", "dr", "tuan", "puan"}
    | {"encik", "en", "cik"}
)
_PARTICLES = {"b": "bin", "bn": "bin", "bt": "binti", "bte": "binti", "binte": "binti"}
_NOT_LETTERS = re.compile(r"[^a-z]")
_VOWELS = re.compile(r"[aeiouy]")
_DOUBLED = re.compile(r"(.)\1+")


def name_key(name: str) -> str:
    """How names are compared: capitals, spaces, apostrophes, brackets, a title in front such
    as Haji, and the spelling of bin and binti don't count."""
    words = [_PARTICLES.get(word.rstrip("."), word.rstrip(".")) for word in match_key(name).split()]
    while len(words) > 1 and words[0] in _TITLES:
        words.pop(0)
    return " ".join(words)


def skeleton(key: str) -> str:
    """A name's consonants, doubled letters once: "hassan bin ismail" and "hasan bin ismael"
    both give "hsnbnsml". Names that share it but not their key look alike."""
    letters = _NOT_LETTERS.sub("", key)
    if not letters:
        return ""
    return _DOUBLED.sub(r"\1", letters[0] + _VOWELS.sub("", letters[1:]))


_SKELETON_AT_LEAST = 6  # shorter ones ("al" for Ali) would match too many people


def _span(date: PartialDate | None) -> tuple[float, float] | None:
    if date is None or date.year is None:
        return None
    year = float(date.year)
    match date.qualifier:
        case DateQualifier.ABOUT:
            return year - 5, year + 5
        case DateQualifier.BEFORE:
            return -math.inf, year
        case DateQualifier.AFTER:
            return year, math.inf
        case DateQualifier.BETWEEN:
            return year, float(date.year_to or date.year)
        case _:
            return year, year


def dates_agree(a: PartialDate | None, b: PartialDate | None) -> bool:
    """Two birth dates that could be the same one; an unknown date agrees with anything."""
    first, second = _span(a), _span(b)
    return first is None or second is None or (first[0] <= second[1] and second[0] <= first[1])


def _same_year(a: PartialDate | None, b: PartialDate | None) -> bool:
    return a is not None and b is not None and a.year is not None and a.year == b.year


def _born(date: PartialDate | None) -> str:
    return f"b. {date.year}" if date is not None and date.year is not None else ""


def _uuid(text: str) -> str | None:
    try:
        return str(UUID(text.strip()))
    except ValueError:
        return None


# --- The tree -----------------------------------------------------------------------------------


class Tree:
    """Everyone already in the tree (unknown parents aside), as the import sees them."""

    def __init__(
        self,
        people: Sequence[Mapping[str, Any]],
        links: Sequence[Mapping[str, Any]],
        kinds: Mapping[str, RelationshipKind],
    ) -> None:
        self.props = {str(p["id"]): p for p in people if not p.get("placeholder")}
        self.kinds = dict(kinds)
        self.parent_links: set[tuple[str, str]] = set()
        self.spouse_links: set[frozenset[str]] = set()
        self._parents: dict[str, list[str]] = defaultdict(list)
        self._children: dict[str, list[str]] = defaultdict(list)
        self._spouses: dict[str, list[str]] = defaultdict(list)
        for link in links:
            a, b = str(link["source"]), str(link["target"])
            if link["type"] == "parent":
                self.parent_links.add((a, b))
                self._parents[b].append(a)
                self._children[a].append(b)
            else:
                self.spouse_links.add(frozenset((a, b)))
                self._spouses[a].append(b)
                self._spouses[b].append(a)
        self.by_key: dict[str, list[str]] = defaultdict(list)
        self.by_skeleton: dict[str, list[str]] = defaultdict(list)
        self.key: dict[str, str] = {}
        self.nickname_key: dict[str, str] = {}
        self.born: dict[str, PartialDate | None] = {}
        for pid, props in self.props.items():
            key = name_key(str(props["full_name"]))
            self.key[pid] = key
            self.by_key[key].append(pid)
            if len(bones := skeleton(key)) >= _SKELETON_AT_LEAST:
                self.by_skeleton[bones].append(pid)
            if props.get("nickname"):
                self.nickname_key[pid] = name_key(str(props["nickname"]))
            try:
                self.born[pid] = date_from_props("birth", props)
            except ValueError:
                self.born[pid] = None

    def name(self, pid: str) -> str:
        return str(self.props[pid]["full_name"])

    def gender(self, pid: str) -> Gender:
        return Gender(self.props[pid].get("gender") or Gender.UNKNOWN)

    def _short(self, pid: str) -> str:
        props = self.props.get(pid)
        return short_name(str(props["full_name"]), props.get("nickname")) if props else ""

    def describe(self, pid: str) -> str:
        """ "b. 1938 · child of Ismail & Fatimah": enough to tell namesakes apart."""
        about = ""
        if parents := [p for p in self._parents[pid] if p in self.props]:
            about = "child of " + " & ".join(self._short(p) for p in parents)
        elif spouses := [s for s in self._spouses[pid] if s in self.props]:
            about = "married to " + " & ".join(self._short(s) for s in spouses)
        elif children := [c for c in self._children[pid] if c in self.props]:
            about = "parent of " + ", ".join(self._short(c) for c in children[:3])
        return " · ".join(part for part in (_born(self.born[pid]), about) if part)


# --- The plan ----------------------------------------------------------------------------------


@dataclass
class NewPerson:
    key: str  # "row:12", or "named:<name key>" for someone only named in another row
    row: int | None
    data: PersonInput
    named_in: list[int] = field(default_factory=list)

    def view(self) -> ImportPerson:
        born = self.data.birth_date
        return ImportPerson(
            row=self.row,
            name=self.data.full_name,
            # Only a date that was read: one kept as written is in the "left out" list.
            born=format_partial_date(born) if born and born.year is not None else None,
            birthplace=place_shown(self.data.birth_place) or None,
            named_in=self.named_in,
        )


@dataclass(frozen=True)
class PlannedLink:
    type: Literal["parent", "spouse"]
    a: Ref  # the parent, or a spouse
    b: Ref  # the child, or the other spouse
    kind: str
    status: SpouseStatus
    row: int
    column: str
    written: str
    explicit: bool  # the kind or status was written in brackets

    @property
    def id(self) -> str:
        """Its change's id: "link:parent:new:row:3>tree:<id>"; a couple's in either order."""
        ends = [f"{ref[0]}:{ref[1]}" for ref in (self.a, self.b)]
        return f"link:{self.type}:{'>'.join(sorted(ends) if self.type == 'spouse' else ends)}"

    @property
    def needs(self) -> list[str]:
        """The new people it joins: it can't be made without them."""
        return [f"add:{ref[1]}" for ref in (self.a, self.b) if ref[0] == "new"]


@dataclass(frozen=True)
class PlannedSet:
    """A detail of someone already in the tree that the file changes."""

    id: str  # "set:<id>:<field>"
    person: str
    field: str  # as in PersonInput
    props: dict[str, Any]  # the properties that hold it, as they'll be; None clears one


@dataclass(frozen=True)
class PlannedRemoval:
    id: str  # "remove:<id>"
    person: str
    row: int


@dataclass
class SheetPlan:
    rows: int
    people: list[NewPerson]
    matched: dict[int, str]  # row -> the person in the tree it is
    links: list[PlannedLink]
    questions: list[ImportQuestion]
    left_out: list[ImportLeftOut]
    chosen_out: list[ImportLeftOut]  # links left out by your answer: in the report
    second_look: list[ImportSecondLook]
    differences: list[ImportDifference]
    not_read: list[str]
    sets: list[PlannedSet] = field(default_factory=list)
    removals: list[PlannedRemoval] = field(default_factory=list)
    changes: list[ImportChange] = field(default_factory=list)  # all of the above, to review

    def carried_out(self, chosen: Collection[str] | None) -> set[str]:
        """The changes that happen when these are ticked (None: those ticked to begin with).
        A link needs the new people it joins, and goes when someone it joins is removed."""
        ticked = {c.id for c in self.changes if (c.ticked if chosen is None else c.id in chosen)}
        return {
            c.id
            for c in self.changes
            if c.id in ticked
            and all(need in ticked for need in c.needs)
            and not any(block in ticked for block in c.blocked_by)
        }

    def reached(self, done: Container[str]) -> set[str]:
        """Everyone already in the tree these changes touch: whose details they change, and
        both ends of their links. Not those they remove, which go through the Trash."""
        ids = {change.person for change in self.sets if change.id in done}
        for link in self.links:
            if link.id in done:
                ids |= {ref[1] for ref in (link.a, link.b) if ref[0] == "tree"}
        return ids


@dataclass
class _Row:
    number: int
    tag: str | None
    data: PersonInput
    key: str
    mentions: dict[str, list[Mention]]
    # Values that couldn't be read: left out if the row is someone new. For someone already
    # in the tree, a detail changed to one of these stays as it is in the tree.
    unread: list[ImportLeftOut]
    cells: SheetRow
    remove: bool = False  # marked Remove
    identity: Ref | None = None
    skipped: bool = False  # marked Remove, but not anyone in the tree: nobody to add or take out


_TEXT = {
    "Nickname": "nickname",
    "Title": "title",
    "Name in Jawi": "name_jawi",
    "Burial place": "burial_place",
    "Occupation": "occupation",
}
_DATES = {"Born": "birth_date", "Died": "death_date"}
_PLACES = {"Birthplace": "birth_place", "Death place": "death_place", "Lives in": "residence"}
_LINK_COLUMNS = ("Spouses", "Parents", "Children")
_MOST_OPTIONS = 8
_OUT = ImportOption(id="out", label="Leave this link out")
_SPOUSE_WORDS = {
    SpouseStatus.MARRIED: "married to {}",
    SpouseStatus.DIVORCED: "formerly married to {}",
    SpouseStatus.WIDOWED: "married to {} (widowed)",
}


def _same_text(a: str, b: str) -> bool:
    return " ".join(a.split()).casefold() == " ".join(b.split()).casefold()


def _rows(numbers: Sequence[int]) -> str:
    listed = ", ".join(str(n) for n in numbers[:-1])
    return f"row {numbers[0]}" if len(numbers) == 1 else f"rows {listed} and {numbers[-1]}"


class _Planner:
    def __init__(self, sheet: Sheet, tree: Tree, answers: Mapping[str, str]) -> None:
        self.sheet = sheet
        self.tree = tree
        self.answers = answers
        self.matched: dict[int, str] = {}
        self.questions: list[ImportQuestion] = []
        self.left_out: list[ImportLeftOut] = []
        self.chosen_out: list[ImportLeftOut] = []
        self.second_look: list[ImportSecondLook] = []
        self.differences: list[ImportDifference] = []
        self.sets: list[PlannedSet] = []
        self.removals: list[PlannedRemoval] = []
        self._set_changes: list[ImportChange] = []
        self._rows: list[_Row] = []
        self._by_tag: dict[str, _Row] = {}
        self._by_name: dict[str, list[_Row]] = defaultdict(list)
        self._skipped: dict[str, _Row] = {}  # rows marked Remove that aren't anyone, by name
        self._named: dict[str, NewPerson] = {}
        self._parents: dict[tuple[Ref, Ref], PlannedLink] = {}
        self._spouses: dict[frozenset[Ref], PlannedLink] = {}
        self._names: dict[str, str] = {}  # new people's names, by key
        self._genders: dict[str, Gender] = {}  # and genders, for "father of" and "mother of"

    # --- Reading rows ---

    def _leave_out(self, row: int, column: str, written: str, why: str) -> None:
        self.left_out.append(ImportLeftOut(row=row, column=column, written=written, why=why))

    @staticmethod
    def _cell(
        row: SheetRow,
        column: str,
        read: Callable[[str], object],
        fields: dict[str, object],
        name: str,
        unread: list[ImportLeftOut],
    ) -> None:
        text = row[column]
        if not text:
            return
        try:
            value = read(text)
        except CellError as error:
            why = str(error)
            unread.append(ImportLeftOut(row=row.number, column=column, written=text, why=why))
            return
        if value is not None:
            fields[name] = value

    def _read(self, row: SheetRow) -> _Row | None:
        name = " ".join(row["Full name"].split())
        if not name:
            self._leave_out(row.number, "Full name", "", "No full name, so the row is skipped.")
            return None
        if len(name) > limit("full_name"):
            self._leave_out(
                row.number,
                "Full name",
                name,
                f"Longer than the {limit('full_name')} characters the app keeps, so the row "
                "is skipped.",
            )
            return None
        fields: dict[str, object] = {"full_name": name}
        unread: list[ImportLeftOut] = []
        cell = partial(self._cell, row, fields=fields, unread=unread)
        for column, field_name in _TEXT.items():
            cell(column, partial(read_text, field=field_name), name=field_name)
        cell("Notes", partial(read_text, field="notes", lines=True), name="notes")
        cell("Gender", read_gender, name="gender")
        cell("Living", read_living, name="living")
        for column, field_name in _PLACES.items():
            cell(column, read_place, name=field_name)
        for column, field_name in _DATES.items():
            text = row[column]
            if not text:
                continue
            try:
                fields[field_name] = read_date(text)
            except CellError as error:
                why = f"{error} Kept as written, to pick the date later."
                unread.append(ImportLeftOut(row=row.number, column=column, written=text, why=why))
                fields[field_name] = written_date(text)
        try:
            remove = read_remove(row["Remove"])
        except CellError as error:
            remove = False
            self._leave_out(row.number, "Remove", row["Remove"], f"{error} Nobody is removed.")
        tag = " ".join(row["ID"].split()) or None
        return _Row(
            number=row.number,
            tag=tag,
            data=PersonInput.model_validate(fields),
            key=name_key(name),
            mentions={column: read_mentions(row[column]) for column in _LINK_COLUMNS},
            unread=unread,
            cells=row,
            remove=remove,
        )

    # --- Who each row is ---

    def _answer(self, qid: str, options: list[ImportOption], default: str) -> str:
        chosen = self.answers.get(qid)
        return chosen if chosen in {option.id for option in options} else default

    def _tags(self, rows: list[_Row]) -> None:
        for row in rows:
            if row.tag is None:
                continue
            found = _uuid(row.tag)
            if found is not None and found in self.tree.props:
                row.identity = ("tree", found)
                self.matched[row.number] = found
                continue
            if found is not None and not row.remove:
                self.second_look.append(
                    ImportSecondLook(
                        row=row.number,
                        message=f"The ID {row.tag} isn't anyone in the tree now (removed, or "
                        f"from another family's file), so {row.data.full_name} is added as "
                        "someone new.",
                    )
                )
            first = self._by_tag.get(row.tag.casefold())
            if first is not None:
                self._leave_out(
                    row.number,
                    "ID",
                    row.tag,
                    f"Row {first.number} has this ID already, so other rows find this one "
                    "only by its name.",
                )
            else:
                self._by_tag[row.tag.casefold()] = row

    def _who_is(self, row: _Row) -> None:
        tree = self.tree
        born = row.data.birth_date
        exact = [pid for pid in tree.by_key.get(row.key, []) if dates_agree(tree.born[pid], born)]
        near: list[str] = []
        if len(bones := skeleton(row.key)) >= _SKELETON_AT_LEAST:
            near = [
                pid
                for pid in tree.by_skeleton.get(bones, [])
                if pid not in exact and dates_agree(tree.born[pid], born)
            ]
        candidates = (exact + near)[:_MOST_OPTIONS]
        new: Ref = ("new", f"row:{row.number}")
        if not candidates:
            row.identity = new
            return
        default = (
            f"person:{exact[0]}"
            if len(exact) == 1 and _same_year(tree.born[exact[0]], born)
            else "new"
        )
        options = [
            ImportOption(
                id=f"person:{pid}",
                label=f"The same person: {tree.name(pid)}",
                detail=tree.describe(pid) or None,
            )
            for pid in candidates
        ] + [ImportOption(id="new", label="Someone new")]
        alike = " or ".join(
            f"{tree.name(pid)} ({_born(tree.born[pid])})" if tree.born[pid] else tree.name(pid)
            for pid in candidates[:3]
        )
        answer = self._answer(f"same:{row.number}", options, default)
        written = row.data.full_name + (f", {_born(born)}" if _born(born) else "")
        self.questions.append(
            ImportQuestion(
                id=f"same:{row.number}",
                row=row.number,
                column="Full name",
                written=written,
                kind="same_person",
                text=f"Looks like {alike}, already in the tree.",
                options=options,
                answer=answer,
            )
        )
        if answer.startswith("person:"):
            pid = answer.removeprefix("person:")
            row.identity = ("tree", pid)
            self.matched[row.number] = pid
        else:
            row.identity = new

    def _alike_in_file(self, rows: list[_Row]) -> None:
        groups: dict[tuple[str, int | None], list[_Row]] = defaultdict(list)
        for row in rows:
            if row.identity and row.identity[0] == "new":
                born = row.data.birth_date
                groups[(row.key, born.year if born else None)].append(row)
        for (_, year), group in groups.items():
            if len(group) < 2:
                continue
            numbers = ", ".join(str(row.number) for row in group[:-1])
            when = f", born {year}," if year else ""
            self.second_look.append(
                ImportSecondLook(
                    row=group[0].number,
                    message=f"Rows {numbers} and {group[-1].number} are all "
                    f"{group[0].data.full_name}{when} so they're added as different people. "
                    "If they're one person, delete the others after the import.",
                )
            )

    # --- Who each name in Parents, Spouses and Children is ---

    def _name_of(self, ref: Ref) -> str:
        return self.tree.name(ref[1]) if ref[0] == "tree" else self._names.get(ref[1], "someone")

    def _named_only(self, who: str, row: _Row, column: str, written: str) -> Ref | None:
        if len(who) > limit("full_name"):
            self._leave_out(row.number, column, written, "Too long for a name.")
            return None
        key = f"named:{name_key(who)}"
        person = self._named.get(key)
        if person is None:
            person = self._named[key] = NewPerson(key, None, PersonInput(full_name=who))
            self._names[key] = who
        if row.number not in person.named_in:
            person.named_in.append(row.number)
        return ("new", key)

    def _ask(
        self,
        row: _Row,
        column: str,
        index: int,
        mention: Mention,
        text: str,
        options: list[ImportOption],
    ) -> Ref | None:
        qid = f"who:{row.number}:{column}:{index}"
        answer = self._answer(qid, options, "out")
        self.questions.append(
            ImportQuestion(
                id=qid,
                row=row.number,
                column=column,
                written=mention.written,
                kind="which_person",
                text=text,
                options=options,
                answer=answer,
            )
        )
        if answer.startswith("person:"):
            return ("tree", answer.removeprefix("person:"))
        if answer.startswith("row:"):
            chosen = next(r for r in self._rows if f"row:{r.number}" == answer)
            return chosen.identity
        if answer == "new":
            return self._named_only(" ".join(mention.who.split()), row, column, mention.written)
        self.chosen_out.append(
            ImportLeftOut(
                row=row.number,
                column=column,
                written=mention.written,
                why="Not clear who this is, so the link was left out, as chosen.",
            )
        )
        return None

    def _row_option(self, row: _Row) -> ImportOption:
        return ImportOption(
            id=f"row:{row.number}",
            label=f"Row {row.number}: {row.data.full_name}",
            detail=_born(row.data.birth_date) or None,
        )

    def _person_option(self, pid: str) -> ImportOption:
        return ImportOption(
            id=f"person:{pid}", label=self.tree.name(pid), detail=self.tree.describe(pid) or None
        )

    def _not_added(self, skipped: _Row, row: _Row, column: str, mention: Mention) -> None:
        why = (
            f"Row {skipped.number} is marked Remove and isn't anyone in the tree, so this link "
            "is left out."
        )
        self._leave_out(row.number, column, mention.written, why)

    def _resolve(self, row: _Row, column: str, index: int, mention: Mention) -> Ref | None:
        who = " ".join(mention.who.split())
        tagged = self._by_tag.get(who.casefold())
        if tagged is not None and tagged.identity is not None:
            return tagged.identity
        if tagged is not None and tagged.skipped:
            self._not_added(tagged, row, column, mention)
            return None
        found = _uuid(who)
        if found is not None and found in self.tree.props:
            return ("tree", found)
        key = name_key(who)
        new_named = ImportOption(id="new", label=f"Someone new named {who}")
        in_file = self._by_name.get(key, [])
        if not in_file and (skipped := self._skipped.get(key)) is not None:
            self._not_added(skipped, row, column, mention)
            return None
        if len(in_file) == 1 and in_file[0].identity is not None:
            return in_file[0].identity
        if len(in_file) > 1:
            options = [self._row_option(r) for r in in_file[:_MOST_OPTIONS]]
            return self._ask(
                row,
                column,
                index,
                mention,
                f"{len(in_file)} rows have this name.",
                [*options, _OUT],
            )
        in_tree = self.tree.by_key.get(key, [])
        if len(in_tree) == 1:
            return ("tree", in_tree[0])
        if len(in_tree) > 1:
            options = [self._person_option(pid) for pid in in_tree[:_MOST_OPTIONS]]
            text = f"{len(in_tree)} people in the tree have this name."
            return self._ask(row, column, index, mention, text, [*options, new_named, _OUT])
        rows = [
            r
            for r in self._rows
            if r.key.startswith(key + " ") or name_key(r.data.nickname or "") == key
        ]
        people = [
            pid
            for pid, other in self.tree.key.items()
            if other.startswith(key + " ") or self.tree.nickname_key.get(pid) == key
        ]
        if rows or people:
            options = [self._row_option(r) for r in rows]
            options += [self._person_option(pid) for pid in people]
            options = sorted(options, key=lambda option: option.label)[:_MOST_OPTIONS]
            names = " or ".join(option.label.split(": ")[-1] for option in options[:3])
            text = f"Only part of a name: did you mean {names}?"
            return self._ask(row, column, index, mention, text, [*options, new_named, _OUT])
        return self._named_only(who, row, column, mention.written)

    # --- Links ---

    def _parent(
        self, parent: Ref, child: Ref, kind: str, row: _Row, column: str, mention: Mention
    ) -> None:
        if parent == child:
            self._leave_out(
                row.number, column, mention.written, "Someone can't be their own parent."
            )
            return
        if parent[0] == child[0] == "tree" and (parent[1], child[1]) in self.tree.parent_links:
            return  # already in the tree
        explicit = mention.label is not None
        link = PlannedLink(
            "parent",
            parent,
            child,
            kind,
            SpouseStatus.MARRIED,
            row.number,
            column,
            mention.written,
            explicit,
        )
        planned = self._parents.get((parent, child))
        if planned is None:
            self._parents[(parent, child)] = link
        elif planned.kind != kind:
            if explicit and not planned.explicit:
                self._parents[(parent, child)] = link
            elif explicit:
                self.second_look.append(
                    ImportSecondLook(
                        row=row.number,
                        message=f"Rows {planned.row} and {row.number} give different kinds of "
                        f"link between {self._name_of(parent)} and {self._name_of(child)}; row "
                        f"{planned.row}'s is used.",
                    )
                )

    def _spouse(
        self, a: Ref, b: Ref, status: SpouseStatus, row: _Row, column: str, mention: Mention
    ) -> None:
        if a == b:
            self._leave_out(
                row.number, column, mention.written, "Someone can't be married to themselves."
            )
            return
        if a[0] == b[0] == "tree" and frozenset((a[1], b[1])) in self.tree.spouse_links:
            return  # already in the tree
        explicit = mention.label is not None
        link = PlannedLink(
            "spouse", a, b, "", status, row.number, column, mention.written, explicit
        )
        pair = frozenset((a, b))
        planned = self._spouses.get(pair)
        if planned is None or (explicit and not planned.explicit):
            self._spouses[pair] = link

    def _links(self, row: _Row) -> None:
        identity = row.identity
        if identity is None:
            return
        for column in _LINK_COLUMNS:
            for index, mention in enumerate(row.mentions[column]):
                kind = ""
                status = SpouseStatus.MARRIED
                try:
                    if column == "Parents":
                        kind = link_kind(mention.label, self.tree.kinds, "parent")
                    elif column == "Children":
                        kind = link_kind(mention.label, self.tree.kinds, "child")
                    else:
                        status = spouse_status(mention.label)
                except CellError as error:
                    self._leave_out(row.number, column, mention.written, str(error))
                    continue
                target = self._resolve(row, column, index, mention)
                if target is None:
                    continue
                if column == "Parents":
                    self._parent(target, identity, kind, row, column, mention)
                elif column == "Children":
                    self._parent(identity, target, kind, row, column, mention)
                else:
                    self._spouse(identity, target, status, row, column, mention)

    # --- Someone already in the tree ---

    def _details(self, row: _Row, pid: str) -> None:
        """What the row changes about someone already in the tree, detail by detail.

        With a Version, a cell that still says what was exported is unchanged in the file: the
        tree's stays, and is listed as the newer when the tree has changed since. A cell
        changed in the file is offered; if the tree has changed that detail too, it's a clash,
        and waits for your tick. Without a Version the file doesn't say what it started from:
        what it says differently waits for your tick, and an empty cell says nothing."""
        person = person_from_props(self.tree.props[pid])
        written = row.cells["Version"]
        version = read_version(written)
        if written and version is None:
            self.second_look.append(
                ImportSecondLook(
                    row=row.number,
                    message=f"Row {row.number}'s Version isn't one AncesTree wrote, so what it "
                    f"changes about {person.full_name} waits for your tick.",
                )
            )
        unread = {item.column: item for item in row.unread}
        for column, name in VERSIONED:
            if column not in self.sheet.columns:
                continue  # taken out of the file: it says nothing
            raw = row.cells[column]
            then = version[name] if version else None
            # Living as the app shows it, and the export writes it: worked out unless set.
            before = shown(is_living(person) if name == "living" else getattr(person, name))
            problem = unread.get(column)
            if problem is not None and name not in ("birth_date", "death_date"):
                # Nothing that can be read; worth saying only if the file changed it.
                if then is not None:
                    changed = fingerprint(raw) != then
                else:
                    changed = not _same_text(raw, before)
                if changed:
                    why = f"{problem.why} {person.full_name}'s stays as it is."
                    self._leave_out(row.number, column, raw, why)
                continue
            value = getattr(row.data, name) if name in row.data.model_fields_set else None
            after = shown(value)
            if then is not None:
                if then in (fingerprint(raw), fingerprint(after)):
                    if after and fingerprint(before) != then and not _same_text(after, before):
                        self.differences.append(
                            ImportDifference(
                                row=row.number,
                                person=UUID(pid),
                                name=person.full_name,
                                column=column,
                                written=after,
                                in_tree=before,
                            )
                        )
                    continue
                clash, unsure = fingerprint(before) != then, False
            elif after:
                clash, unsure = False, True
            else:
                continue
            if _same_text(after, before) or _same_text(raw, before):
                continue  # the tree says so already
            if name == "living" and not after and person.living is None:
                continue  # worked out from the dates already
            change_id = f"set:{pid}:{name}"
            self.sets.append(PlannedSet(change_id, pid, name, detail_props(row.data, name)))
            self._set_changes.append(
                ImportChange(
                    id=change_id,
                    kind="set",
                    row=row.number,
                    person=UUID(pid),
                    name=person.full_name,
                    column=column,
                    before=before,
                    after=after,
                    detail=problem.why if problem else None,  # a date kept as written
                    clash=clash,
                    unsure=unsure,
                    # A date kept as written would put words where a date can be used.
                    ticked=not (clash or unsure or problem),
                )
            )

    def _skip(self, row: _Row) -> None:
        """Marked Remove, but not anyone in the tree: the row adds nobody, and links to it
        are left out."""
        row.identity = None
        row.skipped = True
        self._skipped.setdefault(row.key, row)
        self._leave_out(
            row.number,
            "Remove",
            row.cells["Remove"],
            "Marked Remove, but not anyone in the tree, so the row is skipped.",
        )

    # --- What to review ---

    def _gender_of(self, ref: Ref) -> Gender:
        return (
            self.tree.gender(ref[1])
            if ref[0] == "tree"
            else self._genders.get(ref[1], Gender.UNKNOWN)
        )

    def _link_words(self, link: PlannedLink) -> str:
        """ "father of Siti", "married to Ali": the link, from its first person's side."""
        other = self._name_of(link.b)
        if link.type == "spouse":
            return _SPOUSE_WORDS[link.status].format(other)
        kind = self.tree.kinds.get(link.kind)
        label = kind.parent_label.for_gender(self._gender_of(link.a)) if kind else "parent"
        return f"{label} of {other}"

    def _changes(self, people: list[NewPerson], links: list[PlannedLink]) -> list[ImportChange]:
        """Everything the import would do, for you to tick: details changed, people and links
        added, and people removed, each in the order of the rows."""
        removing = {removal.person for removal in self.removals}
        changes = sorted(self._set_changes, key=lambda change: change.row or 0)
        for person in people:
            data = person.data
            about = [_born(data.birth_date), place_shown(data.birth_place)]
            if person.row is None:
                about.append(f"named in {_rows(person.named_in)}")
            changes.append(
                ImportChange(
                    id=f"add:{person.key}",
                    kind="add_person",
                    row=person.row,
                    name=data.full_name,
                    detail=" · ".join(part for part in about if part) or None,
                    ticked=True,
                )
            )
        for link in sorted(links, key=lambda link: link.row):
            ends = (link.a, link.b)
            changes.append(
                ImportChange(
                    id=link.id,
                    kind="add_link",
                    row=link.row,
                    name=self._name_of(link.a),
                    column=link.column,
                    detail=self._link_words(link),
                    needs=link.needs,
                    blocked_by=[
                        f"remove:{ref[1]}"
                        for ref in ends
                        if ref[0] == "tree" and ref[1] in removing
                    ],
                    ticked=True,
                )
            )
        for removal in self.removals:
            changes.append(
                ImportChange(
                    id=removal.id,
                    kind="remove_person",
                    row=removal.row,
                    person=UUID(removal.person),
                    name=self.tree.name(removal.person),
                    detail=self.tree.describe(removal.person) or None,
                    removes=True,
                    ticked=False,  # only ever by your own tick
                )
            )
        return changes

    # --- All together ---

    def plan(self) -> SheetPlan:
        self._rows = [row for sheet_row in self.sheet.rows if (row := self._read(sheet_row))]
        self._tags(self._rows)
        for row in self._rows:
            if row.identity is None:
                self._who_is(row)
            if row.remove and row.identity and row.identity[0] == "new":
                self._skip(row)
                continue
            if row.identity and row.identity[0] == "new":
                self._names[row.identity[1]] = row.data.full_name
                self._genders[row.identity[1]] = row.data.gender
                self.left_out += row.unread
            self._by_name[row.key].append(row)
        self._alike_in_file(self._rows)
        for row in self._rows:
            if not row.remove:  # someone to take out gains no links: their row is passed over
                self._links(row)
        first: dict[str, int] = {}
        for row in self._rows:
            if not row.identity or row.identity[0] != "tree":
                continue
            pid = row.identity[1]
            if pid in first:
                self.second_look.append(
                    ImportSecondLook(
                        row=row.number,
                        message=f"Rows {first[pid]} and {row.number} are both "
                        f"{self.tree.name(pid)}: only row {first[pid]}'s details are read.",
                    )
                )
                continue
            first[pid] = row.number
            if row.remove:
                self.removals.append(PlannedRemoval(f"remove:{pid}", pid, row.number))
            else:
                self._details(row, pid)
        people = [
            NewPerson(f"row:{row.number}", row.number, row.data)
            for row in self._rows
            if row.identity == ("new", f"row:{row.number}")
        ]
        people += self._named.values()
        links = [*self._spouses.values(), *self._parents.values()]
        return SheetPlan(
            rows=len(self.sheet.rows),
            people=people,
            matched=self.matched,
            links=links,
            questions=sorted(self.questions, key=lambda q: (q.row or 0, q.id)),
            left_out=sorted(self.left_out, key=lambda item: item.row or 0),
            chosen_out=self.chosen_out,
            second_look=sorted(self.second_look, key=lambda item: item.row or 0),
            differences=self.differences,
            not_read=self.sheet.not_read,
            sets=self.sets,
            removals=self.removals,
            changes=self._changes(people, links),
        )


def plan_sheet(sheet: Sheet, tree: Tree, answers: Mapping[str, str]) -> SheetPlan:
    return _Planner(sheet, tree, answers).plan()
