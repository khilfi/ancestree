"""Undo and redo.

Each change to the tree is kept as a step: the people and links it touched, as they were
before and after. Undo writes the before back, and redo the after, in one transaction.
Moving someone to the Trash and bringing them back are steps too, done through the Trash,
so their photos and stories go and come with them.

Only the latest step can be undone, and only while what it touched is still as it left it.
Anything else is refused and the history is cleared: a change made some other way is never
overwritten.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.graph import TreeSettings
from ancestree.domain.map import MapPins
from ancestree.domain.views import HistoryStep, HistoryView
from ancestree.repo import history as repo
from ancestree.services import people as people_service
from ancestree.services.context import Context, NotFoundError, RuleError, read, write
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage.files import remove_bare_folders
from ancestree.storage.settings import (
    read_pins,
    read_tree_settings,
    write_pins,
    write_tree_settings,
)

Props = dict[str, Any]
LIMIT = 100
_BOOKKEEPING = {"updated_at"}  # stamped afresh by every change; never undone
_ENDS = ("type", "source", "target")


@dataclass
class PersonImage:
    before: Props | None
    after: Props | None

    def get(self, forward: bool) -> tuple[Props | None, Props | None]:
        """(as the step leaves it now, as it should become)."""
        return (self.before, self.after) if forward else (self.after, self.before)

    def changed_keys(self) -> set[str]:
        """What the step changed on this person."""
        if self.before is None or self.after is None:
            return set((self.before or self.after or {}).keys()) - _BOOKKEEPING
        return {
            k
            for k in self.before.keys() | self.after.keys()
            if self.before.get(k) != self.after.get(k)
        } - _BOOKKEEPING

    def changed(self) -> bool:
        return (self.before is None) != (self.after is None) or bool(self.changed_keys())

    @property
    def name(self) -> str:
        """As the step left them, or as they were if it took them out."""
        return str((self.after or self.before or {}).get("full_name") or "someone")


@dataclass
class LinkImage:
    before: repo.Link | None
    after: repo.Link | None

    def get(self, forward: bool) -> tuple[repo.Link | None, repo.Link | None]:
        return (self.before, self.after) if forward else (self.after, self.before)

    def moved(self) -> bool:
        """Its ends or type changed: it's taken out and put back rather than updated."""
        return (
            self.before is not None
            and self.after is not None
            and any(self.before[part] != self.after[part] for part in _ENDS)
        )

    def changed_keys(self) -> set[str]:
        if self.before is None or self.after is None:
            return set()
        old, new = self.before["props"], self.after["props"]
        return {k for k in old.keys() | new.keys() if old.get(k) != new.get(k)} - _BOOKKEEPING

    def changed(self) -> bool:
        created_or_removed = (self.before is None) != (self.after is None)
        return created_or_removed or self.moved() or bool(self.changed_keys())


@dataclass
class Step:
    label: str = ""
    id: str = field(default_factory=lambda: uuid4().hex)
    at: datetime = field(default_factory=lambda: datetime.now().astimezone())
    people: dict[str, PersonImage] = field(default_factory=dict)
    links: dict[str, LinkImage] = field(default_factory=dict)
    settings: tuple[TreeSettings, TreeSettings] | None = None
    trash: tuple[Literal["out", "in"], str] | None = None  # moved to, or back from, the Trash
    pins: tuple[MapPins, MapPins] | None = None  # places put on the map by hand
    # People a change moved to the Trash after the rest of it, such as an import's removals
    # (M19): undone through the Trash, before the rest; redone after it.
    removed: list[str] = field(default_factory=list)

    def changes_anything(self) -> bool:
        return bool(
            self.people or self.links or self.settings or self.trash or self.pins or self.removed
        )

    def view(self) -> HistoryStep:
        return HistoryStep(id=self.id, label=self.label, at=self.at)


class CantUndoError(RuleError):
    def __init__(self, reason: str) -> None:
        super().__init__("cant_undo", f"This can't be undone any more: {reason}.")


class Recorder:
    """What a change touches, known before it runs; people it creates are added after."""

    def __init__(
        self,
        people: Iterable[object],
        links: Iterable[object] = (),
        *,
        everyone: bool = False,
        only: Iterable[str] | None = None,
    ) -> None:
        self.people = {str(p) for p in people}
        self.links = {str(link) for link in links}
        self.everyone = everyone  # with `only`: it can change those properties of anyone
        # The only properties it can change (their names too, for its label); None: any.
        self.only = None if only is None else frozenset(only) | {"full_name"}
        self.label = ""
        self.names: dict[str, str] = {}
        self.ends: dict[str, tuple[str, str]] = {}  # the links asked about: who they joined
        # People to move to the Trash once the rest is done, in the same step.
        self.removing: list[str] = []

    def name(self, person_id: object) -> str:
        """Their name as it was before the change (or as created by it)."""
        return self.names.get(str(person_id)) or "someone"

    def between(self, link_id: object) -> str:
        """ "Siti and Ali", for a link asked about when the change began."""
        a, b = self.ends.get(str(link_id), ("", ""))
        return f"{self.name(a)} and {self.name(b)}"


async def _snapshot(tx: Tx, recorder: Recorder) -> tuple[dict[str, Props], dict[str, repo.Link]]:
    if recorder.only is not None:  # nothing else can change, links included
        ids = None if recorder.everyone else recorder.people
        return await repo.properties(tx, ids, recorder.only), {}
    anchors = set(recorder.people)
    for link in (await repo.links_by_id(tx, recorder.links)).values():
        anchors |= {link["source"], link["target"]}
    return await repo.neighbourhood(tx, anchors)


class History:
    """The undo and redo steps since the app started."""

    def __init__(self, limit: int = LIMIT) -> None:
        self._undo: list[Step] = []
        self._redo: list[Step] = []
        self._limit = limit
        self.lock = asyncio.Lock()  # one change at a time, so steps never mix

    def view(self) -> HistoryView:
        return HistoryView(
            undo=self._undo[-1].view() if self._undo else None,
            redo=self._redo[-1].view() if self._redo else None,
        )

    def clear(self) -> None:
        self._undo.clear()
        self._redo.clear()

    def _push(self, step: Step) -> None:
        if step.changes_anything():
            self._undo.append(step)
            del self._undo[: -self._limit]
            self._redo.clear()

    def change(
        self, ctx: Context, people: Iterable[object] = (), links: Iterable[object] = ()
    ) -> AbstractAsyncContextManager[Recorder]:
        """Record a change to people and links. The body makes the change, adds anyone it
        created to `recorder.people`, and sets `recorder.label`."""
        return self._record(ctx, Recorder(people, links))

    def moves(
        self, ctx: Context, people: Iterable[object] = (), *, everyone: bool = False
    ) -> AbstractAsyncContextManager[Recorder]:
        """Record people being moved on the tree canvas, or put back (Rearrange). Only where
        they sit changes, so only that is read: at 2,000 people that takes a fraction of the
        time, and the step keeps a fraction of the memory."""
        return self._record(ctx, Recorder(people, everyone=everyone, only=repo.POSITION))

    @asynccontextmanager
    async def _record(self, ctx: Context, recorder: Recorder) -> AsyncIterator[Recorder]:
        async with self.lock:

            async def before(tx: Tx) -> tuple[Any, dict[str, Props], dict[str, repo.Link]]:
                started = await repo.clock(tx)
                people_before, links_before = await _snapshot(tx, recorder)
                return started, people_before, links_before

            started, people_before, links_before = await read(ctx, before)
            recorder.names = {
                pid: str(p.get("full_name") or "") for pid, p in people_before.items()
            }
            recorder.ends = {
                lid: (link["source"], link["target"])
                for lid, link in links_before.items()
                if lid in recorder.links
            }
            yield recorder
            step = await read(
                ctx, lambda tx: _compare(tx, recorder, started, people_before, links_before)
            )
            try:
                # Through the Trash, with their photos and stories: undone by bringing them back.
                for pid in recorder.removing:
                    await people_service.delete_person(ctx, UUID(pid))
                    step.removed.append(pid)
            finally:
                step.label = recorder.label
                self._push(step)  # all that was done, even if a removal failed

    @asynccontextmanager
    async def settings_change(self, ctx: Context) -> AsyncIterator[Step]:
        """Record a change to the tree's settings; the body sets the step's label."""
        async with self.lock:
            before = await asyncio.to_thread(read_tree_settings, ctx.data_dir)
            step = Step()
            yield step
            after = await asyncio.to_thread(read_tree_settings, ctx.data_dir)
            if after != before:
                step.settings = (before, after)
                self._push(step)

    @asynccontextmanager
    async def pins_change(self, ctx: Context) -> AsyncIterator[Step]:
        """Record a place put on the map by hand, or taken off; the body sets the label."""
        async with self.lock:
            before = await asyncio.to_thread(read_pins, ctx.data_dir)
            step = Step()
            yield step
            after = await asyncio.to_thread(read_pins, ctx.data_dir)
            if after != before:
                step.pins = (before, after)
                self._push(step)

    async def trash_step[T](
        self,
        direction: Literal["out", "in"],
        person_id: object,
        run: Callable[[], Awaitable[tuple[T, str]]],
    ) -> T:
        """Moving someone to the Trash ("out") or back ("in"). `run` does it and returns
        (its result, the step's label)."""
        async with self.lock:
            result, label = await run()
            self._push(Step(label=label, trash=(direction, str(person_id))))
            return result

    async def undo(self, ctx: Context, expect: str | None = None) -> Step:
        return await self._move(ctx, forward=False, expect=expect)

    async def redo(self, ctx: Context, expect: str | None = None) -> Step:
        return await self._move(ctx, forward=True, expect=expect)

    async def _move(self, ctx: Context, *, forward: bool, expect: str | None) -> Step:
        source, target = (self._redo, self._undo) if forward else (self._undo, self._redo)
        async with self.lock:
            if not source:
                raise RuleError("nothing", f"There's nothing to {'redo' if forward else 'undo'}.")
            step = source[-1]
            if expect is not None and step.id != expect:
                raise RuleError("not_latest", "Something else has been changed since.")
            try:
                await _apply(ctx, step, forward=forward)
            except CantUndoError:
                self.clear()
                raise
            source.pop()
            target.append(step)
            return step


async def _compare(
    tx: Tx,
    recorder: Recorder,
    started: Any,
    people_before: dict[str, Props],
    links_before: dict[str, repo.Link],
) -> Step:
    """What changed. Someone seen only afterwards is new if stamped after the change began;
    otherwise they were there all along, only not among the people read before."""
    people_after, links_after = await _snapshot(tx, recorder)
    if recorder.only is None:
        people_after |= await repo.people_by_id(tx, set(people_before) - set(people_after))
        links_after |= await repo.links_by_id(tx, set(links_before) - set(links_after))

    step = Step()
    for pid in people_before.keys() | people_after.keys():
        before, after = people_before.get(pid), people_after.get(pid)
        if before is None and after is not None and not _stamped_since(after, started):
            continue
        if recorder.only is not None and (before is None or after is None):
            continue  # it can't add or take out anyone: that was some other change
        image = PersonImage(before, after)
        if image.changed():
            step.people[pid] = image
            recorder.names.setdefault(pid, image.name)
    for lid in links_before.keys() | links_after.keys():
        link = LinkImage(links_before.get(lid), links_after.get(lid))
        if link.changed():
            step.links[lid] = link
    return step


def _stamped_since(props: Props, started: Any) -> bool:
    created = props.get("created_at")
    return created is not None and started is not None and bool(created >= started)


async def _apply(ctx: Context, step: Step, *, forward: bool) -> None:
    if step.trash is not None:
        await _apply_trash(ctx, *step.trash, forward=forward)
    elif step.settings is not None:
        await _apply_settings(ctx, *step.settings, forward=forward)
    elif step.pins is not None:
        await _apply_pins(ctx, *step.pins, forward=forward)
    elif not forward:
        # Those it moved to the Trash come back first, so the rest finds everyone it knew.
        for pid in reversed(step.removed):
            await _apply_trash(ctx, "out", pid, forward=False)
        await _apply_graph(ctx, step, forward=False)
    else:
        await _apply_graph(ctx, step, forward=True)
        for pid in step.removed:
            await _apply_trash(ctx, "out", pid, forward=True)


async def _apply_trash(ctx: Context, direction: str, person_id: str, *, forward: bool) -> None:
    # Back out of the Trash to undo a move there, or to redo a move back; else into it.
    if (direction == "out") != forward:
        # Their latest entry: an undo may have put them back in the Trash under a new one.
        entry = next(
            (e.entry for e in await people_service.trash(ctx) if str(e.person_id) == person_id),
            None,
        )
        if entry is None:
            raise CantUndoError("they're no longer in the Trash")
        try:
            await people_service.restore(ctx, entry)
        except (RuleError, NotFoundError) as error:
            raise CantUndoError("the Trash has changed since") from error
    else:
        try:
            await people_service.delete_person(ctx, UUID(person_id))
        except (RuleError, NotFoundError) as error:
            raise CantUndoError("they have changed since") from error


async def _apply_settings(
    ctx: Context, before: TreeSettings, after: TreeSettings, *, forward: bool
) -> None:
    now, wanted = (before, after) if forward else (after, before)
    if await asyncio.to_thread(read_tree_settings, ctx.data_dir) != now:
        raise CantUndoError("the tree's settings have changed since")
    await asyncio.to_thread(write_tree_settings, ctx.data_dir, wanted)


async def _apply_pins(ctx: Context, before: MapPins, after: MapPins, *, forward: bool) -> None:
    now, wanted = (before, after) if forward else (after, before)
    if await asyncio.to_thread(read_pins, ctx.data_dir) != now:
        raise CantUndoError("the places on the map have changed since")
    await asyncio.to_thread(write_pins, ctx.data_dir, wanted)


async def _check_graph(tx: Tx, step: Step, *, forward: bool) -> None:
    """Everything the step touched is still as it left it, and can be put back."""
    changed: set[str] = set().union(*(image.changed_keys() for image in step.people.values()))
    present = await repo.properties(tx, step.people, changed)
    for pid, image in step.people.items():
        expected, _ = image.get(forward)
        current = present.get(pid)
        if (expected is None) != (current is None) or (
            expected is not None
            and current is not None
            and any(current.get(k) != expected.get(k) for k in image.changed_keys())
        ):
            raise CantUndoError(f"{image.name} has changed since")
    links = await repo.links_by_id(tx, step.links)
    for lid, link in step.links.items():
        expected_link, _ = link.get(forward)
        current_link = links.get(lid)
        if (expected_link is None) != (current_link is None) or (
            expected_link is not None
            and current_link is not None
            and (
                any(current_link[part] != expected_link[part] for part in _ENDS)
                or any(
                    current_link["props"].get(k) != expected_link["props"].get(k)
                    for k in link.changed_keys()
                )
            )
        ):
            raise CantUndoError("a link it changed has been changed again since")
    leaving = [
        lid for lid, link in step.links.items() if link.get(forward)[1] is None or link.moved()
    ]
    going = [pid for pid, image in step.people.items() if image.get(forward)[1] is None]
    if going and await repo.other_links(tx, going, leaving):
        raise CantUndoError("someone it added has been linked to others since")
    kinds: set[str] = set()
    for link in step.links.values():
        _, wanted = link.get(forward)
        if wanted is not None and wanted["type"] == "PARENT_OF" and wanted["props"].get("kind"):
            kinds.add(str(wanted["props"]["kind"]))
    if missing := kinds - await repo.kinds_present(tx, kinds):
        raise CantUndoError(f"the relationship kind '{sorted(missing)[0]}' has been deleted")


async def _apply_graph(ctx: Context, step: Step, *, forward: bool) -> None:
    # Anyone it would take out must have nothing of their own yet, such as a photo.
    going = [pid for pid, image in step.people.items() if image.get(forward)[1] is None]
    for pid in going:
        folder = ctx.data_dir / "people" / pid
        own = [p for p in folder.rglob("*") if p.is_file() and p.name != "person.json"]
        if folder.is_dir() and own:
            raise CantUndoError(f"{step.people[pid].name} has a photo or a story now")

    new_people: list[Props] = []
    people_changes: dict[str, Props] = {}
    for pid, image in step.people.items():
        now, wanted = image.get(forward)
        if now is None and wanted is not None:
            new_people.append(wanted)
        elif now is not None and wanted is not None:
            people_changes[pid] = {k: wanted.get(k) for k in image.changed_keys()}
    old_links: list[str] = []
    new_links: list[repo.Link] = []
    link_changes: dict[str, Props] = {}
    for lid, link in step.links.items():
        now_link, wanted_link = link.get(forward)
        if now_link is not None and (wanted_link is None or link.moved()):
            old_links.append(lid)
        if wanted_link is not None and (now_link is None or link.moved()):
            new_links.append(wanted_link)
        elif now_link is not None and wanted_link is not None:
            link_changes[lid] = {k: wanted_link["props"].get(k) for k in link.changed_keys()}

    async def work(tx: Tx) -> None:
        await _check_graph(tx, step, forward=forward)  # where it's written: nothing slips in
        await repo.delete_links(tx, old_links)
        await repo.delete_people(tx, going)
        await repo.create_people(tx, new_people)
        await repo.update_people(tx, people_changes)
        await repo.create_links(tx, new_links)
        await repo.update_links(tx, link_changes)

    await write(ctx, work)
    await refresh_snapshots(ctx, _snapshots_changed(step) - set(going))
    await asyncio.to_thread(remove_bare_folders, ctx.data_dir, going)


def _snapshots_changed(step: Step) -> set[str]:
    """Whose person.json the step changes: people whose details it changed, and both ends
    of every link it changed, since a person.json lists the relatives. Positions aren't in
    it, so Rearrange's hundreds of people aren't written again for nothing."""
    ids = {pid for pid, image in step.people.items() if image.changed_keys() - repo.POSITION}
    for link in step.links.values():
        for image in (link.before, link.after):
            if image is not None:
                ids |= {image["source"], image["target"]}
    return ids
