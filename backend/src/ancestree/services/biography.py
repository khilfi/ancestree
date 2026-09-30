"""Life stories: Markdown in `biography.md`, with the Sources list
(D5) as its last section, pictures in `media/`, and a guard against overwriting a file that
was changed outside the app since it was opened.
"""

import asyncio
import hashlib
import re
from pathlib import Path
from uuid import UUID

from ancestree.domain.biography import Biography, BiographyUpdate, PictureAdded
from ancestree.media.photos import process_picture
from ancestree.repo import people as people_repo
from ancestree.services.context import Context, NotFoundError, RuleError, folder_lock, read
from ancestree.storage import biography as storage

SOURCES_HEADING = "## Sources"
_SOURCES = re.compile(r"^#{1,6}\s+sources\s*$", re.IGNORECASE)
_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(?P<text>.+?)\s*$")


def version_of(text: str | None) -> str:
    """Changes whenever the file does; "none" while there's no file."""
    if text is None:
        return "none"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def split_sources(markdown: str) -> tuple[str, list[str]]:
    """The story, and the list under a last "Sources" heading if nothing but a list follows
    it. Anything else stays part of the story, so an edit made elsewhere is never lost."""
    lines = markdown.split("\n")
    for index in range(len(lines) - 1, -1, -1):
        if not _SOURCES.match(lines[index].strip()):
            continue
        items = []
        for line in lines[index + 1 :]:
            if not line.strip():
                continue
            if not (match := _ITEM.match(line)):
                return markdown.strip(), []
            items.append(match["text"])
        return "\n".join(lines[:index]).strip(), items
    return markdown.strip(), []


def join_sources(story: str, sources: list[str]) -> str:
    """The file: the story, then the Sources as a list, each on one line."""
    parts = [story.strip()] if story.strip() else []
    items = [" ".join(source.split()) for source in sources if source.strip()]
    if items:
        parts.append(SOURCES_HEADING + "\n\n" + "\n".join(f"- {item}" for item in items))
    return "\n\n".join(parts) + "\n" if parts else ""


def biography_from(text: str | None) -> Biography:
    """The story in a biography.md, as the Biography tab reads it."""
    story, sources = split_sources(text or "")
    return Biography(story=story, sources=sources, version=version_of(text))


async def _check_person(ctx: Context, person_id: UUID) -> None:
    props = await read(ctx, lambda tx: people_repo.fetch_person(tx, str(person_id)))
    if props is None:
        raise NotFoundError("That person isn't in the tree.")
    if props.get("placeholder"):
        raise RuleError("placeholder", "An unknown parent has no story yet. Fill them in first.")


async def read_biography(ctx: Context, person_id: UUID) -> Biography:
    await _check_person(ctx, person_id)
    return biography_from(await asyncio.to_thread(storage.read_story, ctx.data_dir, person_id))


async def save_biography(ctx: Context, person_id: UUID, update: BiographyUpdate) -> Biography:
    """Save, unless the file changed since this edit began: then say so, with the file as it
    is now, so nothing written elsewhere is overwritten unseen."""
    async with folder_lock(person_id):
        await _check_person(ctx, person_id)
        current = await asyncio.to_thread(storage.read_story, ctx.data_dir, person_id)
        if version_of(current) != update.base_version:
            now = biography_from(current)
            raise RuleError(
                "changed_outside",
                "This story was changed outside AncesTree since you opened it.",
                story=now.story,
                sources=now.sources,
                version=now.version,
            )
        text = join_sources(update.story, update.sources)
        await asyncio.to_thread(storage.write_story, ctx.data_dir, person_id, text)
    return biography_from(text or None)


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
