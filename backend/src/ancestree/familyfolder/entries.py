"""The family as the family folder carries it: entries, one for each thing that travels.

    about                 the family's name, as the keeper gave it
    schema                the database schema the entries come from
    person/<id>           a person's properties, as a backup archive's graph.json holds them
    link/<id>             a link: its type, whose it is, and its properties
    kind/<key>            a relationship kind
    file/<path>           a file in a person's folder (people/<id>/...): its size, SHA-256, and
                          the name of its one sealed copy in the folder's files/
    setting/kinship       the family's Malay birth-order titles
    setting/places        the places put on the map by hand

What stays on each computer, and never travels: "Me", the kinship language, and the tree's
centre and colours. So does the Trash, and the records of copies to edit.

The keeper's computer works the entries out from its family and publishes what changed; every
other computer builds an archive from them, as a backup archive would be, and restores it.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ancestree.exchange.backup import write_archive
from ancestree.familyfolder.models import Delete, Put
from ancestree.familyfolder.seals import RefusedError
from ancestree.storage.files import write_json

Entries = dict[str, dict[str, Any]]
# How a file here looked when its sealed copy was last named: size, time, SHA-256, name.
Named = dict[str, tuple[int, int, str, str]]


def _plain(value: object) -> str:
    """Neo4j's dates and times as ISO 8601 text, as a backup archive writes them."""
    iso_format = getattr(value, "iso_format", None)
    if callable(iso_format):
        return str(iso_format())
    raise TypeError(f"cannot carry {type(value).__name__} in the family folder")


def _settings(data_dir: Path) -> dict[str, Any]:
    try:
        found = json.loads((data_dir / "settings" / "app.json").read_text(encoding="utf-8"))
    except OSError, ValueError:
        return {}
    return found if isinstance(found, dict) else {}


def family_entries(
    graph: dict[str, Any],
    data_dir: Path,
    name: str,
    store: Callable[[bytes], str],
    named: Named,
) -> Entries:
    """The keeper's family as entries. `store` keeps a file's sealed copy in the family folder,
    once, and names it; `named` remembers the names, so an unchanged file isn't read again."""
    graph = json.loads(json.dumps(graph, default=_plain))
    entries: Entries = {"about": {"name": name}, "schema": {"version": graph["schema_version"]}}
    for person in graph["people"]:
        entries[f"person/{person['id']}"] = person
    for link in graph["links"]:
        entries[f"link/{link['properties']['id']}"] = link
    for kind in graph["relationship_kinds"]:
        entries[f"kind/{kind['key']}"] = kind
    people = data_dir / "people"
    seen: set[str] = set()
    for path in sorted(people.rglob("*")) if people.is_dir() else []:
        if not path.is_file():
            continue
        relative = path.relative_to(data_dir).as_posix()
        stat = path.stat()
        known = named.get(relative)
        if known is None or known[:2] != (stat.st_size, stat.st_mtime_ns):
            data = path.read_bytes()
            known = (stat.st_size, stat.st_mtime_ns, hashlib.sha256(data).hexdigest(), store(data))
            named[relative] = known
        seen.add(relative)
        entries[f"file/{relative}"] = {"size": known[0], "sha256": known[2], "blob": known[3]}
    for relative in set(named) - seen:
        del named[relative]
    settings = _settings(data_dir)
    kinship = settings.get("kinship") or {}
    entries["setting/kinship"] = {
        key: kinship[key] for key in ("titles", "youngest") if key in kinship
    }
    entries["setting/places"] = settings.get("places") or {}
    return entries


def changes_between(published: Entries, now: Entries) -> list[Put | Delete]:
    """What changed since the entries last published: each new or changed one put whole,
    each one gone deleted."""
    changes: list[Put | Delete] = [
        Put(id=key, data=value) for key, value in sorted(now.items()) if published.get(key) != value
    ]
    changes += [Delete(id=key) for key in sorted(published) if key not in now]
    return changes


def build_archive(
    entries: Entries, fetch: Callable[[str], bytes | None], data_dir: Path, dest: Path
) -> Path | None:
    """A backup archive of the family the entries hold, to restore on this computer: its own
    "Me", language and tree settings kept, the family's titles and places taken. None while a
    file hasn't reached this computer yet."""
    schema = entries.get("schema", {}).get("version", 0)
    graph: dict[str, Any] = {
        "schema_version": schema,
        "people": [value for key, value in sorted(entries.items()) if key.startswith("person/")],
        "links": [value for key, value in sorted(entries.items()) if key.startswith("link/")],
        "relationship_kinds": sorted(
            (value for key, value in entries.items() if key.startswith("kind/")),
            key=lambda kind: (kind.get("sort_order", 0), kind.get("key", "")),
        ),
    }
    staging = Path(tempfile.mkdtemp(prefix="ancestree-received-", dir=dest))
    try:
        for key, value in sorted(entries.items()):
            if not key.startswith("file/"):
                continue
            data = fetch(value["blob"])
            if data is None:
                return None
            if hashlib.sha256(data).hexdigest() != value["sha256"]:
                raise RefusedError(f"{key} isn't the file its entry names")
            relative = key.removeprefix("file/")
            if not relative.startswith("people/") or ".." in relative.split("/"):
                raise RefusedError(f"{key} lies outside the people's folders")
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        settings = _settings(data_dir)
        kinship = {**(settings.get("kinship") or {}), **entries.get("setting/kinship", {})}
        family_settings = {"kinship": kinship, "places": entries.get("setting/places", {})}
        write_json(staging / "settings" / "app.json", settings | family_settings)
        return write_archive(graph, staging, dest).path
    finally:
        shutil.rmtree(staging, ignore_errors=True)
