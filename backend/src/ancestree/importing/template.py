"""The import template, empty or filled in with the fictional test family.

The example shows every column in use: IDs of your own, dates as typed, places, a second
marriage, a divorce, an adoption, and parents named by their full names.
"""

import csv
import io

from ancestree.domain.dates import format_partial_date
from ancestree.domain.person import Gender
from ancestree.domain.relationship import BIOLOGICAL, SpouseStatus
from ancestree.exchange.spreadsheet import guard, place_shown
from ancestree.importing.sheet import READ
from ancestree.seed.family import SeedFamily, load_seed_family

_GENDER = {Gender.MALE: "Male", Gender.FEMALE: "Female", Gender.UNKNOWN: ""}
# Version only ever comes from an export: it says what each row was when it was written.
TEMPLATE = tuple(column for column in READ if column != "Version")


def _example_rows(family: SeedFamily) -> list[dict[str, str]]:
    people = {p.key: p for p in family.people}
    real = [p for p in family.people if not p.placeholder]
    parents: dict[str, list[str]] = {p.key: [] for p in real}
    for unit in family.families:
        for child in unit.children:
            for parent in unit.parents:
                if people[parent].placeholder:
                    continue
                label = "" if unit.kind == BIOLOGICAL else f" ({unit.kind})"
                parents[child].append(people[parent].full_name + label)
    spouses: dict[str, list[str]] = {p.key: [] for p in real}
    for marriage in family.marriages:
        a, b = marriage.spouses
        former = " (former)" if marriage.status is SpouseStatus.DIVORCED else ""
        spouses[a].append(people[b].full_name + former)
        spouses[b].append(people[a].full_name + former)
    return [
        {
            "ID": p.key,
            "Full name": p.full_name,
            "Nickname": p.nickname or "",
            "Gender": _GENDER[p.gender],
            "Born": format_partial_date(p.birth) if p.birth else "",
            "Birthplace": place_shown(p.birth_place),
            "Died": format_partial_date(p.death) if p.death else "",
            "Lives in": place_shown(p.residence),
            "Parents": "; ".join(parents[p.key]),
            "Spouses": "; ".join(spouses[p.key]),
        }
        for p in real
    ]


def template_csv(*, example: bool = False) -> str:
    """The template's text; save it as UTF-8 with a byte-order mark, as Excel expects."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(TEMPLATE)
    for row in _example_rows(load_seed_family()) if example else []:
        writer.writerow(guard(row.get(column, "")) for column in TEMPLATE)
    return buffer.getvalue()
