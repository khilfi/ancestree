"""Full backup archive: every person, link and file."""

import asyncio
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from neo4j import AsyncDriver

from ancestree import __version__
from ancestree.repo.export import export_graph

ARCHIVE_FORMAT = 1

# DATA_DIR folders worth keeping. `exports/` is left out: it holds the archives themselves.
DATA_FOLDERS = ("people", "settings", "trash")

_README = """\
AncesTree backup archive
========================

graph.json     every person, relationship and relationship kind
people/        one folder per person, named by ID: photos, biography.md, documents
settings/      app settings
trash/         deleted people that can still be restored
manifest.json  when and by which version this was made, counts, and a SHA-256 per file

Everything inside is plain JSON, Markdown and images: readable without AncesTree.
To restore it: in AncesTree, Settings > Backups; or `uv run ancestree restore <this file>`.
"""


# In an automatic backup's name: those are kept 30 at a time, those made by hand for ever.
AUTOMATIC = "-automatic"
# Two made in one second are "...-automatic.zip", then "...-automatic-2.zip".
AUTOMATIC_NAME = re.compile(
    r"ancestree-backup-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)-automatic(?:-(\d+))?\.zip"
)


@dataclass(frozen=True)
class BackupResult:
    path: Path
    people: int
    links: int
    files: int
    unknown_parents: int = 0


async def create_backup(
    driver: AsyncDriver, database: str, data_dir: Path, dest_dir: Path
) -> BackupResult:
    graph = await export_graph(driver, database)
    # Zipping and hashing files is blocking work: keep it off the event loop.
    return await asyncio.to_thread(write_archive, graph, data_dir, dest_dir)


def is_automatic(name: str) -> bool:
    """An archive made by the daily automatic backup, by its name: the only kind that is
    ever tidied away."""
    return AUTOMATIC_NAME.fullmatch(name) is not None


def write_archive(
    graph: dict[str, Any], data_dir: Path, dest_dir: Path, *, automatic: bool = False
) -> BackupResult:
    graph_json = json.dumps(graph, ensure_ascii=False, indent=2, default=_json_value).encode()
    created = datetime.now().astimezone()
    dest_dir.mkdir(parents=True, exist_ok=True)
    kind = AUTOMATIC if automatic else ""
    final = unused_path(dest_dir / f"ancestree-backup-{created:%Y-%m-%dT%H-%M-%S}{kind}.zip")
    partial = final.with_name(final.name + ".partial")

    checksums = {"graph.json": hashlib.sha256(graph_json).hexdigest()}
    with ZipFile(partial, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("graph.json", graph_json)
        for path in _data_files(data_dir):
            name = path.relative_to(data_dir).as_posix()
            archive.write(path, name)
            with path.open("rb") as file:
                checksums[name] = hashlib.file_digest(file, "sha256").hexdigest()
        unknown = sum(1 for person in graph["people"] if person.get("placeholder"))
        counts = {
            "people": len(graph["people"]) - unknown,  # as the app counts them
            "unknown_parents": unknown,
            "links": len(graph["links"]),
            "files": len(checksums) - 1,
        }
        manifest = {
            "format": ARCHIVE_FORMAT,
            "app_version": __version__,
            "schema_version": graph["schema_version"],
            "created_at": created.isoformat(timespec="seconds"),
            "counts": counts,
            "sha256": checksums,
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.writestr("README.txt", _README)
    partial.replace(final)  # only a complete archive ever gets the .zip name
    return BackupResult(final, **counts)


def _data_files(data_dir: Path) -> list[Path]:
    files: list[Path] = []
    for folder in DATA_FOLDERS:
        root = data_dir / folder
        if root.is_dir():
            files.extend(path for path in root.rglob("*") if path.is_file())
    return sorted(files)


def unused_path(path: Path) -> Path:
    """`path`, or with -2, -3... added if a file of that name is already there."""
    candidate, number = path, 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}-{number}{path.suffix}")
        number += 1
    return candidate


def _json_value(value: object) -> str:
    """Neo4j temporal values (such as created_at) are written as ISO 8601 text."""
    iso_format = getattr(value, "iso_format", None)
    if callable(iso_format):
        return str(iso_format())
    raise TypeError(f"cannot write {type(value).__name__} to JSON")
