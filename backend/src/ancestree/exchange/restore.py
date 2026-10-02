"""Restoring a backup archive: everything in AncesTree becomes
what the archive holds.

Nothing changes until the whole archive has been read and checked: every file against its
checksum, every path, every link. Then everything as it is now is backed up, the folders are
swapped, and the database is replaced in one transaction. If that fails, the folders are
swapped back: a restore happens completely or not at all.
"""

import asyncio
import hashlib
import json
import re
import shutil
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, LiteralString
from zipfile import BadZipFile, ZipFile

from neo4j import AsyncManagedTransaction as Tx
from pydantic import BaseModel, ValidationError

from ancestree.domain.exports import BackupRestored
from ancestree.domain.relationship import BIOLOGICAL
from ancestree.exchange.backup import ARCHIVE_FORMAT, DATA_FOLDERS, create_backup
from ancestree.migrations.runner import load_migrations
from ancestree.services.context import Context, read, write

_TIMES = ("created_at", "updated_at")  # stored as date-times, written as ISO 8601 text
_LINK_TYPES = ("PARENT_OF", "SPOUSE_OF")
# Backups made while there were copies to edit also hold copies/, what each started from
# (M21). Nothing reads them now: they're left out.
_RETIRED = ("copies",)
_SAFE_PART = re.compile(r'^[^\\/:*?"<>|\x00-\x1f]+$')  # a file or folder name, on Windows too


class ArchiveError(Exception):
    """This archive can't be restored. Nothing was changed."""


class _Manifest(BaseModel):
    format: int
    app_version: str
    schema_version: int
    created_at: datetime
    counts: dict[str, int]
    sha256: dict[str, str]


@dataclass(frozen=True)
class ArchiveInfo:
    made_at: datetime
    app_version: str
    schema_version: int
    people: int
    links: int
    files: int


def _manifest(archive: ZipFile, name: str) -> _Manifest:
    try:
        manifest = _Manifest.model_validate_json(archive.read("manifest.json"))
    except (KeyError, ValidationError, ValueError) as error:
        raise ArchiveError(f"{name} isn't an AncesTree backup archive.") from error
    if manifest.format != ARCHIVE_FORMAT:
        raise ArchiveError(f"{name} was made by a newer AncesTree. Update AncesTree first.")
    return manifest


def read_info(path: Path) -> ArchiveInfo:
    """What an archive holds, from its manifest. Quick: the files aren't checked here."""
    try:
        with ZipFile(path) as archive:
            manifest = _manifest(archive, path.name)
    except (BadZipFile, OSError) as error:
        raise ArchiveError(f"{path.name} isn't an AncesTree backup archive.") from error
    return ArchiveInfo(
        made_at=manifest.created_at,
        app_version=manifest.app_version,
        schema_version=manifest.schema_version,
        people=manifest.counts.get("people", 0),
        links=manifest.counts.get("links", 0),
        files=manifest.counts.get("files", 0),
    )


def _target(staging: Path, name: str) -> Path:
    """Where an archived file goes: only inside people/, settings/ or trash/."""
    parts = name.split("/")
    if (
        len(parts) < 2
        or parts[0] not in DATA_FOLDERS
        or any(part in (".", "..") or not _SAFE_PART.match(part) for part in parts)
    ):
        raise ArchiveError(f"The archive has a file in an unexpected place: {name}")
    return staging.joinpath(*parts)


def _copy_checked(archive: ZipFile, name: str, expected: str, target: Path | None) -> bytes:
    """Read one file, checking it against the manifest. Written to `target` if given;
    otherwise returned."""
    try:
        info = archive.getinfo(name)
    except KeyError as error:
        raise ArchiveError(f"The archive is missing {name}.") from error
    digest = hashlib.sha256()
    kept = bytearray()
    try:
        with archive.open(info) as source, target.open("wb") if target else nullcontext() as out:
            while chunk := source.read(1 << 20):
                digest.update(chunk)
                if out:
                    out.write(chunk)
                else:
                    kept += chunk
    except BadZipFile as error:
        raise ArchiveError(f"The archive is damaged: {name} can't be read.") from error
    if digest.hexdigest() != expected:
        raise ArchiveError(f"The archive is damaged: {name} doesn't match its checksum.")
    return bytes(kept)


def _rows_of(graph: dict[str, Any], key: str) -> list[Any]:
    rows = graph.get(key)
    if not isinstance(rows, list):
        raise ArchiveError(f"The archive's graph.json has no {key.replace('_', ' ')}.")
    return rows


def _check_graph(graph: Any) -> None:
    """Everything the database will hold must hang together, or nothing is restored."""

    def fail(problem: str) -> ArchiveError:
        return ArchiveError(f"The archive's graph.json doesn't hang together: {problem}.")

    if not isinstance(graph, dict):
        raise fail("it isn't a JSON object")
    people, links, kinds = (_rows_of(graph, k) for k in ("people", "links", "relationship_kinds"))
    ids: set[str] = set()
    for person in people:
        if not (isinstance(person, dict) and isinstance(person.get("id"), str)):
            raise fail("someone has no id")
        if not isinstance(person.get("full_name"), str):
            raise fail(f"{person['id']} has no name")
        if person["id"] in ids:
            raise fail(f"{person['id']} is there twice")
        ids.add(person["id"])
    keys = {kind.get("key") for kind in kinds if isinstance(kind, dict)}
    if len(keys) != len(kinds) or BIOLOGICAL not in keys:
        raise fail("the relationship kinds are incomplete")
    link_ids: set[str] = set()
    for link in links:
        props = link.get("properties") if isinstance(link, dict) else None
        if not isinstance(props, dict) or not isinstance(props.get("id"), str):
            raise fail("a link has no id")
        if link.get("type") not in _LINK_TYPES:
            raise fail(f"link {props['id']} is of an unknown type")
        if link.get("source") not in ids or link.get("target") not in ids:
            raise fail(f"link {props['id']} points to someone who isn't there")
        if link["type"] == "PARENT_OF" and props.get("kind", BIOLOGICAL) not in keys:
            raise fail(f"link {props['id']} is of a relationship kind that isn't there")
        if props["id"] in link_ids:
            raise fail(f"link {props['id']} is there twice")
        link_ids.add(props["id"])


def _stage(path: Path, staging: Path) -> tuple[dict[str, Any], _Manifest]:
    """Unpack and check the whole archive into `staging`. Changes nothing else."""
    latest = max(migration.version for migration in load_migrations())
    try:
        with ZipFile(path) as archive:
            manifest = _manifest(archive, path.name)
            if manifest.schema_version > latest:
                raise ArchiveError(
                    f"{path.name} was made by a newer AncesTree. Update AncesTree first."
                )
            if "graph.json" not in manifest.sha256:
                raise ArchiveError(f"{path.name} has no graph.json.")
            graph_bytes = _copy_checked(archive, "graph.json", manifest.sha256["graph.json"], None)
            for name, expected in manifest.sha256.items():
                if name == "graph.json" or name.split("/")[0] in _RETIRED:
                    continue
                target = _target(staging, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                _copy_checked(archive, name, expected, target)
    except (BadZipFile, OSError) as error:
        raise ArchiveError(f"{path.name} can't be read as a backup archive.") from error
    try:
        graph = json.loads(graph_bytes)
    except ValueError as error:
        raise ArchiveError("The archive's graph.json can't be read.") from error
    _check_graph(graph)
    return graph, manifest


def _swap_in(data_dir: Path, staging: Path, previous: Path) -> Callable[[], None]:
    """Put the staged folders in place of the live ones, which move to `previous`.
    Returns how to put everything back."""
    moves: list[tuple[Path, Path]] = []
    made: list[Path] = []

    def undo() -> None:
        for folder in reversed(made):
            shutil.rmtree(folder, ignore_errors=True)
        for source, target in reversed(moves):
            target.rename(source)

    try:
        for name in DATA_FOLDERS:
            live = data_dir / name
            if live.exists():
                live.rename(previous / name)
                moves.append((live, previous / name))
            if (staging / name).exists():
                (staging / name).rename(live)
                moves.append((staging / name, live))
            else:
                live.mkdir()
                made.append(live)
    except OSError as error:
        undo()
        raise ArchiveError(
            "The folders in the data folder couldn't be replaced. A program may have a file "
            "in them open, such as Obsidian: close it and try again. Nothing was changed."
        ) from error
    return undo


async def _replace_graph(tx: Tx, graph: dict[str, Any]) -> None:
    def rows(items: list[dict[str, Any]], **fields: str) -> list[dict[str, Any]]:
        return [
            {
                "props": {k: v for k, v in item.items() if k not in _TIMES},
                **{k: item.get(k) for k in _TIMES},
                **{name: item[key] for name, key in fields.items()},
            }
            for item in items
        ]

    await tx.run("MATCH (n) WHERE n:Person OR n:RelationshipKind DETACH DELETE n")
    await tx.run(
        "UNWIND $kinds AS kind CREATE (k:RelationshipKind) SET k = kind",
        kinds=graph["relationship_kinds"],
    )
    await tx.run(
        """
        UNWIND $rows AS row
        CREATE (p:Person)
        SET p = row.props,
            p.created_at = CASE WHEN row.created_at IS NULL THEN null
                                ELSE datetime(row.created_at) END,
            p.updated_at = CASE WHEN row.updated_at IS NULL THEN null
                                ELSE datetime(row.updated_at) END
        """,
        rows=rows(graph["people"]),
    )
    for link_type, query in _CREATE_LINKS.items():
        links = [link for link in graph["links"] if link["type"] == link_type]
        link_rows = [
            {**row, "source": link["source"], "target": link["target"]}
            for row, link in zip(rows([link["properties"] for link in links]), links, strict=True)
        ]
        await tx.run(query, rows=link_rows)


# A relationship's type can't be a query parameter, so each type has its own query.
_CREATE_LINKS: dict[str, LiteralString] = {
    "PARENT_OF": """
        UNWIND $rows AS row
        MATCH (a:Person {id: row.source}), (b:Person {id: row.target})
        CREATE (a)-[r:PARENT_OF]->(b)
        SET r = row.props,
            r.created_at = CASE WHEN row.created_at IS NULL THEN null
                                ELSE datetime(row.created_at) END
        """,
    "SPOUSE_OF": """
        UNWIND $rows AS row
        MATCH (a:Person {id: row.source}), (b:Person {id: row.target})
        CREATE (a)-[r:SPOUSE_OF]->(b)
        SET r = row.props,
            r.created_at = CASE WHEN row.created_at IS NULL THEN null
                                ELSE datetime(row.created_at) END
        """,
}


async def _catch_up(ctx: Context, schema_version: int) -> None:
    """An archive from an older AncesTree: redo the newer migrations on what it restored.
    Migrations are written to be run again safely (IF NOT EXISTS, MERGE)."""
    for migration in load_migrations():
        if migration.version > schema_version:
            for statement in migration.statements:
                # Trusted text from this package's own migration files, never user input.
                await ctx.driver.execute_query(statement, database_=ctx.database)


def _remove(folder: Path) -> None:
    shutil.rmtree(folder, ignore_errors=True)


async def _anyone(tx: Tx) -> bool:
    found = await (await tx.run("MATCH (p:Person) RETURN count(p) > 0 AS anyone")).single()
    return bool(found and found["anyone"])


async def restore_archive(ctx: Context, path: Path, *, backup_first: bool = True) -> BackupRestored:
    """Replace everything with what the archive at `path` holds. Everything as it was is
    backed up first, with the other backups, unless it can always be had again: a relative's
    family, as the family folder brings it once it has first arrived. An empty tree has
    nothing to keep, so it isn't backed up."""
    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S-%f")
    staging = ctx.data_dir / f".restore-{stamp}"
    previous = ctx.data_dir / f".replaced-{stamp}"
    done = False
    backup_name = ""
    try:
        graph, manifest = await asyncio.to_thread(_stage, path, staging)
        if backup_first and await read(ctx, _anyone):
            try:
                backup = await create_backup(ctx.driver, ctx.database, ctx.data_dir, ctx.backups)
            except OSError as error:
                raise ArchiveError(
                    f"Nothing was restored: everything as it is now couldn't be backed up first "
                    f"to {ctx.backups} ({error.strerror or error})."
                ) from error
            backup_name = backup.path.name
        previous.mkdir()
        undo = await asyncio.to_thread(_swap_in, ctx.data_dir, staging, previous)
        try:
            await write(ctx, lambda tx: _replace_graph(tx, graph))
            await _catch_up(ctx, manifest.schema_version)
        except BaseException:
            await asyncio.to_thread(undo)
            raise
        done = True
    finally:
        await asyncio.to_thread(_remove, staging)  # only copies from the archive, if anything
        if done:
            await asyncio.to_thread(_remove, previous)  # kept in the backup just made
        elif previous.exists() and not any(previous.iterdir()):
            previous.rmdir()
    return BackupRestored(
        made_at=manifest.created_at,
        people=sum(1 for person in graph["people"] if not person.get("placeholder")),
        links=len(graph["links"]),
        files=len(manifest.sha256) - 1,
        backup=backup_name,
    )
