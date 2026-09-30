"""A view-only copy's family: every answer the copy
gives, made by the app's own code.

Where the app asks the API, a copy looks the answer up here: the graph, each person in the
three kinship languages, the stories, photos and story pictures, Family facts, the words, and
the exports as they are today. Each is made by the same service the API uses, so a copy
answers as the app would. The graph comes with the seats around each other centre a viewer may
choose, since a view-only copy seats no one itself. How any two people are
related is worked out in the copy, by a twin of the kinship engine, from the graph and the word
lists carried here. Living people's details can be hidden, and the whole locked
with a password; then it goes into the copy's page, in place of MARKER.

A copy to edit carries the family itself instead of the graph, the seats, people's
views and the search list: everyone's stored properties and every link (exchange/records.py).
It works those out itself, again after every change, with twins of the app's code.
"""

import asyncio
import base64
import gzip
import hashlib
import html
import json
import os
import re
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import partial
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from neo4j import AsyncManagedTransaction as Tx
from pydantic import BaseModel

from ancestree import __version__
from ancestree.domain.dates import describe_partial_date, format_partial_date
from ancestree.domain.exports import CopyPermissions
from ancestree.domain.graph import GraphPerson
from ancestree.domain.person import DateQualifier, PartialDate
from ancestree.domain.views import DateView, PersonDetail, PersonSummary
from ancestree.exchange.backup import create_backup
from ancestree.exchange.family import FamilyData, Member, load_family
from ancestree.exchange.gedcom import write_gedcom
from ancestree.exchange.records import in_link_order, person_record
from ancestree.exchange.spreadsheet import ENCODING, write_people_csv
from ancestree.importing.template import template_csv
from ancestree.media.photos import AVATAR_SIZES
from ancestree.repo.graph import read_family
from ancestree.repo.imports import read_tree
from ancestree.repo.kinds import list_relationship_kinds
from ancestree.services import kinds as kinds_service
from ancestree.services import kinship as kinship_service
from ancestree.services import places as places_service
from ancestree.services.biography import biography_from
from ancestree.services.context import Context, RuleError, read
from ancestree.services.detail import is_living, load_detail
from ancestree.services.facts import facts_from_rows
from ancestree.services.graph import build_graph, centre_layouts
from ancestree.storage import biography as stories
from ancestree.storage.files import photo_file
from ancestree.storage.settings import read_tree_settings

FORMAT = 1
LANGUAGES = ("en", "ms", "jv")
MARKER = "<!--ANCESTREE-COPY-->"  # where the copy's page takes the family
ITERATIONS = 600_000  # PBKDF2-SHA-256 rounds from a password to a key


@dataclass(frozen=True)
class CopyOptions:
    title: str = ""  # at the top of the copy, e.g. "Keluarga Contoh"
    hide_living: bool = False  # for copies beyond close family
    password: str | None = None
    archive: bool = True  # the full archive among a view-only copy's exports
    # A copy to edit: its id, under which the app keeps what it started from
    # (DATA_DIR/copies/<id>), whom it's for, and what they may do in it.
    editable: bool = False
    copy_id: str = ""
    for_name: str = ""
    may: CopyPermissions = field(default_factory=CopyPermissions)


def _json(model: BaseModel) -> Any:
    return model.model_dump(mode="json")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _data_uri(data: bytes, media_type: str = "image/webp") -> str:
    return f"data:{media_type};base64,{_b64(data)}"


def _file(name: str, data: bytes) -> dict[str, Any]:
    return {"name": name, "size": len(data), "data": _b64(data)}


# --- Hiding living people's details ----------------------------------------------------------
#
# Their name, nickname, gender, photo, birth year and links stay. Their day and month of birth
# go (a MyKad number begins with the birth date), with their birthplace, where they live, their
# occupation, notes and life story.


def year_only(value: PartialDate | None) -> PartialDate | None:
    if value is None or value.year is None:
        return None
    if value.qualifier is DateQualifier.BETWEEN:
        return PartialDate(year=value.year, year_to=value.year_to, qualifier=value.qualifier)
    return PartialDate(year=value.year, qualifier=value.qualifier)


def _date_view(value: PartialDate | None) -> DateView | None:
    if value is None:
        return None
    return DateView(
        value=value, text=format_partial_date(value), description=describe_partial_date(value)
    )


_HIDDEN = (
    "birth_month",
    "birth_day",
    "birth_original_text",
    "birth_town",
    "birth_state",
    "birth_country",
)


def hidden_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {**row, **dict.fromkeys(_HIDDEN)}


# A copy to edit carries a hidden living person's record without what their panel leaves out.
_HIDDEN_RECORD = (
    *_HIDDEN,
    "residence_town",
    "residence_state",
    "residence_country",
    "occupation",
    "notes",
)


def hidden_record(record: Mapping[str, Any]) -> dict[str, Any]:
    return {name: value for name, value in record.items() if name not in _HIDDEN_RECORD}


def hidden_graph_person(person: GraphPerson) -> GraphPerson:
    return person.model_copy(
        update={
            "born": year_only(person.born),
            "birthplace": None,
            "born_in": None,
            "birth_text": None,
        }
    )


def hidden_detail(detail: PersonDetail) -> PersonDetail:
    born = detail.birth_date.value if detail.birth_date else None
    return detail.model_copy(
        update={
            "birth_date": _date_view(year_only(born)),
            "birth_place": None,
            "residence": None,
            "occupation": None,
            "notes": None,
        }
    )


def hidden_family(data: FamilyData, living: set[str]) -> FamilyData:
    """The family for the copy's GEDCOM and spreadsheet, with living people's details gone."""
    members: dict[str, Member] = {}
    for pid, member in data.members.items():
        if pid in living:
            person = member.person.model_copy(
                update={
                    "birth_date": year_only(member.person.birth_date),
                    "birth_place": None,
                    "residence": None,
                    "occupation": None,
                    "notes": None,
                }
            )
            member = Member(person=person, added=member.added)
        members[pid] = member
    return FamilyData(members, data.parents, data.spouses, data.kinds)


def living_people(data: FamilyData, today: date) -> set[str]:
    """Everyone who may be alive: recorded or worked out as living, or with nothing to go on."""
    return {
        pid
        for pid, member in data.members.items()
        if not member.person.placeholder
        and is_living(member.person, this_year=today.year) is not False
    }


# --- The answers -----------------------------------------------------------------------------


async def _details(tx: Tx, ids: Sequence[str], language: str) -> dict[str, PersonDetail]:
    return {pid: await load_detail(tx, pid, language) for pid in ids}


def _pictures(
    data_dir: Path, rows: Sequence[Mapping[str, Any]], told: Mapping[str, Any]
) -> dict[str, str]:
    """Photos by the address the app asks for them at, and the pictures the stories show (not
    ones taken out of a story, which stay on this PC)."""
    files: dict[str, str] = {}
    for row in rows:
        pid = str(row["id"])
        if row.get("photo_version") is not None:
            for size in AVATAR_SIZES:
                path = photo_file(data_dir, pid, f"avatar-{size}.webp")
                if path is not None:
                    files[f"/api/persons/{pid}/photo/avatar?size={size}"] = _data_uri(
                        path.read_bytes()
                    )
    for pid, biography in told.items():
        for name in stories.pictures_in(biography["story"]):
            path = stories.picture_file(data_dir, pid, name)
            if path is not None:
                files[f"/api/persons/{pid}/media/{name}"] = _data_uri(path.read_bytes())
    return files


def _stories(data_dir: Path, ids: Sequence[str]) -> dict[str, Any]:
    told: dict[str, Any] = {}
    for pid in ids:
        text = stories.read_story(data_dir, pid)
        if text and text.strip():
            told[pid] = _json(biography_from(text))
    return told


async def _records(ctx: Context, links: Sequence[Mapping[str, Any]], living: set[str]) -> Any:
    """The family as a copy to edit carries it: everyone's stored properties, hidden living
    people's without their details, and every link."""
    people, _ = await read(ctx, read_tree)
    records = [person_record(props) for props in people]
    return {
        "people": sorted(
            (hidden_record(record) if record["id"] in living else record for record in records),
            key=lambda record: str(record["id"]),
        ),
        "links": in_link_order(links),
    }


async def family_snapshot(
    ctx: Context,
    options: CopyOptions,
    *,
    today: date | None = None,
    made_at: datetime | None = None,
) -> dict[str, Any]:
    """Everything a copy of the family shows, as the API would answer; for a copy to edit, the
    family itself in place of the answers it works out."""
    today = today or date.today()
    made_at = made_at or datetime.now().astimezone()
    settings = await asyncio.to_thread(read_tree_settings, ctx.data_dir)
    rows, links, in_layout = await read_family(ctx.driver, ctx.database)
    real = [str(row["id"]) for row in rows if not row.get("placeholder")]
    if not real:
        raise RuleError("empty_family", "There's no one in the family to copy yet.")
    family = await load_family(ctx)
    living = living_people(family, today) if options.hide_living else set()

    graph = build_graph(rows, links, in_layout, settings.centre)
    if living:
        people = [hidden_graph_person(p) if str(p.id) in living else p for p in graph.people]
        graph = graph.model_copy(update={"people": people})

    # The map: the points were found here, so a copy needs no gazetteer and no pins.
    # Hidden living people's places stay out, as in their panels.
    family_map = await places_service.family_map(ctx)
    family_map = family_map.model_copy(
        update={
            "people": [
                person.model_copy(update={"lives": None, "born": None})
                if str(person.id) in living
                else person
                for person in family_map.people
            ],
            "pins": [],
        }
    )

    kinds = {kind.key: kind for kind in await list_relationship_kinds(ctx.driver, ctx.database)}
    fact_rows = [hidden_row(row) if str(row["id"]) in living else row for row in rows]
    facts = await asyncio.to_thread(
        facts_from_rows, fact_rows, links, in_layout, kinds, settings.centre, today
    )

    shown = set(real) - living
    told = await asyncio.to_thread(_stories, ctx.data_dir, sorted(shown))
    files = await asyncio.to_thread(_pictures, ctx.data_dir, rows, told)
    template = _file("ancestree-import-template.csv", template_csv().encode(ENCODING))

    centre = graph.layout.units[0].centre if graph.layout.units else []
    about: dict[str, Any] = {
        "title": options.title,
        "made_at": made_at.isoformat(timespec="seconds"),
        "people": len(real),
        "hidden_living": options.hide_living,
        "archive": False,
        "family": str(centre[0]) if centre else "",  # keeps a viewer's choices per family
        "version": __version__,
        "centres": [],  # whom a viewer can put at the centre
    }
    snapshot: dict[str, Any] = {
        "format": FORMAT,
        "about": about,
        # A copy has no server to be down, and names no folder on this PC.
        "health": {
            "status": "ok",
            "version": __version__,
            "database": "up",
            "schema_version": None,
            "database_version": None,
            "data_folder": "",
            "backup_folder": "",
        },
        "map": _json(family_map),
        "tree_settings": _json(settings),
        "kinds": [_json(kind) for kind in await kinds_service.list_kinds(ctx)],
        "dictionary": _json(await kinship_service.kinship_dictionary(ctx)),
        "kinship_settings": _json(await kinship_service.kinship_settings(ctx)),
        # For the copy's own relationship finder, a twin of this one.
        "kinship": kinship_service.twin_inputs(await kinship_service.books_for(ctx)),
        # As the family is now: a copy to edit shows them as they were when it was made.
        "facts": _json(facts),
        "stories": told,
        "files": files,
    }

    if options.editable:
        # A copy to edit works out the graph, the seats, people's views and the search list
        # itself. Its exports would be out of date after its first change: it saves itself
        # instead.
        about["editing"] = {
            "id": options.copy_id,
            "for": options.for_name,
            "may": options.may.model_dump(mode="json"),
            "made_at": about["made_at"],
            "saved_at": None,  # saved by the app, not from the copy
            "hidden": sorted(living),  # whose details it hides, so can't change
        }
        places = await asyncio.to_thread(places_service.rough_places)
        return snapshot | {
            "family": await _records(ctx, links, living),
            "photos": {},  # photos added in the copy, to crop again: none yet
            "trash": [],
            # The middle of each state and country, to place a new place roughly.
            "places": {key: _json(located) for key, located in places.items()},
            "exports": {"gedcom": None, "csv": None, "template": template, "archive": None},
        }

    # Seats only: who sits where around each other centre a viewer may choose.
    layouts = centre_layouts(rows, links, in_layout, graph, settings.centre)
    about["centres"] = [key for key in layouts if key]
    if settings.centre:
        about["centres"].append(str(settings.centre))

    ids = [str(row["id"]) for row in rows]
    persons: dict[str, dict[str, Any]] = {pid: {} for pid in ids}
    for language in LANGUAGES:
        details = await read(ctx, partial(_details, ids=ids, language=language))
        for pid, detail in details.items():
            persons[pid][language] = _json(hidden_detail(detail) if pid in living else detail)

    stamp = f"{made_at:%Y-%m-%dT%H-%M-%S}"
    shared = hidden_family(family, living) if living else family
    gedcom_name = f"ancestree-{stamp}.ged"
    exports: dict[str, Any] = {
        "gedcom": _file(
            gedcom_name,
            write_gedcom(shared, made_at=made_at, file_name=gedcom_name).encode("utf-8"),
        ),
        "csv": _file(f"ancestree-people-{stamp}.csv", write_people_csv(shared).encode(ENCODING)),
        "template": template,
        "archive": None,  # everything, so never with living people's details hidden
    }
    if options.archive and not living:
        with tempfile.TemporaryDirectory() as folder:
            backup = await create_backup(ctx.driver, ctx.database, ctx.data_dir, Path(folder))
            exports["archive"] = _file(backup.path.name, backup.path.read_bytes())
    about["archive"] = exports["archive"] is not None

    return snapshot | {
        "graph": _json(graph),
        "layouts": {key: _json(layout) for key, layout in layouts.items()},
        "persons": persons,
        "search": [
            _json(
                PersonSummary(
                    id=p.id,
                    full_name=p.full_name,
                    nickname=p.nickname,
                    gender=p.gender,
                    birth_year=p.birth_year,
                    death_year=p.death_year,
                    photo_version=p.photo_version,
                    placeholder=p.placeholder,
                )
            )
            for p in graph.people
            if not p.placeholder
        ],
        "exports": exports,
    }


# --- Sealing it into the page -----------------------------------------------------------------


def password_key(password: str, salt: bytes, iterations: int) -> bytes:
    """The AES-256 key a password makes, as a copy's page makes it too (viewer/snapshot.ts)."""
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)


def seal(snapshot: Mapping[str, Any], password: str | None = None) -> dict[str, Any]:
    """The snapshot compressed, and locked with AES-256-GCM when there's a password. The
    password itself is kept nowhere."""
    text = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    data = gzip.compress(text.encode("utf-8"), mtime=0)
    if password is None:
        return {"format": FORMAT, "gzip": _b64(data)}
    salt, iv = os.urandom(16), os.urandom(12)
    locked = AESGCM(password_key(password, salt, ITERATIONS)).encrypt(iv, data, None)
    return {
        "format": FORMAT,
        "locked": {
            "salt": _b64(salt),
            "iv": _b64(iv),
            "iterations": ITERATIONS,
            "data": _b64(locked),
        },
    }


def unseal(sealed: Mapping[str, Any], password: str | None = None) -> dict[str, Any]:
    """The snapshot back, as the copy's page reads it (for checking a copy)."""
    if "locked" in sealed:
        lock = sealed["locked"]
        if password is None:
            raise ValueError("This copy is locked with a password.")
        key = password_key(password, base64.b64decode(lock["salt"]), int(lock["iterations"]))
        data = AESGCM(key).decrypt(
            base64.b64decode(lock["iv"]), base64.b64decode(lock["data"]), None
        )
    else:
        data = base64.b64decode(sealed["gzip"])
    snapshot: dict[str, Any] = json.loads(gzip.decompress(data))
    return snapshot


# Inside a <script> element, "</script>" or "<!--" in the data would end or confuse it.
_UNSAFE = {"<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029"}
_PAYLOAD = re.compile(r'<script type="application/json" id="ancestree-copy">(.*?)</script>', re.S)


def page(app: str, sealed: Mapping[str, Any], title: str = "") -> str:
    """The copy: the copy's app with the family in place of MARKER, and its title."""
    if app.count(MARKER) != 1:
        raise ValueError("The copy's app has no place for the family.")
    text = json.dumps(sealed, separators=(",", ":"))
    for char, escaped in _UNSAFE.items():
        text = text.replace(char, escaped)
    script = f'<script type="application/json" id="ancestree-copy">{text}</script>'
    named = html.escape(f"{title} · AncesTree" if title else "AncesTree")
    with_family = app.replace(MARKER, script)
    return re.sub(
        r"<title>[^<]*</title>", lambda _: f"<title>{named}</title>", with_family, count=1
    )


def read_page(copy: str) -> dict[str, Any]:
    """What a copy's page holds, sealed, as `page` put it there (for checking a copy)."""
    match = _PAYLOAD.search(copy)
    if match is None:
        raise ValueError("That isn't an AncesTree copy.")
    sealed: dict[str, Any] = json.loads(match[1])
    return sealed


@dataclass(frozen=True)
class Copy:
    page: str  # the copy's app with the family inside
    snapshot: dict[str, Any]  # what's inside it: for a copy to edit, what it starts from


async def make_copy(ctx: Context, app: str, options: CopyOptions) -> Copy:
    """A copy's page: the copy's app with the family inside."""
    snapshot = await family_snapshot(ctx, options)
    sealed = await asyncio.to_thread(seal, snapshot, options.password)
    return Copy(page(app, sealed, options.title), snapshot)
