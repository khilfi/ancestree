"""Everyone in a spreadsheet, one row per person, for a quick look in Excel. From M13
it's also what an import reads, so a file exported here can be filled in and brought
back.

Dates are written the way the app takes them ("12/3/1950", "c. 1950"). The file is saved as
UTF-8 with a byte-order mark, which is how Excel recognises Jawi and other non-English text.
A cell that Excel would take for a formula gets an apostrophe in front: names can come
from someone else's spreadsheet, and an import takes the apostrophe off again.

From M19 each row also says, in its Version, what its details were when it was exported: a
short fingerprint of each. An import can then tell which were changed in the file and which
in the tree since, so your later changes aren't taken for old values. Remove, empty in
an export, is for marking someone to take out of the tree.
"""

import base64
import csv
import hashlib
import io
from collections import defaultdict
from collections.abc import Mapping

from ancestree.domain.dates import format_partial_date
from ancestree.domain.person import Gender, PartialDate, Place, death_places
from ancestree.domain.relationship import SpouseStatus
from ancestree.exchange.family import FamilyData, Member, place_text
from ancestree.services.detail import is_living

ENCODING = "utf-8-sig"
COLUMNS = (
    "ID",
    "Full name",
    "Nickname",
    "Title",
    "Name in Jawi",
    "Gender",
    "Born",
    "Birthplace",
    "Died",
    "Death place",
    "Burial place",
    "Lives in",
    "Living",
    "Occupation",
    "Parents",
    "Spouses",
    "Children",
    "Photo",
    "Story (words)",
    "Sources",
    "Notes",
    "Remove",
    "Version",
)
# Where they live, to the house: after "Lives in", only when addresses are chosen.
ADDRESS_COLUMNS = ("Address", "Postcode")
# The details a row's Version records, by column and field, in this order.
VERSIONED = (
    ("Full name", "full_name"),
    ("Nickname", "nickname"),
    ("Title", "title"),
    ("Name in Jawi", "name_jawi"),
    ("Gender", "gender"),
    ("Born", "birth_date"),
    ("Birthplace", "birth_place"),
    ("Died", "death_date"),
    ("Death place", "death_place"),
    ("Burial place", "burial_place"),
    ("Lives in", "residence"),
    ("Living", "living"),
    ("Occupation", "occupation"),
    ("Notes", "notes"),
)
_VERSION = "v1."
_BYTES = 3  # of each detail's fingerprint
_GENDER = {Gender.MALE: "Male", Gender.FEMALE: "Female", Gender.UNKNOWN: ""}
_SPOUSE = {Gender.MALE: "husband", Gender.FEMALE: "wife", Gender.UNKNOWN: "spouse"}
# How a cell Excel or another spreadsheet would run as a formula starts, also in full width,
# and after spaces, which Excel passes over.
_FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r", *map(chr, (0xFF1D, 0xFF0B, 0xFF0D, 0xFF20)))


def _formula(text: str) -> bool:
    return text.lstrip(" ").startswith(_FORMULA_STARTS)


def place_shown(place: Place | None) -> str:
    """ "Kota Bharu, Kelantan", with the country only when it isn't Malaysia."""
    if place is None or place.is_empty:
        return ""
    country = place.country if place.country != "Malaysia" else None
    return ", ".join(part for part in (place.town, place.state, country) if part)


def shown(value: object) -> str:
    """A detail as the import compares and shows it: a date, place, gender or yes/no as text."""
    if value is None:
        return ""
    if isinstance(value, Gender):
        return _GENDER[value]
    if isinstance(value, PartialDate):
        return format_partial_date(value)
    if isinstance(value, Place):
        return place_shown(value)
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


def fingerprint(text: str) -> bytes:
    """A detail's fingerprint in a Version: three bytes of its hash, spaces and capitals
    aside. A change then goes unnoticed about once in 8 million."""
    return hashlib.sha256(" ".join(text.split()).casefold().encode("utf-8")).digest()[:_BYTES]


def row_version(values: Mapping[str, str]) -> str:
    """A row's Version: each VERSIONED detail's fingerprint, from what's shown (`shown`)."""
    data = b"".join(fingerprint(values.get(name, "")) for _, name in VERSIONED)
    return _VERSION + base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def read_version(text: str) -> dict[str, bytes] | None:
    """The fingerprints in a Version, by field; None if it isn't one AncesTree wrote."""
    if not text.startswith(_VERSION):
        return None
    body = text[len(_VERSION) :]
    try:
        data = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    except ValueError:
        return None
    if len(data) != _BYTES * len(VERSIONED):
        return None
    return {name: data[_BYTES * i : _BYTES * (i + 1)] for i, (_, name) in enumerate(VERSIONED)}


def guard(value: object) -> object:
    """A cell Excel would run as a formula ("=HYPERLINK(...)"), made plain text."""
    if isinstance(value, str) and _formula(value):
        return "'" + value
    return value


def unguard(text: str) -> str:
    """A guarded cell as it was written."""
    if text.startswith("'") and _formula(text[1:]):
        return text[1:]
    return text


def _date(date: PartialDate | None) -> str:
    return format_partial_date(date) if date else ""


def _yes_no(value: bool | None) -> str:
    return "" if value is None else ("yes" if value else "no")


def _words(story: str) -> int | str:
    """Words in a story, not counting Markdown's marks such as ## and -."""
    count = sum(1 for word in story.split() if any(char.isalnum() for char in word))
    return count or ""


def write_people_csv(data: FamilyData, *, addresses: bool = False) -> str:
    """The spreadsheet's text; save it with ENCODING. With `addresses`, where each lives
    to the house: the address and postcode, after "Lives in"."""
    parents_of: dict[str, list[tuple[str, str]]] = defaultdict(list)
    children_of: dict[str, list[str]] = defaultdict(list)
    for row in data.parents:
        parents_of[row.child].append((row.parent, row.kind))
        children_of[row.parent].append(row.child)
    spouses_of: dict[str, list[tuple[int, str, SpouseStatus]]] = defaultdict(list)
    for link in data.spouses:
        spouses_of[link.a].append((link.order or 50, link.b, link.status))
        spouses_of[link.b].append((link.order or 50, link.a, link.status))

    def name(person_id: str) -> str:
        return data.members[person_id].person.full_name

    def real(person_id: str) -> bool:
        return not data.members[person_id].person.placeholder

    def parents(member: Member) -> str:
        known = [(p, kind) for p, kind in parents_of[member.id] if real(p)]
        # Birth parents first, fathers before mothers; then adoptive, foster and others.
        known.sort(
            key=lambda row: (
                not data.is_blood(row[1]),
                data.kinds[row[1]].sort_order if row[1] in data.kinds else 99,
                data.members[row[0]].person.gender is not Gender.MALE,
            )
        )
        words = []
        for parent, kind in known:
            gender = data.members[parent].person.gender
            label = data.kinds[kind].parent_label.for_gender(gender) if kind in data.kinds else kind
            words.append(f"{name(parent)} ({label})")
        return "; ".join(words)

    def spouses(member: Member) -> str:
        words = []
        for _, other, status in sorted(spouses_of[member.id], key=lambda row: row[0]):
            if not real(other):
                continue
            noun = _SPOUSE[data.members[other].person.gender]
            words.append(
                f"{name(other)} ({'former ' if status is SpouseStatus.DIVORCED else ''}{noun})"
            )
        return "; ".join(words)

    def children(member: Member) -> str:
        kids = [child for child in dict.fromkeys(children_of[member.id]) if real(child)]
        return "; ".join(name(child) for child in data.eldest_first(kids))

    buffer = io.StringIO(newline="")
    # Excel's own dialect: commas, "quotes", \r\n. Every cell quoted, so that an Excel that
    # splits on ";", as it does where commas are decimal points, never splits one.
    writer = csv.writer(buffer, quoting=csv.QUOTE_ALL)
    lives_in = COLUMNS.index("Lives in") + 1
    header = list(COLUMNS)
    if addresses:
        header[lives_in:lives_in] = ADDRESS_COLUMNS
    # The place of death kept, but sent to no one: no column, and no trace in a Version.
    unsent = None if death_places() else COLUMNS.index("Death place")
    if unsent is not None:
        del header[unsent]
    writer.writerow(header)
    rows = sorted(data.people(), key=lambda m: (m.person.full_name.casefold(), m.id))
    for member in rows:
        p = member.person
        living = is_living(p)
        details = {name: living if name == "living" else getattr(p, name) for _, name in VERSIONED}
        if unsent is not None:
            details["death_place"] = None
        version = row_version({name: shown(value) for name, value in details.items()})
        cells = [
            guard(cell)
            for cell in (
                member.id,
                p.full_name,
                p.nickname or "",
                p.title or "",
                p.name_jawi or "",
                _GENDER[p.gender],
                _date(p.birth_date),
                place_text(p.birth_place) or "",
                _date(p.death_date),
                place_text(p.death_place) or "",
                p.burial_place or "",
                place_text(p.residence) or "",
                _yes_no(living),
                p.occupation or "",
                parents(member),
                spouses(member),
                children(member),
                "yes" if p.has_photo else "",
                _words(member.story),
                "; ".join(member.sources),
                p.notes or "",
                "",  # Remove: for marking someone to take out, and bringing it back
                version,
            )
        ]
        if addresses:
            home = p.residence
            cells[lives_in:lives_in] = [
                guard(home.address or "") if home else "",
                guard(home.postcode or "") if home else "",
            ]
        if unsent is not None:
            del cells[unsent]
        writer.writerow(cells)
    return buffer.getvalue()
