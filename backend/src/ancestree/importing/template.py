"""The import template, empty or filled in with the example family.

The example is the example family, every column a spreadsheet can carry used: titles,
Jawi names and nicknames; dates as typed; every place with its country, as the spreadsheet
export writes it; addresses, postcodes, districts and a location put on the map by hand;
living or not, occupations, burial places and notes; parents, spouses and children, with a
second marriage, a divorce, a marriage ended by a death and an adoption; and IDs of its own.
"""

import csv
import io

from ancestree.domain.dates import format_partial_date
from ancestree.domain.person import Gender, PartialDate, Person, death_places
from ancestree.domain.relationship import BIOLOGICAL, SpouseStatus
from ancestree.exchange.family import place_text
from ancestree.exchange.spreadsheet import guard, location_text
from ancestree.importing.sheet import READ
from ancestree.seed.example import ExampleFamily, load_example_family
from ancestree.services.detail import is_living

_GENDER = {Gender.MALE: "Male", Gender.FEMALE: "Female", Gender.UNKNOWN: ""}
_PARENT = {Gender.MALE: "father", Gender.FEMALE: "mother", Gender.UNKNOWN: "parent"}
_SPOUSE = {Gender.MALE: "husband", Gender.FEMALE: "wife", Gender.UNKNOWN: "spouse"}
# Version only ever comes from an export: it says what each row was when it was written.
TEMPLATE = tuple(column for column in READ if column != "Version")


def _date(value: PartialDate | None) -> str:
    return format_partial_date(value) if value else ""


def _example_rows(family: ExampleFamily) -> list[dict[str, str]]:
    people: dict[str, Person] = {
        each.key: person
        for each, person in zip(family.people, family.people_as_domain(), strict=True)
    }
    real = [key for key, person in people.items() if not person.placeholder]
    parents: dict[str, list[str]] = {key: [] for key in real}
    children: dict[str, list[str]] = {key: [] for key in real}
    for unit in family.families:
        for child in unit.children:
            for parent in unit.parents:
                if people[parent].placeholder:
                    continue  # an unknown parent is no one a spreadsheet can name
                who = people[parent]
                label = _PARENT[who.gender] if unit.kind == BIOLOGICAL else unit.kind
                parents[child].append(f"{who.full_name} ({label})")
                children[parent].append(people[child].full_name)
    spouses: dict[str, list[str]] = {key: [] for key in real}
    for marriage in sorted(family.marriages, key=lambda each: each.order or 0):
        a, b = marriage.spouses
        for one, other in ((a, b), (b, a)):
            word = _SPOUSE[people[other].gender]
            if marriage.status is SpouseStatus.DIVORCED:
                word = f"former {word}"
            elif marriage.status is SpouseStatus.WIDOWED:
                word = "widowed"
            spouses[one].append(f"{people[other].full_name} ({word})")

    rows = []
    for key in real:
        p = people[key]
        home = p.residence
        rows.append(
            {
                "ID": key,
                "Full name": p.full_name,
                "Nickname": p.nickname or "",
                "Title": p.title or "",
                "Name in Jawi": p.name_jawi or "",
                "Gender": _GENDER[p.gender],
                "Born": _date(p.birth_date),
                "Birthplace": place_text(p.birth_place) or "",
                "Died": _date(p.death_date),
                "Death place": place_text(p.death_place) or "",
                "Burial place": p.burial_place or "",
                "Lives in": place_text(home) or "",
                "Address": (home.address if home else None) or "",
                "Postcode": (home.postcode if home else None) or "",
                "District": (home.district if home else None) or "",
                "Location": location_text(home),
                "Living": "yes" if is_living(p) else "no",
                "Occupation": p.occupation or "",
                "Parents": "; ".join(parents[key]),
                "Spouses": "; ".join(spouses[key]),
                "Children": "; ".join(children[key]),
                "Notes": p.notes or "",
            }
        )
    return rows


def template_csv(*, example: bool = False) -> str:
    """The template's text; save it as UTF-8 with a byte-order mark, as Excel expects."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, quoting=csv.QUOTE_ALL)  # no ";" splits a cell in Excel
    # No place of death while it's unshown: an import wouldn't read it.
    columns = [c for c in TEMPLATE if c != "Death place" or death_places()]
    writer.writerow(columns)
    for row in _example_rows(load_example_family()) if example else []:
        writer.writerow(guard(row.get(column, "")) for column in columns)
    return buffer.getvalue()
