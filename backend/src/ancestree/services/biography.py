"""Life stories: Markdown in `biography.md`, the story first,
then each of its parts filled in under its own heading, what people say about them,
and the Sources list last; pictures in `media/`; and a guard against overwriting a file
that was changed outside the app since it was opened.
"""

import asyncio
import hashlib
import re
import secrets
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

from ancestree.domain.biography import (
    PARTS,
    Biography,
    BiographyUpdate,
    PartKey,
    PictureAdded,
    Said,
    lines_ended,
)
from ancestree.media.photos import process_picture
from ancestree.repo import people as people_repo
from ancestree.services.context import Context, NotFoundError, RuleError, folder_lock, read
from ancestree.storage import biography as storage
from ancestree.storage.settings import read_me

SOURCES_HEADING = "## Sources"
_SOURCES = re.compile(r"^#{1,6}\s+sources\s*$", re.IGNORECASE)
# A list item's mark: "- ", "* ", "+ ", "1. " or "1) ". What follows is found without a pattern,
# so no line, however long or strange, takes long to read (0.8.0).
_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s")


def version_of(text: str | None) -> str:
    """Changes whenever what the file says does, but not with what people say, which a
    save keeps as the file has it: the file's, as the app writes it, without them; "none" while
    there's no file. As the app writes it, as a save writes it so anyway: so words added to a
    story written by hand, which writes it so, never seem a change made outside (0.8.0)."""
    if text is None:
        return "none"
    story, sources = split_sources(text)
    rest, _ = split_said(story)
    return hashlib.sha256(join_sources(rest, sources).encode("utf-8")).hexdigest()[:16]


def split_sources(markdown: str) -> tuple[str, list[str]]:
    """The story, and the list under a last "Sources" heading if nothing but a list follows
    it. Anything else stays part of the story, so an edit made elsewhere is never lost."""
    markdown = lines_ended(markdown)
    lines = markdown.split("\n")
    for index in range(len(lines) - 1, -1, -1):
        if not _SOURCES.match(lines[index].strip()):
            continue
        items = []
        for line in lines[index + 1 :]:
            if not line.strip():
                continue
            if not (mark := _ITEM.match(line)) or not line[mark.end() :]:
                return markdown.strip(), []
            items.append(line[mark.end() :].strip())
        return "\n".join(lines[:index]).strip(), items
    return markdown.strip(), []


def join_sources(story: str, sources: list[str]) -> str:
    """The file: the story, then the Sources as a list, each on one line."""
    story = lines_ended(story)
    parts = [story.strip()] if story.strip() else []
    items = [" ".join(source.split()) for source in sources if source.strip()]
    if items:
        parts.append(SOURCES_HEADING + "\n\n" + "\n".join(f"- {item}" for item in items))
    return "\n\n".join(parts) + "\n" if parts else ""


_PART_OF = {title.casefold(): key for key, title in PARTS.items()}
# A heading of the parts' own level inside one, which would end the parts when it's read again.
_INSIDE_A_PART = re.compile(r"^##(?=\s)", re.MULTILINE)


def _heading(line: str) -> str | None:
    """A second-level heading's title, "## Early life" or "## Early life ##" alike; None for a
    line that isn't one. Found without a pattern, so no line takes long to read (0.8.0)."""
    if len(line) < 4 or not line.startswith("##") or not line[2].isspace():
        return None
    return line[3:].strip().rstrip("#").rstrip()


def split_parts(story: str) -> tuple[str, dict[PartKey, str]]:
    """The story itself, and the parts after it: the last run of the file's second-level
    headings that are all parts' own, each once. A part's heading earlier on, with the story's
    own headings after it, stays the story's: so a story written before, or in Obsidian, is
    never cut up."""
    story = lines_ended(story)
    lines = story.split("\n")
    starts: list[tuple[int, PartKey]] = []
    for index in range(len(lines) - 1, -1, -1):
        title = _heading(lines[index])
        if title is None:
            continue
        key = _PART_OF.get(title.casefold())
        if key is None or any(key == seen for _, seen in starts):
            break
        starts.append((index, key))
    if not starts:
        return story.strip(), {}
    starts.reverse()
    parts: dict[PartKey, str] = {}
    for (index, key), (end, _) in zip(starts, [*starts[1:], (len(lines), "notes")], strict=True):
        if text := "\n".join(lines[index + 1 : end]).strip():
            parts[key] = text
    return "\n".join(lines[: starts[0][0]]).strip(), parts


def join_parts(story: str, parts: Mapping[PartKey, str]) -> str:
    """The story, then each part filled in under its heading, in their order. A part's
    own headings go a level down, so that the parts are read back as they were written."""
    story = lines_ended(story)
    sections = [story.strip()] if story.strip() else []
    for key, title in PARTS.items():
        if text := lines_ended(parts.get(key) or "").strip():
            sections.append(f"## {title}\n\n{_INSIDE_A_PART.sub('###', text)}")
    return "\n\n".join(sections)


SAID_HEADING = "## What people say"
_SAID = "what people say"  # its title, as a heading's is compared
# Who said it, under their words: "— Zulkifli bin Hassan, 14 October 2026", then, for the app,
# "<!-- said 3f9a2c1b by 0123456789abcdef on 2026-10-14 -->", the line's last.
_KEPT_BY = re.compile(r"<!--\s*said\b(?P<kept>[^>]*)-->")
_KEPT = re.compile(
    r"^\s*(?P<id>[0-9a-f]{8})(?:\s+by\s+(?P<device>[0-9a-f]{16}))?"
    r"(?:\s+on\s+(?P<on>\d{4}-\d{2}-\d{2}))?(?:\s+changed\s+(?P<changed>\d{4}-\d{2}-\d{2}))?\s*$"
)
_MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
_WHEN = re.compile(
    r"^(?P<writer>.*?),\s*(?P<day>\d{1,2}) (?P<month>[A-Za-z]+) (?P<year>\d{4})"
    r"(?:\s*\(changed [^)]*\))?$"
)


def _day(when: date) -> str:
    return f"{when.day} {_MONTHS[when.month - 1]} {when.year}"


def _iso(text: str | None) -> date | None:
    try:
        return date.fromisoformat(text) if text else None
    except ValueError:
        return None


def _by(line: str) -> tuple[str, str | None] | None:
    """Who said it, from the line beneath their words: as written, and what the app keeps of it
    in its comment at the line's end; None for a line that isn't one. Found without a pattern
    over the whole line, so no line takes long to read (0.8.0)."""
    if not line.startswith("—"):
        return None
    by, kept = line[1:], None
    start = by.rfind("<!--")
    if start >= 0 and (comment := _KEPT_BY.fullmatch(by[start:].rstrip())):
        by, kept = by[:start], comment["kept"]
    return by.strip(), kept


def _unquoted(lines: Sequence[str]) -> str:
    return "\n".join(line[1:].removeprefix(" ") if line.startswith(">") else line for line in lines)


def _said_from(lines: Sequence[str], by: str, kept: str | None) -> Said:
    text = _unquoted(lines).strip()
    found = _KEPT.match(kept or "")
    writer, written = by, None
    if (when := _WHEN.match(by)) and when["month"].capitalize() in _MONTHS:
        writer = when["writer"]
        month = _MONTHS.index(when["month"].capitalize()) + 1
        try:
            written = date(int(when["year"]), month, int(when["day"]))
        except ValueError:
            writer = by
    said_id = (
        found["id"]
        if found
        else hashlib.sha256(f"{writer}\n{text}".encode()).hexdigest()[:8]  # written by hand
    )
    return Said(
        id=said_id,
        text=text,
        writer=writer,
        device=found["device"] if found else None,
        written=(_iso(found["on"]) if found else None) or written,
        changed=_iso(found["changed"]) if found else None,
    )


def split_said(story: str) -> tuple[str, list[Said]]:
    """What people say about them: the words under a last "What people say" heading,
    with nothing but their words after it. Each is a quote with who said it and when beneath;
    words with no one beneath, as written by hand, are kept too, by no one."""
    story = lines_ended(story)
    lines = story.split("\n")
    for index in range(len(lines) - 1, -1, -1):
        if (title := _heading(lines[index])) is None:
            continue
        if title.casefold() != _SAID:
            return story.strip(), []
        said: list[Said] = []
        words: list[str] = []
        for line in lines[index + 1 :]:
            if (by := _by(line)) is not None:
                if _unquoted(words).strip():
                    said.append(_said_from(words, *by))
                words = []
            else:
                words.append(line)
        if _unquoted(words).strip():
            said.append(_said_from(words, "", None))
        seen: set[str] = set()
        for each in said:
            while each.id in seen:  # pasted twice: told apart
                each.id = hashlib.sha256(each.id.encode()).hexdigest()[:8]
            seen.add(each.id)
        return "\n".join(lines[:index]).strip(), said
    return story.strip(), []


def _said_text(said: Said) -> str:
    lines = lines_ended(said.text).split("\n")
    quoted = "\n".join(f"> {line}" if line.strip() else ">" for line in lines)
    by = " ".join(said.writer.split())  # one line, whatever the name
    if said.written is not None:
        by += f", {_day(said.written)}"
        if said.changed is not None and said.changed != said.written:
            by += f" (changed {_day(said.changed)})"
    kept = said.id
    if said.device:
        kept += f" by {said.device}"
    if said.written is not None:
        kept += f" on {said.written.isoformat()}"
    if said.changed is not None:
        kept += f" changed {said.changed.isoformat()}"
    return f"{quoted}\n\n— {by} <!-- said {kept} -->".replace("—  <!--", "— <!--")


def join_said(story: str, said: Sequence[Said]) -> str:
    """The story with its parts, then what people say about them, in the order written. A
    heading of theirs in the story itself goes a level down: only the words after the last one
    are anyone's, so words written into a story never become someone's later (0.8.0)."""
    story = "\n".join(
        f"#{line}" if (_heading(line) or "").casefold() == _SAID else line
        for line in lines_ended(story).split("\n")
    )
    if not said:
        return story.strip()
    words = "\n\n".join(_said_text(each) for each in said if each.text.strip())
    return "\n\n".join(part for part in (story.strip(), SAID_HEADING, words) if part)


def biography_from(text: str | None) -> Biography:
    """The story in a biography.md, as the life story's window reads it: the story, its parts,
    what people say about them, and its Sources."""
    story, sources = split_sources(text or "")
    story, said = split_said(story)
    story, parts = split_parts(story)
    return Biography(story=story, parts=parts, said=said, sources=sources, version=version_of(text))


def told(text: str | None) -> dict[str, Any]:
    """A story as it travels between the family's computers: all of it before the
    Sources, parts and what people say and all, as every version reads it, and the Sources."""
    story, sources = split_sources(text or "")
    return {"story": story, "sources": sources, "version": version_of(text)}


async def _check_person(ctx: Context, person_id: UUID) -> None:
    props = await read(ctx, lambda tx: people_repo.fetch_person(tx, str(person_id)))
    if props is None:
        raise NotFoundError("That person isn't in the tree.")
    if props.get("placeholder"):
        raise RuleError("placeholder", "An unknown parent has no story yet. Fill them in first.")


@dataclass(frozen=True)
class Writer:
    """Who writes here: their name, as their words are signed; this computer, as the
    family knows it (None with no family folder); whether it keeps the family, so may take
    anyone's words out; and the family's computers, each by its name there (0.8.0)."""

    name: str
    device: str | None
    keeper: bool
    computers: Mapping[str, str] = field(default_factory=dict)

    def wrote(self, said: Said) -> bool:
        """Whether these words are this computer's to change: written here, or the keeper's
        own, written before the family folder or by hand."""
        return said.device == self.device or (self.keeper and said.device is None)


def on_computers(said: Sequence[Said], here: str | None, computers: Mapping[str, str]) -> None:
    """Beside words written on another computer than `here`, that computer's name, as the
    family knows it (0.8.0, your answer of 14 Oct 2026): so a computer signing its words with
    someone else's name is seen to. Words of no computer are the keeper's own, as ever."""
    for each in said:
        if each.device is not None and each.device != here:
            each.computer = computers.get(each.device) or "another computer"


# Whose words they are, with no Me chosen and no family folder (0.8.0, your answer of 14 Oct
# 2026): never the computer's own name, which may name its owner, in copies and GEDCOM too.
ON_THIS_COMPUTER = "Written on this computer"


async def writer_name(ctx: Context, computer: str) -> str:
    """Whose name words written here are signed with: this computer's Me, or, if it hasn't
    chosen one, the computer's name in the family, or, with no family folder, a plain one
    (D71)."""
    me = (await asyncio.to_thread(read_me, ctx.data_dir)).person
    if me is not None:
        props = await read(ctx, lambda tx: people_repo.fetch_person(tx, str(me)))
        if props is not None and not props.get("placeholder"):
            return str(props["full_name"])
    return computer


def _as_read(biography: Biography, writer: Writer | None) -> Biography:
    if writer is not None:
        for said in biography.said:
            said.yours = writer.wrote(said)
        on_computers(biography.said, writer.device, writer.computers)
    return biography


async def read_biography(ctx: Context, person_id: UUID, writer: Writer | None = None) -> Biography:
    await _check_person(ctx, person_id)
    text = await asyncio.to_thread(storage.read_story, ctx.data_dir, person_id)
    return _as_read(biography_from(text), writer)


async def save_biography(
    ctx: Context, person_id: UUID, update: BiographyUpdate, writer: Writer | None = None
) -> Biography:
    """Save, unless the file changed since this edit began: then say so, with the file as it
    is now, so nothing written elsewhere is overwritten unseen. What people say about
    them stays as the file has it now."""
    async with folder_lock(person_id):
        await _check_person(ctx, person_id)
        current = await asyncio.to_thread(storage.read_story, ctx.data_dir, person_id)
        now = biography_from(current)
        if now.version != update.base_version:
            raise RuleError(
                "changed_outside",
                "This story was changed outside AncesTree since you opened it.",
                story=now.story,
                parts=now.parts,
                sources=now.sources,
                version=now.version,
            )
        story = join_said(join_parts(update.story, update.parts), now.said)
        text = join_sources(story, update.sources)
        await asyncio.to_thread(storage.write_story, ctx.data_dir, person_id, text)
    return _as_read(biography_from(text or None), writer)


async def _change_said(
    ctx: Context, person_id: UUID, writer: Writer, change: Callable[[list[Said]], list[Said]]
) -> Biography:
    """What people say about them changed as `change` says, in the file as it is now, with
    the story, its parts and Sources left as they are."""
    async with folder_lock(person_id):
        await _check_person(ctx, person_id)
        current = await asyncio.to_thread(storage.read_story, ctx.data_dir, person_id)
        story, sources = split_sources(current or "")
        story, said = split_said(story)
        said = change(said)
        text = join_sources(join_said(story, said), sources)
        await asyncio.to_thread(storage.write_story, ctx.data_dir, person_id, text)
    return _as_read(biography_from(text or None), writer)


def _found(said: list[Said], said_id: str) -> Said:
    for each in said:
        if each.id == said_id:
            return each
    raise NotFoundError("Those words aren't there any more.")


async def add_said(ctx: Context, person_id: UUID, text: str, writer: Writer) -> Biography:
    """Their words about someone, signed with their name and today's date, and
    kept as this computer's."""
    if not text.strip():
        raise RuleError("no_words", "Write something first.")

    def added(said: list[Said]) -> list[Said]:
        taken = {each.id for each in said}
        said_id = secrets.token_hex(4)
        while said_id in taken:
            said_id = secrets.token_hex(4)
        words = Said(
            id=said_id,
            text=text.strip(),
            writer=writer.name,
            device=writer.device,
            written=date.today(),
        )
        return [*said, words]

    return await _change_said(ctx, person_id, writer, added)


async def change_said(
    ctx: Context, person_id: UUID, said_id: str, text: str, writer: Writer
) -> Biography:
    """Their own words changed: only on the computer they were written on."""
    if not text.strip():
        raise RuleError("no_words", "Write something first, or take them back.")

    def changed(said: list[Said]) -> list[Said]:
        words = _found(said, said_id)
        if not writer.wrote(words):
            raise RuleError(
                "not_yours", "Only the computer these words were written on can change them."
            )
        if words.text != text.strip():
            words.text, words.writer, words.changed = text.strip(), writer.name, date.today()
        return said

    return await _change_said(ctx, person_id, writer, changed)


async def take_out_said(ctx: Context, person_id: UUID, said_id: str, writer: Writer) -> Biography:
    """Words taken back by the computer they were written on, or taken out by the keeper."""

    def taken(said: list[Said]) -> list[Said]:
        words = _found(said, said_id)
        if not (writer.wrote(words) or writer.keeper):
            raise RuleError(
                "not_yours",
                "Only the computer these words were written on can take them back, or the "
                "family's keeper take them out.",
            )
        return [each for each in said if each.id != said_id]

    return await _change_said(ctx, person_id, writer, taken)


async def add_picture(ctx: Context, person_id: UUID, data: bytes) -> PictureAdded:
    await _check_person(ctx, person_id)
    webp = await asyncio.to_thread(process_picture, data)
    async with folder_lock(person_id):
        await _check_person(ctx, person_id)  # still there after the conversion
        name = await asyncio.to_thread(storage.store_picture, ctx.data_dir, person_id, webp)
    return PictureAdded(src=f"{storage.MEDIA}/{name}")


def picture_path(ctx: Context, person_id: UUID, name: str) -> Path:
    path = storage.picture_file(ctx.data_dir, person_id, name)
    if path is None:
        raise NotFoundError("There's no such picture.")
    return path
