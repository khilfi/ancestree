"""person.json snapshots: each folder explains itself without the app."""

import asyncio
from collections.abc import Iterable
from functools import partial

from ancestree.services.context import Context, NotFoundError, read
from ancestree.services.detail import load_detail
from ancestree.storage.files import write_snapshot


async def refresh_snapshots(ctx: Context, person_ids: Iterable[str]) -> None:
    for person_id in sorted(set(person_ids)):
        try:
            detail = await read(ctx, partial(load_detail, person_id=person_id))
        except NotFoundError:
            continue
        if not detail.placeholder:
            snapshot = detail.model_dump(mode="json")
            await asyncio.to_thread(write_snapshot, ctx.data_dir, person_id, snapshot)
