"""Importing a spreadsheet in the app.

The preview carries out the import inside the database and then rolls it back, so it shows
exactly what Import will do: each change it would make, for you to tick or leave out.
The import itself makes a backup first, carries out what's ticked as one Undo step, and is
kept in DATA_DIR/imports/ so that Take back can later undo it all: the people it added go to
the Trash, and what it changed or removed is put back.
"""

import asyncio
import csv
import io
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid7

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.exports import ExportFormat
from ancestree.domain.imports import (
    ImportChange,
    ImportDone,
    ImportLeftOut,
    ImportPreview,
    ImportSecondLook,
    ImportSummary,
    ImportTakenBack,
)
from ancestree.exchange.spreadsheet import ENCODING, guard
from ancestree.importing.matching import Ref, SheetPlan, Tree, plan_sheet
from ancestree.importing.sheet import Sheet, read_sheet
from ancestree.repo import history as history_repo
from ancestree.repo import imports as imports_repo
from ancestree.repo import kinds as kinds_repo
from ancestree.repo import people as people_repo
from ancestree.repo.mapping import editable_props, person_from_props
from ancestree.services import exports, returns
from ancestree.services import people as people_service
from ancestree.services.context import Context, NotFoundError, RuleError, read, write
from ancestree.services.history import History
from ancestree.services.relationships import add_parent, add_spouse
from ancestree.services.rules import Facts, life_notices
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage import imports as storage

TAG = "import:"  # people an import adds carry "import:<its id>" as their source, as in M2


def _count(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _people(count: int) -> str:
    return f"{count} {'person' if count == 1 else 'people'}"


def _facts(props: Mapping[str, Any]) -> Facts:
    person = person_from_props(props)
    return Facts(
        name=person.full_name,
        gender=person.gender,
        birth=person.birth_date,
        death=person.death_date,
    )


@dataclass
class _Done:
    """What carrying out a plan did, in the database."""

    plan: SheetPlan
    carried: set[str] = field(default_factory=set)  # the changes carried out, by id
    created: dict[str, str] = field(default_factory=dict)  # a new person's key -> their id
    links: int = 0
    links_to_tree: int = 0
    link_ids: list[str] = field(default_factory=list)  # the links made, for Take back
    # The details changed: whose, which, and their properties before and after.
    changed: list[dict[str, Any]] = field(default_factory=list)
    removing: list[str] = field(default_factory=list)  # to the Trash, once the rest is done
    refused: list[ImportLeftOut] = field(default_factory=list)  # links the rules refused
    refused_ids: set[str] = field(default_factory=set)
    notices: list[ImportSecondLook] = field(default_factory=list)

    @property
    def left_out(self) -> list[ImportLeftOut]:
        return sorted([*self.plan.left_out, *self.refused], key=lambda item: item.row or 0)

    @property
    def second_look(self) -> list[ImportSecondLook]:
        return sorted([*self.plan.second_look, *self.notices], key=lambda item: item.row or 0)

    @property
    def changes(self) -> list[ImportChange]:
        """Those to review: a link the rules refuse is left out instead."""
        return [change for change in self.plan.changes if change.id not in self.refused_ids]

    def preview(self, file_name: str) -> ImportPreview:
        plan = self.plan
        return ImportPreview(
            file_name=file_name,
            rows=plan.rows,
            people=[person.view() for person in plan.people],
            matched=len(plan.matched),
            links=self.links,
            links_to_tree=self.links_to_tree,
            questions=plan.questions,
            left_out=self.left_out,
            second_look=self.second_look,
            differences=plan.differences,
            columns_not_read=plan.not_read,
            changes=self.changes,
        )

    def label(self, file_name: str) -> str:
        """The Undo step: "Import 42 people from cousins.csv"."""
        if self.created:
            what = _people(len(self.created))
        elif self.links:
            what = _count(self.links, "link")
        elif self.changed:
            what = _count(len(self.changed), "change")
        else:
            what = _count(len(self.removing), "removal")
        return f"Import {what} from {file_name}"


async def _tree(tx: Tx) -> Tree:
    people, links = await imports_repo.read_tree(tx)
    return Tree(people, links, await kinds_repo.fetch_kinds(tx))


type Pick = Callable[[SheetPlan], set[str]]


def _rehearsal(plan: SheetPlan) -> set[str]:
    """Everything but the removals, so a link the rules refuse is found whatever is ticked.
    Removals only take people out after the rest, so they can't make a link fail."""
    return plan.carried_out([c.id for c in plan.changes if c.kind != "remove_person"])


async def _carry_out(
    tx: Tx, sheet: Sheet, answers: Mapping[str, str], tag: str, pick: Pick
) -> _Done:
    """Plan against the tree as this transaction sees it, then carry out the changes `pick`
    chooses: new people first, then details, then links, each put through the app's rules. A
    link they refuse is left out, and only that link. Removals are left to the caller, to go
    through the Trash."""
    tree = await _tree(tx)
    plan = plan_sheet(sheet, tree, answers)
    done = _Done(plan, carried=pick(plan))
    everyone: dict[str, dict[str, Any]] = {pid: dict(props) for pid, props in tree.props.items()}
    for person in plan.people:
        if f"add:{person.key}" not in done.carried:
            continue
        pid = str(uuid7())
        done.created[person.key] = pid
        props = {
            "id": pid,
            **editable_props(person.data),
            "placeholder": False,
            "has_photo": False,
            "photo_version": 0,
            "source": tag,
        }
        await people_repo.create_person(tx, props)
        everyone[pid] = props
        done.notices += [
            ImportSecondLook(row=person.row, message=notice.message)
            for notice in life_notices(_facts(props))
        ]

    row_of = {change.id: change.row for change in plan.changes}
    rows: dict[str, int | None] = {}
    for change in plan.sets:
        if change.id not in done.carried:
            continue
        was = everyone[change.person]
        before = {key: was.get(key) for key in change.props}
        await people_repo.update_person(tx, change.person, change.props)
        everyone[change.person] = {**was, **change.props}
        done.changed.append(
            {
                "person": change.person,
                "field": change.field,
                "before": before,
                "after": change.props,
            }
        )
        rows.setdefault(change.person, row_of[change.id])
    for pid, row in rows.items():  # an unlikely age, say, once all their details are in
        done.notices += [
            ImportSecondLook(row=row, message=notice.message)
            for notice in life_notices(_facts(everyone[pid]))
        ]

    def real(ref: Ref) -> str:
        return ref[1] if ref[0] == "tree" else done.created[ref[1]]

    asked: set[str] = set()
    # Marriages come first in the plan, so a couple's children don't ask if they're married.
    for link in plan.links:
        if link.id not in done.carried:
            continue
        a, b = real(link.a), real(link.b)
        try:
            if link.type == "spouse":
                linked = await add_spouse(tx, a, b, link.status, everyone)
            else:
                linked = await add_parent(tx, a, b, link.kind, tree.kinds, everyone)
        except RuleError as error:
            done.refused.append(
                ImportLeftOut(
                    row=link.row, column=link.column, written=link.written, why=error.message
                )
            )
            done.refused_ids.add(link.id)
            continue
        done.links += 1
        done.link_ids += [str(view.id) for view in linked.links]
        if "tree" in (link.a[0], link.b[0]):
            done.links_to_tree += 1
        done.notices += [
            ImportSecondLook(row=link.row, message=notice.message) for notice in linked.notices
        ]
        for suggestion in linked.suggestions:
            if suggestion.message not in asked:
                asked.add(suggestion.message)
                done.notices.append(
                    ImportSecondLook(
                        row=link.row,
                        message=f"{suggestion.message} They're parents of the same child, "
                        "but not recorded as married.",
                    )
                )
    done.removing = [r.person for r in plan.removals if r.id in done.carried]
    return done


class _RollBackError(Exception):
    """Not a failure: it ends a preview's transaction, so everything it did is rolled back."""

    def __init__(self, done: _Done) -> None:
        super().__init__("rolled back")
        self.done = done


async def preview_import(
    ctx: Context, data: bytes, file_name: str, answers: Mapping[str, str]
) -> ImportPreview:
    """What Import could do with this file and these answers. Nothing is written."""
    sheet = read_sheet(data)

    async def rehearse(tx: Tx) -> _Done:
        raise _RollBackError(await _carry_out(tx, sheet, answers, f"{TAG}preview", _rehearsal))

    try:
        await write(ctx, rehearse)
    except _RollBackError as rolled_back:
        return rolled_back.done.preview(file_name)
    raise RuntimeError("A preview is always rolled back.")


def _quoted(text: str | None) -> str:
    return f"“{text}”" if text else "empty"


def _what_happened(change: ImportChange, carried: bool) -> str:
    match change.kind, carried:
        case "set", True:
            return f"{change.name} had {_quoted(change.before)}. Changed."
        case "set", False:
            return f"Not ticked: {change.name} still has {_quoted(change.before)}."
        case "remove_person", True:
            return f"{change.name} moved to the Trash."
        case "remove_person", False:
            return f"Marked Remove, not ticked: {change.name} stays."
        case "add_person", False:
            return f"Not ticked: {change.name} wasn't added."
        case "add_link", False:
            return f"Not made: {change.name}, {change.detail}."
        case _:
            return ""


def _report(done: _Done) -> bytes:
    """What an import changed or left out, what it found older in the file than in the tree,
    and what's worth a second look."""
    rows: list[tuple[int | str, str, str, str]] = []
    for item in [*done.left_out, *done.plan.chosen_out]:
        rows.append((item.row or "", item.column, item.written, f"Left out. {item.why}"))
    for change in done.changes:
        if what := _what_happened(change, change.id in done.carried):
            written = change.after if change.kind == "set" else ""
            rows.append((change.row or "", change.column or "", written or "", what))
    for difference in done.plan.differences:
        rows.append(
            (
                difference.row,
                difference.column,
                difference.written,
                f"{difference.name} has been changed in the tree since the file was exported: "
                f"the tree's {_quoted(difference.in_tree)} is kept.",
            )
        )
    for look in done.second_look:
        rows.append((look.row or "", "", "", f"Worth a second look: {look.message}"))
    rows.sort(key=lambda row: row[0] if isinstance(row[0], int) else 0)
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(("Row", "Column", "Written", "What happened"))
    for row in rows:
        writer.writerow(guard(cell) for cell in row)
    return buffer.getvalue().encode(ENCODING)


async def run_import(
    ctx: Context,
    history: History,
    data: bytes,
    file_name: str,
    answers: Mapping[str, str],
    chosen: Collection[str] | None = None,
) -> ImportDone:
    """Import for real what's chosen (None: what's ticked to begin with): a backup first,
    then everything as one Undo step, the removals last."""
    sheet = read_sheet(data)
    plan = plan_sheet(sheet, await read(ctx, _tree), answers)
    if not plan.changes:
        raise RuleError(
            "nothing_to_import",
            "There's nothing to import: everyone in the file is already in the tree, "
            "with the same details and links.",
        )
    carried = plan.carried_out(chosen)
    if not carried:
        raise RuleError("nothing_chosen", "Nothing is ticked, so there's nothing to import.")
    backup = await exports.make_export(ctx, ExportFormat.ARCHIVE)
    now = datetime.now().astimezone()
    import_id, folder = await asyncio.to_thread(storage.new_import_folder, ctx.data_dir, now)
    tag = f"{TAG}{import_id}"
    try:
        async with history.change(ctx, plan.reached(carried)) as change:

            def pick(plan: SheetPlan) -> set[str]:
                return plan.carried_out(chosen)

            done = await write(ctx, lambda tx: _carry_out(tx, sheet, answers, tag, pick))
            change.people.update(done.created.values())
            change.removing = done.removing
            change.label = done.label(file_name)
    except BaseException:
        await asyncio.to_thread(storage.remove_folder, folder)
        raise
    await refresh_snapshots(ctx, {*done.created.values(), *done.plan.reached(done.carried)})
    left_out = [*done.left_out, *done.plan.chosen_out]
    record = {
        "format": 2,
        "id": import_id,
        "tag": tag,
        "file_name": file_name,
        "imported_at": now.isoformat(timespec="seconds"),
        "backup": backup.name,
        "people": list(done.created.values()),
        "links": done.links,
        "link_ids": done.link_ids,
        "changed": done.changed,
        "removed": done.removing,
        "left_out": [item.model_dump(mode="json") for item in left_out],
        "second_look": [item.model_dump(mode="json") for item in done.second_look],
        "differences": [item.model_dump(mode="json") for item in done.plan.differences],
        "taken_back_at": None,
    }
    await asyncio.to_thread(storage.save_import, folder, record, data, _report(done))
    return ImportDone(
        id=import_id,
        label=done.label(file_name),
        people=len(done.created),
        links=done.links,
        changed=len(done.changed),
        removed=len(done.removing),
        left_out=len(left_out),
        backup=backup.name,
    )


def _summary(record: Mapping[str, Any], present: set[str]) -> ImportSummary:
    people = [str(pid) for pid in record["people"]]
    taken_back = record.get("taken_back_at")
    kind = record.get("kind")
    copy = kind in ("copy", "folder")  # from a copy to edit, or a relative's computer
    changes = [record.get(key, []) for key in ("relinked", "unlinked", "filled")] if copy else []
    return ImportSummary(
        id=record["id"],
        kind=kind if kind in ("copy", "folder") else "spreadsheet",
        file_name=record["file_name"],
        for_name=record.get("for") if copy else None,
        imported_at=datetime.fromisoformat(record["imported_at"]),
        people=len(people),
        people_present=sum(pid in present for pid in people),
        links=int(record["links"]),
        changed=len(record.get("changed", [])) + sum(len(items) for items in changes),
        removed=len(record.get("removed", [])),
        stories=len(record.get("stories", [])),
        photos=len(record.get("photos", [])),
        left_out=[ImportLeftOut.model_validate(item) for item in record["left_out"]],
        differences=len(record["differences"]),
        second_look=len(record["second_look"]),
        taken_back_at=datetime.fromisoformat(taken_back) if taken_back else None,
    )


async def list_imports(ctx: Context) -> list[ImportSummary]:
    """Every spreadsheet import, newest first, with how many of its people are still here."""
    records = await asyncio.to_thread(storage.read_imports, ctx.data_dir)
    everyone = {str(pid) for record in records for pid in record["people"]}
    present = await read(ctx, lambda tx: imports_repo.people_present(tx, everyone))
    return [_summary(record, present) for record in records]


def _record(ctx: Context, import_id: str) -> dict[str, Any]:
    try:
        return storage.read_import(ctx.data_dir, import_id)
    except KeyError as error:
        raise NotFoundError("There's no such import.") from error


def report_path(ctx: Context, import_id: str) -> Path:
    _record(ctx, import_id)
    return storage.report_file(ctx.data_dir, import_id)


async def _unlink(ctx: Context, link_ids: list[str]) -> int:
    """The links an import made that are still there: those to the people it added went
    with them, so these are between people who were in the tree already."""
    if not link_ids:
        return 0

    async def work(tx: Tx) -> dict[str, history_repo.Link]:
        links = await history_repo.links_by_id(tx, link_ids)
        await history_repo.delete_links(tx, list(links))
        return links

    links = await write(ctx, work)
    await refresh_snapshots(
        ctx, {link[end] for link in links.values() for end in ("source", "target")}
    )
    return len(links)


async def _put_back(ctx: Context, changed: list[Mapping[str, Any]]) -> tuple[int, int]:
    """Details an import changed, as they were: (put back, kept). One changed again since is
    kept as it is now, as is anyone deleted since."""
    if not changed:
        return 0, 0

    async def work(tx: Tx) -> tuple[int, int, set[str]]:
        keys = {key for item in changed for key in item["after"]}
        now = await history_repo.properties(tx, {str(item["person"]) for item in changed}, keys)
        put_back = kept = 0
        people: set[str] = set()
        for item in changed:
            pid = str(item["person"])
            current = now.get(pid)
            if current is None:
                continue
            if all(current.get(key) == value for key, value in item["after"].items()):
                await people_repo.update_person(tx, pid, dict(item["before"]))
                put_back += 1
                people.add(pid)
            else:
                kept += 1
        return put_back, kept, people

    put_back, kept, people = await write(ctx, work)
    await refresh_snapshots(ctx, people)
    return put_back, kept


async def take_back(ctx: Context, history: History, import_id: str) -> ImportTakenBack:
    """Undo an import, as far as it still can be: everyone it added goes to the Trash, links
    and all, as do the links it made between people already in the tree; the details it
    changed go back as they were, unless they've been changed again since; and whoever it
    removed comes back from the Trash. Each person it added can be restored for 30 days."""
    record = await asyncio.to_thread(_record, ctx, import_id)
    if record.get("taken_back_at"):
        raise RuleError("taken_back", "This import has been taken back already.")
    if record.get("kind") in ("copy", "folder"):  # from a copy, or a computer
        taken = await returns.take_back_copy(ctx, history, record)
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        await asyncio.to_thread(
            storage.update_import, ctx.data_dir, import_id, {"taken_back_at": now}
        )
        if record.get("kind") == "copy":
            await asyncio.to_thread(returns.restore_base, ctx, record)
        return taken
    people = [str(pid) for pid in record["people"]]
    async with history.lock:
        present = await read(ctx, lambda tx: imports_repo.people_present(tx, people))
        for pid in people:
            if pid in present:
                await people_service.delete_person(ctx, UUID(pid))
        unlinked = await _unlink(ctx, [str(lid) for lid in record.get("link_ids", [])])
        put_back, kept = await _put_back(ctx, record.get("changed", []))
        restored = await people_service.bring_back(
            ctx, [str(pid) for pid in record.get("removed", [])]
        )
        if present or unlinked or put_back or restored:
            # Steps before it may name what changed: none of them can be undone now.
            history.clear()
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    await asyncio.to_thread(storage.update_import, ctx.data_dir, import_id, {"taken_back_at": now})
    return ImportTakenBack(
        moved=len(present),
        gone=len(people) - len(present),
        restored=restored,
        reverted=put_back,
        kept=kept,
    )
