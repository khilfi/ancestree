"""Writing an import plan into the tree, and taking an import back out.

An import only fills an empty tree, makes a backup first, and writes everything in one
transaction through the same rule checks as the app: it lands completely or not at all.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid7

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.person import Person
from ancestree.domain.relationship import BIOLOGICAL
from ancestree.exchange.backup import create_backup
from ancestree.importing.plan import ImportPlan, PlannedPerson
from ancestree.repo import links as links_repo
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import person_to_props
from ancestree.seed.family import SEED_SOURCE
from ancestree.services.context import Context, RuleError, write
from ancestree.services.relationships import connect
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage.files import atomic_write, remove_bare_folders, write_json

IMPORT_TAG = "import:"


class ImportRefusedError(Exception):
    """The import (or undo) didn't go ahead; nothing was changed."""


@dataclass(frozen=True)
class ImportResult:
    tag: str
    people: int
    placeholders: int
    parent_links: int
    marriages: int
    backup: Path
    record: Path


async def apply_plan(
    ctx: Context, plan: ImportPlan, *, review_text: str, report: str
) -> ImportResult:
    counts = await people_repo.count_people_by_source(ctx.driver, ctx.database)
    if counts.get(SEED_SOURCE):
        raise ImportRefusedError(
            "The fictional test family is still in the tree. Remove it first with:\n"
            "  uv run ancestree unseed"
        )
    if present := sum(counts.values()):
        raise ImportRefusedError(
            f"The tree already has {present} people. The importer only fills an empty tree, "
            "so nobody is imported twice. To take back an earlier import:\n"
            "  uv run ancestree import undo"
        )

    backup = await create_backup(ctx.driver, ctx.database, ctx.data_dir, ctx.backups)
    started = datetime.now().astimezone()
    tag = f"{IMPORT_TAG}{started:%Y-%m-%dT%H-%M-%S}"
    ids = {ref: str(uuid7()) for ref in plan.people}

    async def work(tx: Tx) -> None:
        for ref, person in plan.people.items():
            await people_repo.create_person(tx, _props(person, ids[ref], tag))
        for parent, child in plan.parent_links:
            if plan.people[parent].placeholder:
                # An unknown parent only joins brothers and sisters; the app's rules refuse
                # to link one by hand, so it's linked directly, as the app itself does.
                await links_repo.create_parent_link(
                    tx, str(uuid7()), ids[parent], ids[child], BIOLOGICAL
                )
            else:
                await _checked(tx, plan, ids, parent, child, "parent")
        for a, b in plan.marriages:
            await _checked(tx, plan, ids, a, b, "spouse")

    await write(ctx, work)
    await refresh_snapshots(ctx, [ids[ref] for ref, p in plan.people.items() if not p.placeholder])

    record = ctx.data_dir / "imports" / tag.removeprefix(IMPORT_TAG)
    people = sum(not p.placeholder for p in plan.people.values())
    atomic_write(record / "review.yaml", review_text.encode("utf-8"))
    atomic_write(record / "report.txt", report.encode("utf-8"))
    write_json(
        record / "people.json",
        {
            ids[ref]: {"name": p.name, "placeholder": p.placeholder, "from": p.sources}
            for ref, p in plan.people.items()
        },
    )
    write_json(
        record / "import.json",
        {
            "tag": tag,
            "imported_at": started.isoformat(timespec="seconds"),
            "people": people,
            "placeholders": plan.placeholders,
            "backup": str(backup.path),
            "undone_at": None,
        },
    )
    return ImportResult(
        tag=tag,
        people=people,
        placeholders=plan.placeholders,
        parent_links=len(plan.parent_links),
        marriages=len(plan.marriages),
        backup=backup.path,
        record=record,
    )


async def _checked(
    tx: Tx,
    plan: ImportPlan,
    ids: dict[str, str],
    a: str,
    b: str,
    a_is: Literal["parent", "spouse"],
) -> None:
    try:
        await connect(tx, ids[a], ids[b], a_is)
    except RuleError as error:
        first, second = plan.people[a].label, plan.people[b].label
        what = f"{first} as a parent of {second}" if a_is == "parent" else f"{first} and {second}"
        raise ImportRefusedError(
            f"Nothing was imported. {what}: {error.message} Fix it in the review file or in "
            "the old files, and run the check again."
        ) from error


def _props(person: PlannedPerson, person_id: str, tag: str) -> dict[str, Any]:
    domain = Person(
        id=UUID(person_id),
        full_name=person.name,
        nickname=person.nickname,
        gender=person.gender,
        birth_date=person.birth_date,
        birth_place=person.birth_place,
        death_date=person.death_date,
        residence=person.residence,
        living=person.living,
        notes="\n".join(person.notes) or None,
        birth_order=person.birth_order,
        placeholder=person.placeholder,
    )
    return person_to_props(domain) | {"source": tag}


def latest_import(data_dir: Path) -> dict[str, Any] | None:
    """The most recent import that hasn't been undone."""
    for path in sorted((data_dir / "imports").glob("*/import.json"), reverse=True):
        record: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        if not record.get("undone_at"):
            return record | {"record": str(path.parent)}
    return None


async def undo_import(ctx: Context, record: dict[str, Any]) -> int:
    """Remove everyone an import added, unless one of them has been given a photo since."""
    tag = record["tag"]

    async def work(tx: Tx) -> list[str]:
        result = await tx.run(
            "MATCH (p:Person {source: $tag}) "
            "RETURN p.id AS id, coalesce(p.has_photo, false) AS has_photo",
            tag=tag,
        )
        rows = await result.data()
        if any(row["has_photo"] for row in rows):
            raise ImportRefusedError(
                "Some of the imported people have photos now, which undoing would throw away. "
                "Delete people one by one in the app instead."
            )
        await tx.run("MATCH (p:Person {source: $tag}) DETACH DELETE p", tag=tag)
        return [row["id"] for row in rows]

    removed = await write(ctx, work)
    remove_bare_folders(ctx.data_dir, removed)
    path = Path(record["record"]) / "import.json"
    saved = json.loads(path.read_text(encoding="utf-8"))
    write_json(
        path, saved | {"undone_at": datetime.now().astimezone().isoformat(timespec="seconds")}
    )
    return len(removed)
