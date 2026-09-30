"""From what the files say to one family to import: merges, fixes and questions.

Nothing here touches the database. Every judgment call becomes a `Question` with a proposed
answer. The review file can change any answer, and the plan is rebuilt from the files each
time, so an answer never goes stale.
"""

import difflib
import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from ancestree.domain.dates import DateParseError, format_partial_date, parse_partial_date
from ancestree.domain.person import DateQualifier, Gender, PartialDate, Place
from ancestree.importing.names import (
    clean_spaces,
    gender_from_name,
    match_key,
    tidy_capitals,
    with_apostrophes,
)
from ancestree.importing.sources import Source, SourcePerson
from ancestree.lineage.birth_order import Sibling, compare_births, order_siblings
from ancestree.services.rules import Facts, life_notices, parent_child_notices

PLACEHOLDER_NAME = "Unknown parent"
UNNAMED_CHILD = "Unnamed child"
STAND_IN_AT_LEAST = 3  # this many unrelated people with one birthday: a stand-in, not a date

_TWO_DIGIT_YEAR = re.compile(r"^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2})$")


@dataclass(frozen=True)
class Question:
    id: str  # stable: built from names as the files write them
    title: str
    detail: str
    options: dict[str, str]  # answer -> what it does
    default: str


@dataclass
class Decisions:
    """The review file: answers by question id, genders by person label."""

    answers: dict[str, str] = field(default_factory=dict)
    genders: dict[str, Gender] = field(default_factory=dict)


@dataclass
class PlannedPerson:
    ref: str
    name: str
    sources: list[str]
    nickname: str | None = None
    gender: Gender = Gender.UNKNOWN
    birth_date: PartialDate | None = None
    death_date: PartialDate | None = None
    birth_place: Place | None = None
    residence: Place | None = None
    living: bool | None = None
    notes: list[str] = field(default_factory=list)
    birth_order: int | None = None
    placeholder: bool = False
    label: str = ""  # unique and readable, e.g. "Ahmad Nizam (child of Hassan & Siti)"


@dataclass(frozen=True)
class GenderChoice:
    label: str
    gender: Gender
    hint: str | None


@dataclass(frozen=True)
class FamilyOrder:
    parents: str
    children: tuple[str, ...]
    how: Literal["dates", "chart", "open"]


@dataclass
class ImportPlan:
    sources: list[Source]
    people: dict[str, PlannedPerson]
    parent_links: list[tuple[str, str]]  # (parent ref, child ref)
    marriages: list[tuple[str, str]]
    questions: list[Question]
    answers: dict[str, str]
    genders: list[GenderChoice]
    orders: list[FamilyOrder]
    notices: list[str]  # what the importer did or couldn't do
    warnings: list[str]  # facts that look wrong but are imported as they are
    merged: int

    @property
    def placeholders(self) -> int:
        return sum(person.placeholder for person in self.people.values())


@dataclass(frozen=True)
class _Claim:
    parent: str  # key
    child: str
    role: Literal["father", "mother"] | None  # None: from the chart, which doesn't say
    where: str


@dataclass
class _Family:
    parents: tuple[str, ...]  # refs
    children: list[str]  # refs, as drawn when `drawn`
    drawn: bool


def build_plan(
    sources: list[Source], decisions: Decisions | None = None, *, today: date | None = None
) -> ImportPlan:
    return _Planner(sources, decisions or Decisions(), today or date.today()).build()


class _Planner:
    def __init__(self, sources: list[Source], decisions: Decisions, today: date) -> None:
        self.sources = sources
        self.decisions = decisions
        self.today = today
        self.questions: list[Question] = []
        self.answers: dict[str, str] = {}
        self.notices: list[str] = [notice for source in sources for notice in source.notices]
        self.records: dict[str, SourcePerson] = {p.key: p for s in sources for p in s.people}
        self.origin: dict[str, Source] = {p.key: s for s in sources for p in s.people}
        self.written: dict[str, str] = {}  # the name as the file writes it (ids use this)
        self.names: dict[str, str] = {}  # the name to import
        self.notes: dict[str, list[str]] = defaultdict(list)
        self.births: dict[str, PartialDate | None] = {}
        self.deaths: dict[str, PartialDate | None] = {}
        self.stand_ins: set[str] = set()
        self.role_hints: dict[str, Gender] = {}
        self.group: dict[str, str] = {}
        self.people: dict[str, PlannedPerson] = {}
        self.links: dict[tuple[str, str], list[str]] = {}
        self.marriages: dict[frozenset[str], tuple[str, str]] = {}
        self.families: list[_Family] = []
        self.orders: list[FamilyOrder] = []
        self.merged = 0

    # --- Questions -----------------------------------------------------------------------

    def ask(self, question: Question) -> str:
        """The answer in the review file, or the proposed one."""
        answer = self.decisions.answers.get(question.id, question.default)
        if answer not in question.options:
            choices = ", ".join(question.options)
            self.notices.append(
                f"'{answer}' isn't an answer to \"{question.id}\" (choose {choices}); "
                f"'{question.default}' was used."
            )
            answer = question.default
        self.questions.append(question)
        self.answers[question.id] = answer
        return answer

    # --- The steps -----------------------------------------------------------------------

    def build(self) -> ImportPlan:
        claims = self._resolve_parent_names()
        self._clean_names()
        self._read_dates()
        self._merge()
        self._make_people()
        self._chart_families()
        self._spreadsheet_families(claims)
        self._too_many_parents()
        self._places()
        self._birth_order()
        self._label_people()
        genders = self._genders()
        return ImportPlan(
            sources=self.sources,
            people=self.people,
            parent_links=list(self.links),
            marriages=list(self.marriages.values()),
            questions=self.questions,
            answers=self.answers,
            genders=genders,
            orders=self.orders,
            notices=self.notices,
            warnings=self._warnings(),
            merged=self.merged,
        )

    def _resolve_parent_names(self) -> list[_Claim]:
        """Spreadsheet rows name parents: find them in the same file, or add them by name."""
        claims = []
        for source in self.sources:
            by_name: dict[str, list[str]] = defaultdict(list)
            for person in source.people:
                if person.name:
                    by_name[match_key(person.name)].append(person.key)
            for claim in source.parent_claims:
                key = match_key(claim.name)
                found = by_name.get(key, [])
                if len(found) > 1:
                    self.notices.append(
                        f"{claim.where} names '{claim.name}' as {claim.role}, but "
                        f"{len(found)} rows have that name; link the right one in the app."
                    )
                    continue
                if found:
                    parent = found[0]
                else:
                    parent = f"{source.kind}:named:{key}"
                    if parent not in self.records:
                        self.records[parent] = SourcePerson(
                            key=parent,
                            where=f"the {claim.role} named in {claim.where}",
                            name=claim.name,
                        )
                        self.origin[parent] = source
                        close = difflib.get_close_matches(key, list(by_name), n=1, cutoff=0.85)
                        hint = ""
                        if close:
                            spelled = self.records[by_name[close[0]][0]].name
                            hint = f" Is it a misspelling of '{spelled}'?"
                        self.notices.append(
                            f"{claim.where} names '{claim.name}' as {claim.role}, but no row "
                            f"has that name, so they were added from the name alone.{hint}"
                        )
                    by_name[key].append(parent)
                self.role_hints.setdefault(
                    parent, Gender.MALE if claim.role == "father" else Gender.FEMALE
                )
                claims.append(_Claim(parent, claim.child, claim.role, claim.where))
        return claims

    def _clean_names(self) -> None:
        for key, record in self.records.items():
            if record.name is None:
                continue
            written = clean_spaces(record.name)
            self.written[key] = written
            name = written
            if "*" in name:
                name = clean_spaces(name.replace("*", " "))
                self.notes[key].append(f"Written as '{written}' in {self.origin[key].name}.")
                self.notices.append(
                    f"{_sentence(record.where)}: the * was taken out of the name and kept "
                    "in their notes. What did it mean?"
                )
            self.names[key] = name

        backticks = {
            k: with_apostrophes(n) for k, n in self.names.items() if with_apostrophes(n) != n
        }
        if backticks:
            answer = self.ask(
                Question(
                    id="apostrophes",
                    title=f"Apostrophes in {len(backticks)} names",
                    detail="A backtick (`) where an apostrophe (') was meant: "
                    + _changes(self.names, backticks),
                    options={"yes": "use apostrophes", "no": "keep the names as written"},
                    default="yes",
                )
            )
            if answer == "yes":
                self.names.update(backticks)

        capitals = {k: tidy_capitals(n) for k, n in self.names.items() if tidy_capitals(n) != n}
        if capitals:
            answer = self.ask(
                Question(
                    id="capital letters",
                    title=f"Capital letters in {len(capitals)} names",
                    detail="Words typed all in lower case get a capital letter; bin and binti "
                    "stay as written: " + _changes(self.names, capitals),
                    options={"yes": "add the capital letters", "no": "keep the names as written"},
                    default="yes",
                )
            )
            if answer == "yes":
                self.names.update(capitals)

    def _read_dates(self) -> None:
        for key, record in self.records.items():
            self.births[key] = self._date(record.birth_text, record, "birth")
            self.deaths[key] = self._date(record.death_text, record, "death")
        for source in self.sources:
            self._stand_in_birthdays(source)

    def _date(self, text: str | None, record: SourcePerson, what: str) -> PartialDate | None:
        if text is None:
            return None
        if match := _TWO_DIGIT_YEAR.match(text):
            short = int(match[3])
            years = [y for y in (1900 + short, 2000 + short) if y <= self.today.year]
            if not years:
                return None
            year = years[0]
            if len(years) > 1:
                name = self.names.get(record.key) or record.where
                answer = self.ask(
                    Question(
                        id=f"two-digit year: {self.written.get(record.key, record.key)}",
                        title=f"{name}: '{text}' has a two-digit year",
                        detail=f"From {record.where}.",
                        options={str(y): f"born in {y}" for y in years} | {"unknown": "unknown"},
                        default=str(years[0]),
                    )
                )
                if answer == "unknown":
                    return None
                year = int(answer)
            else:
                self.notices.append(f"{_sentence(record.where)}: '{text}' was read as {year}.")
            text = f"{match[1]}/{match[2]}/{year}"
        try:
            return parse_partial_date(text)
        except DateParseError as error:
            self.notices.append(
                f"{_sentence(record.where)}: the {what} date '{text}' couldn't be read "
                f"({error}), so it was left unknown."
            )
            return None

    def _stand_in_birthdays(self, source: Source) -> None:
        """One birthday for several people who aren't twins stands in for "unknown"."""
        same_day: dict[tuple[int, int, int], list[str]] = defaultdict(list)
        for person in source.people:
            born = self.births.get(person.key)
            if (
                born
                and born.day
                and born.month
                and born.year
                and born.qualifier is DateQualifier.EXACT
            ):
                same_day[(born.day, born.month, born.year)].append(person.key)
        for (day, month, year), keys in same_day.items():
            if len(keys) < STAND_IN_AT_LEAST or self._twins(source, keys):
                continue
            text = f"{day}/{month}/{year}"
            answer = self.ask(
                Question(
                    id=f"stand-in birthday: {text} in {source.name}",
                    title=f"{len(keys)} people share the birthday {text}",
                    detail=f"In {source.name}: {_listed(self.names[k] for k in keys)}. They "
                    "aren't twins, so the date looks like a stand-in for 'unknown'.",
                    options={"unknown": "their birthdays are unknown", "keep": f"keep {text}"},
                    default="unknown",
                )
            )
            if answer != "unknown":
                continue
            for key in keys:
                self.births[key] = None
                self.stand_ins.add(key)
            # The same day and month in another year: perhaps only that year is real.
            for person in source.people:
                born = self.births.get(person.key)
                if born is None or (born.day, born.month) != (day, month):
                    continue
                shown = format_partial_date(born)
                answer = self.ask(
                    Question(
                        id=f"birthday: {self.written[person.key]}",
                        title=f"{self.names[person.key]}: is the birthday {shown} exact?",
                        detail=f"It has the same day and month as the stand-in {text}, so "
                        f"perhaps only the year {born.year} is known.",
                        options={
                            "exact": f"keep {shown}",
                            "year": f"keep only the year, {born.year}",
                            "unknown": "unknown",
                        },
                        default="exact",
                    )
                )
                if answer == "year":
                    self.births[person.key] = PartialDate(year=born.year)
                elif answer == "unknown":
                    self.births[person.key] = None

    def _twins(self, source: Source, keys: list[str]) -> bool:
        """Whether everyone in `keys` has the same parents in this file."""
        parents: dict[str, frozenset[str]] = {}
        for claim in source.parent_claims:
            parents[claim.child] = parents.get(claim.child, frozenset()) | {match_key(claim.name)}
        for marriage in source.marriages:
            for child in marriage.children:
                parents[child] = parents.get(child, frozenset()) | {marriage.key}
        known = {parents.get(key, frozenset()) for key in keys}
        return len(known) == 1 and known != {frozenset()}

    def _merge(self) -> None:
        """The same name in two files is proposed as one person; within one file, never."""
        root = {key: key for key in self.records}

        def find(key: str) -> str:
            while root[key] != key:
                root[key] = root[root[key]]
                key = root[key]
            return key

        by_name: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
        order = {id(source): n for n, source in enumerate(self.sources)}
        for key in self.names:
            by_name[match_key(self.names[key])][order[id(self.origin[key])]].append(key)
        for per_file in by_name.values():
            if len(per_file) < 2:
                continue
            if any(len(keys) > 1 for keys in per_file.values()):
                first = next(iter(per_file.values()))[0]
                self.notices.append(
                    f"'{self.names[first]}' appears more than once in one file, so no one of "
                    "that name was matched across files. Link them in the app if needed."
                )
                continue
            keys = [per_file[n][0] for n in sorted(per_file)]
            answer = self.ask(
                Question(
                    id=f"same person: {self.written[keys[0]]}",
                    title=f"Same person in both files: {self.names[keys[0]]}",
                    detail=_listed(self.records[k].where for k in keys) + ".",
                    options={"yes": "import them as one person", "no": "keep them apart"},
                    default="yes",
                )
            )
            if answer == "yes":
                self.merged += 1
                for key in keys[1:]:
                    root[find(key)] = find(keys[0])
        self.group = {key: find(key) for key in self.records}

    def _make_people(self) -> None:
        members: dict[str, list[str]] = defaultdict(list)
        for key in self.names:  # named people; blank boxes are placed with their families
            members[self.group[key]].append(key)
        for ref, keys in members.items():
            first = keys[0]
            person = PlannedPerson(
                ref=ref,
                name=self.names[first],
                sources=[self.records[k].where for k in keys],
                notes=[note for k in keys for note in self.notes[k]],
            )
            self._nickname(person, keys)
            self._gender(person, keys)
            person.birth_date = self._one_date(person, keys, self.births, "birth date")
            person.death_date = self._one_date(person, keys, self.deaths, "death date")
            person.living = next(
                (self.records[k].living for k in keys if self.records[k].living is not None),
                None,
            )
            person.notes += [line for k in keys for line in self.records[k].extra]
            self.people[ref] = person

    def _nickname(self, person: PlannedPerson, keys: list[str]) -> None:
        nicknames: dict[str, str] = {}
        for key in keys:
            nickname = self.records[key].nickname
            if nickname:
                nicknames.setdefault(nickname.casefold(), with_apostrophes(nickname))
        if not nicknames:
            return
        choices = list(nicknames.values())
        chosen = choices[0]
        if len(choices) > 1:
            chosen = self.ask(
                Question(
                    id=f"nickname: {self.written[keys[0]]}",
                    title=f"{person.name} has two nicknames: {' and '.join(choices)}",
                    detail="The files differ. The other one is kept in their notes.",
                    options={choice: f"call them {choice}" for choice in choices},
                    default=choices[0],
                )
            )
        person.nickname = chosen
        person.notes += [f"Also called {other}." for other in choices if other != chosen]

    def _gender(self, person: PlannedPerson, keys: list[str]) -> None:
        stated = [self.records[k].gender for k in keys if self.records[k].gender]
        by_name = gender_from_name(person.name)
        if stated:
            person.gender = stated[0] or Gender.UNKNOWN
            if by_name and by_name is not stated[0]:
                self.notices.append(
                    f"{person.name} is recorded as {stated[0]}, but the name says "
                    f"{by_name}. Check them in the app."
                )
        elif by_name:
            person.gender = by_name
        else:
            person.gender = next(
                (self.role_hints[k] for k in keys if k in self.role_hints), Gender.UNKNOWN
            )

    def _one_date(
        self,
        person: PlannedPerson,
        keys: list[str],
        dates: dict[str, PartialDate | None],
        what: str,
    ) -> PartialDate | None:
        found: dict[str, tuple[PartialDate, str]] = {}
        for key in keys:
            value = dates.get(key)
            if value is not None:
                found.setdefault(format_partial_date(value), (value, self.records[key].where))
        if len(found) <= 1:
            return next(iter(found.values()))[0] if found else None
        answer = self.ask(
            Question(
                id=f"{what}: {self.written[keys[0]]}",
                title=f"{person.name}: the files give different {what}s",
                detail=_listed(f"{text} in {where}" for text, (_, where) in found.items()) + ".",
                options={text: f"from {where}" for text, (_, where) in found.items()}
                | {"unknown": "unknown"},
                default=next(iter(found)),
            )
        )
        return None if answer == "unknown" else found[answer][0]

    def _placeholder(self, ref: str) -> str:
        if ref not in self.people:
            self.people[ref] = PlannedPerson(
                ref=ref, name=PLACEHOLDER_NAME, sources=[], placeholder=True
            )
        return ref

    def _link(self, parent: str, child: str, where: str) -> None:
        if parent == child:
            self.notices.append(f"{where}: someone was given as their own parent; left out.")
            return
        self.links.setdefault((parent, child), []).append(where)

    def _marry(self, a: str, b: str) -> None:
        if a != b:
            self.marriages.setdefault(frozenset((a, b)), (a, b))

    def _chart_families(self) -> None:
        for source in self.sources:
            for marriage in source.marriages:
                named = [self.group[k] for k in marriage.spouses if k in self.names]
                blanks = [k for k in marriage.spouses if k not in self.names]
                if len(named) > 2:
                    self.notices.append(
                        f"A Kahwin circle joins {len(named)} people "
                        f"({_listed(self.people[r].name for r in named)}); it was left out."
                    )
                    continue
                children = self._chart_children(marriage.children, named)
                if len(named) == 2:
                    self._marry(named[0], named[1])
                    if (
                        self.people[named[0]].name.casefold()
                        == self.people[named[1]].name.casefold()
                    ):
                        self.notices.append(
                            f"Two different people named {self.people[named[0]].name} are "
                            "married to each other in the chart. They're kept as two people; "
                            "if one name is wrong, correct it in the app."
                        )
                if not children:
                    continue
                parents = list(named)
                if len(parents) < 2:
                    # Children with one known parent: the other is unknown, not absent.
                    ref = blanks[0] if blanks else f"unknown:{marriage.key}"
                    parents.append(self._placeholder(ref))
                for child in children:
                    for parent in parents:
                        self._link(parent, child, "the chart")
                self.families.append(_Family(tuple(parents), children, drawn=True))

    def _chart_children(self, keys: tuple[str, ...], parents: list[str]) -> list[str]:
        children = []
        blanks = 0
        for key in keys:
            if key in self.names:
                children.append(self.group[key])
                continue
            blanks += 1
            names = " & ".join(self.people[p].name for p in parents) or "unknown parents"
            written = " & ".join(self.written[self._key_of(p)] for p in parents) or key
            answer = self.ask(
                Question(
                    id=f"blank child {blanks}: {written}",
                    title=f"A blank box among the children of {names}",
                    detail="A child whose name wasn't written down.",
                    options={
                        "add": f"add them as '{UNNAMED_CHILD}'",
                        "skip": "leave the box out",
                    },
                    default="add",
                )
            )
            if answer == "add":
                self.people[key] = PlannedPerson(
                    ref=key,
                    name=UNNAMED_CHILD,
                    sources=["a blank box in the chart"],
                    notes=["A blank box in the chart: the name wasn't written down."],
                )
                children.append(key)
        return children

    def _spreadsheet_families(self, claims: list[_Claim]) -> None:
        by_child: dict[str, dict[str, _Claim]] = defaultdict(dict)
        for claim in claims:
            parent, child = self.group[claim.parent], self.group[claim.child]
            if not self._role_fits(claim, parent, child):
                continue
            by_child[child][parent] = claim
            self._link(parent, child, claim.where)

        # Children with the same parents form one family; parents stay in the row's order.
        families: dict[frozenset[str], tuple[tuple[str, ...], list[str]]] = {}
        for child, named in by_child.items():
            families.setdefault(frozenset(named), (tuple(named), []))[1].append(child)
        for parents, children in families.values():
            self.families.append(_Family(parents, children, drawn=False))
            if len(parents) == 2 and frozenset(parents) not in self.marriages:
                a, b = (self.people[p] for p in parents)
                kids = _listed(self.people[c].name for c in children)
                answer = self.ask(
                    Question(
                        id=f"couple: {self.written[self._key_of(a.ref)]} & "
                        f"{self.written[self._key_of(b.ref)]}",
                        title=f"Were {a.name} and {b.name} married?",
                        detail=f"They're both parents of {kids}; the spreadsheet has no column "
                        "for marriages.",
                        options={"yes": "record them as married", "no": "don't"},
                        default="yes",
                    )
                )
                if answer == "yes":
                    self._marry(a.ref, b.ref)

    def _key_of(self, ref: str) -> str:
        return ref if ref in self.written else next(k for k, r in self.group.items() if r == ref)

    def _role_fits(self, claim: _Claim, parent: str, child: str) -> bool:
        """A woman given as a father (or a man as a mother) is most likely a typing slip."""
        gender = self.people[parent].gender
        wrong = (claim.role == "father" and gender is Gender.FEMALE) or (
            claim.role == "mother" and gender is Gender.MALE
        )
        if not wrong:
            return True
        person, kid = self.people[parent], self.people[child]
        charted = [
            self.people[p].name
            for (p, c), where in self.links.items()
            if c == child and p != parent and "the chart" in where
        ]
        detail = f"{claim.where} gives {person.name} as the {claim.role} of {kid.name}."
        if charted:
            detail += f" The chart gives {_listed(charted)} as the parents."
        answer = self.ask(
            Question(
                id=f"{claim.role} is a {'woman' if claim.role == 'father' else 'man'}: "
                f"{self.written[self._key_of(child)]}",
                title=f"{person.name} is given as the {claim.role} of {kid.name}",
                detail=detail,
                options={"leave-out": "leave this parent out", "keep": "keep them as a parent"},
                default="leave-out",
            )
        )
        return answer == "keep"

    def _too_many_parents(self) -> None:
        parents: dict[str, list[str]] = defaultdict(list)
        for parent, child in self.links:
            parents[child].append(parent)
        for child, found in parents.items():
            if len(found) <= 2:
                continue
            names = {p: self.people[p].label or self.people[p].name for p in found}
            # An unknown parent gives way to a named one; otherwise, one that a single file gives.
            unknown = [p for p in found if self.people[p].placeholder]
            single = [p for p in found if len(self.links[(p, child)]) == 1]
            default = unknown[0] if unknown else (single[-1] if single else found[-1])
            answer = self.ask(
                Question(
                    id=f"too many parents: {self.people[child].name}",
                    title=f"{self.people[child].name} would have {len(found)} parents",
                    detail="The files disagree: " + _listed(names.values()) + ".",
                    options={f"without {names[p]}": f"leave out {names[p]}" for p in found},
                    default=f"without {names[default]}",
                )
            )
            dropped = next(p for p in found if answer == f"without {names[p]}")
            del self.links[(dropped, child)]

    def _places(self) -> None:
        """Places come from the spreadsheet; ask when they look like filled-in defaults."""
        placed = [
            (ref, key)
            for key, ref in self.group.items()
            if key in self.names and (self.records[key].birth_place or self.records[key].residence)
        ]
        if not placed:
            return
        distinct = {
            place
            for _, key in placed
            for place in (self.records[key].birth_place, self.records[key].residence)
            if place
        }
        options = {"keep": "keep them for everyone"}
        if self.stand_ins:
            options["not-stand-ins"] = "leave them out where the birthday was a stand-in"
        options["none"] = "leave all places out"
        detail = f"{len(placed)} rows give places."
        if len(distinct) == 1:
            only = next(iter(distinct))
            shown = ", ".join(part for part in (only.town, only.state, only.country) if part)
            detail = (
                f"Every one of the {len(placed)} rows gives {shown} as both birthplace and "
                "home, which may be a default rather than a fact."
            )
        answer = self.ask(
            Question(
                id="spreadsheet places",
                title="Birthplaces and homes from the spreadsheet",
                detail=detail,
                options=options,
                default="keep",
            )
        )
        for ref, key in placed:
            if answer == "none" or (answer == "not-stand-ins" and key in self.stand_ins):
                continue
            person = self.people[ref]
            person.birth_place = person.birth_place or self.records[key].birth_place
            person.residence = person.residence or self.records[key].residence

    def _birth_order(self) -> None:
        """Dates decide where they can; otherwise the chart's left-to-right order, if agreed."""
        families: dict[frozenset[str], _Family] = {}
        for family in self.families:
            key = frozenset(family.parents)
            if key in families:
                known = families[key]
                extra = [c for c in family.children if c not in known.children]
                if extra:
                    known.children += extra
                    known.drawn = known.drawn and family.drawn
                elif family.drawn and not known.drawn:
                    families[key] = family
            else:
                families[key] = _Family(family.parents, list(family.children), family.drawn)

        by_chart: list[_Family] = []
        for family in families.values():
            if len(family.children) < 2:
                continue
            siblings = [self._sibling(ref, n) for n, ref in enumerate(family.children)]
            _, decided = order_siblings(siblings)
            if decided:
                self._check_drawn_order(family, siblings)
                self._record_order(family, "dates")
            elif family.drawn and self._check_drawn_order(family, siblings):
                by_chart.append(family)
            else:
                self._record_order(family, "open")
                names = _listed(self.people[c].name for c in family.children)
                self.notices.append(
                    f"The dates can't fully order {names} (a shared or missing birthday): "
                    "drag them into order in the app."
                )
        if not by_chart:
            return
        answer = self.ask(
            Question(
                id="chart birth order",
                title=f"Birth order for {len(by_chart)} families, from the chart",
                detail="Their dates can't decide the order, so the chart's left-to-right order "
                "(eldest first) is used. The families are listed in the report.",
                options={"yes": "use the chart's order", "no": "leave the order open"},
                default="yes",
            )
        )
        for family in by_chart:
            if answer == "yes":
                for position, child in enumerate(family.children, start=1):
                    self.people[child].birth_order = position
            self._record_order(family, "chart" if answer == "yes" else "open")

    def _sibling(self, ref: str, position: int) -> Sibling:
        person = self.people[ref]
        return Sibling(ref, person.gender, person.birth_date, None, f"{position:04d}")

    def _check_drawn_order(self, family: _Family, siblings: list[Sibling]) -> bool:
        """Whether the chart's order agrees with the dates it can be checked against."""
        if not family.drawn:
            return True
        for n, first in enumerate(siblings):
            for later in siblings[n + 1 :]:
                if (compare_births(first.birth_date, later.birth_date) or 0) > 0:
                    self.notices.append(
                        f"The chart draws {self.people[first.id].name} before "
                        f"{self.people[later.id].name}, but the dates say otherwise: the "
                        "dates decide."
                    )
                    return False
        return True

    def _record_order(self, family: _Family, how: Literal["dates", "chart", "open"]) -> None:
        names = " & ".join(self.people[p].name for p in family.parents)
        children = tuple(self.people[c].name for c in family.children)
        self.orders.append(FamilyOrder(names, children, how))

    def _label_people(self) -> None:
        counts: dict[str, int] = defaultdict(int)
        for person in self.people.values():
            if not person.placeholder:
                counts[person.name.casefold()] += 1
        parents: dict[str, list[str]] = defaultdict(list)
        for parent, child in self.links:
            parents[child].append(parent)
        spouses: dict[str, list[str]] = defaultdict(list)
        for a, b in self.marriages.values():
            spouses[a].append(b)
            spouses[b].append(a)
        for person in self.people.values():
            person.label = person.name
            if not person.placeholder and counts[person.name.casefold()] > 1:
                known = [self.people[p].name for p in parents[person.ref]]
                if known:
                    context = "child of " + " & ".join(known)
                elif spouses[person.ref]:
                    context = "married to " + " & ".join(
                        self.people[s].name for s in spouses[person.ref]
                    )
                else:
                    context = person.sources[0] if person.sources else person.ref
                person.label = f"{person.name} ({context})"
        # Still the same (two Ahmads married to each other, say): number them as listed.
        taken: dict[str, int] = defaultdict(int)
        for person in self.people.values():
            taken[person.label] += 1
        seen: dict[str, int] = defaultdict(int)
        for person in self.people.values():
            if not person.placeholder and taken[person.label] > 1:
                seen[person.label] += 1
                person.label = f"{person.label} #{seen[person.label]}"

    def _genders(self) -> list[GenderChoice]:
        spouses: dict[str, list[str]] = defaultdict(list)
        for a, b in self.marriages.values():
            spouses[a].append(b)
            spouses[b].append(a)
        choices = []
        for person in self.people.values():
            if person.placeholder or person.gender is not Gender.UNKNOWN:
                continue
            hint = None
            proposed = Gender.UNKNOWN
            known = [self.people[s] for s in spouses[person.ref]]
            known = [s for s in known if s.gender is not Gender.UNKNOWN]
            if len(known) == 1:
                proposed = Gender.FEMALE if known[0].gender is Gender.MALE else Gender.MALE
                hint = f"married to {known[0].name}"
            gender = self.decisions.genders.get(person.label, proposed)
            person.gender = gender
            choices.append(GenderChoice(person.label, gender, hint))
        return choices

    def _warnings(self) -> list[str]:
        facts = {
            ref: Facts(person.name, person.gender, person.birth_date, person.death_date)
            for ref, person in self.people.items()
            if not person.placeholder
        }
        messages = [notice.message for fact in facts.values() for notice in life_notices(fact)]
        for parent, child in self.links:
            if parent in facts and child in facts:
                messages += [
                    notice.message
                    for notice in parent_child_notices(facts[parent], facts[child], blood=True)
                ]
        return list(dict.fromkeys(messages))


def _listed(items: Iterable[str]) -> str:
    names = list(items)
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _changes(before: dict[str, str], after: dict[str, str]) -> str:
    return "; ".join(dict.fromkeys(f"{before[key]} -> {after[key]}" for key in after))


def _sentence(text: str) -> str:
    return text[:1].upper() + text[1:]
