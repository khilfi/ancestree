"""Profile photos: upload, re-crop, remove.

A new photo never destroys the old one: the previous original moves to profile/previous/.
"""

import asyncio
from pathlib import Path
from uuid import UUID

from ancestree.domain.views import PersonDetail
from ancestree.media.photos import Crop, process_photo
from ancestree.repo import people as people_repo
from ancestree.services.context import Context, NotFoundError, RuleError, write
from ancestree.services.people import get_person
from ancestree.services.snapshots import refresh_snapshots
from ancestree.storage import files


async def upload_photo(
    ctx: Context, person_id: UUID, data: bytes, crop: Crop | None
) -> PersonDetail:
    person = await get_person(ctx, person_id)
    if person.placeholder:
        raise RuleError("placeholder", "An unknown parent can't have a photo.")
    processed = await asyncio.to_thread(process_photo, data, crop)
    await asyncio.to_thread(files.store_photo, ctx.data_dir, person_id, data, processed)
    return await _saved(ctx, person_id, has_photo=True)


async def recrop_photo(ctx: Context, person_id: UUID, crop: Crop) -> PersonDetail:
    original = await asyncio.to_thread(files.read_original, ctx.data_dir, person_id)
    if original is None:
        raise NotFoundError("There's no photo to crop.")
    processed = await asyncio.to_thread(process_photo, original, crop)
    await asyncio.to_thread(files.store_rendering, ctx.data_dir, person_id, processed)
    return await _saved(ctx, person_id, has_photo=True)


async def current_crop(ctx: Context, person_id: UUID) -> Crop:
    crop = await asyncio.to_thread(files.read_crop, ctx.data_dir, person_id)
    if crop is None:
        raise NotFoundError("There's no photo.")
    return crop


async def remove_photo(ctx: Context, person_id: UUID) -> PersonDetail:
    await get_person(ctx, person_id)
    await asyncio.to_thread(files.remove_photo, ctx.data_dir, person_id)
    return await _saved(ctx, person_id, has_photo=False)


def photo_path(ctx: Context, person_id: UUID, name: str) -> Path:
    path = files.photo_file(ctx.data_dir, person_id, name)
    if path is None:
        raise NotFoundError("There's no photo.")
    return path


async def _saved(ctx: Context, person_id: UUID, *, has_photo: bool) -> PersonDetail:
    await write(ctx, lambda tx: people_repo.set_photo(tx, str(person_id), has_photo=has_photo))
    await refresh_snapshots(ctx, [str(person_id)])
    return await get_person(ctx, person_id)
