"""Automatic backups: one a day while the app runs, named for what they are,
"ancestree-backup-<when>-automatic.zip". Every backup, these and those made by hand, is kept for
3 months, the newest 3 for ever, by keeping.py: the same hourly round sees to it.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path

from ancestree.exchange.backup import AUTOMATIC_NAME, BackupResult, write_archive
from ancestree.repo.export import export_graph
from ancestree.services import elsewhere, keeping
from ancestree.services.context import Context

EVERY = timedelta(days=1)

log = logging.getLogger("uvicorn.error")


def automatic_archives(folder: Path) -> list[tuple[datetime, Path]]:
    """The automatic backups in `folder`, oldest first, with when each was made."""
    found: list[tuple[datetime, int, Path]] = []
    for path in folder.glob("ancestree-backup-*-automatic*.zip") if folder.is_dir() else []:
        if match := AUTOMATIC_NAME.fullmatch(path.name):
            made = datetime.strptime(match[1], "%Y-%m-%dT%H-%M-%S").astimezone()
            found.append((made, int(match[2] or 1), path))
    return [(made, path) for made, _, path in sorted(found)]


async def back_up_if_due(ctx: Context, now: datetime | None = None) -> BackupResult | None:
    """An automatic backup if the last is a day old or there's none; none of an empty tree."""
    now = now or datetime.now().astimezone()
    archives = await asyncio.to_thread(automatic_archives, ctx.backups)
    if archives and now - archives[-1][0] < EVERY:
        return None
    graph = await export_graph(ctx.driver, ctx.database)
    if not graph["people"]:
        return None  # nothing to keep yet
    return await asyncio.to_thread(
        lambda: write_archive(graph, ctx.data_dir, ctx.backups, automatic=True, family=ctx.family)
    )


async def keep_backing_up(ctx: Context, first_after: float = 60, every: float = 3600) -> None:
    """While the app runs: a minute after it starts, then every hour, a backup if one is due;
    those over 3 months old to the system's bin, here and in the second place; and copies
    of the backups in the second place chosen, if one is, once it's there (0.4.0)."""
    await asyncio.sleep(first_after)
    while True:
        try:
            if made := await back_up_if_due(ctx):
                log.info("Automatic backup: %s", made.path.name)
        except Exception:  # e.g. the backup folder's disk is gone: the next hour tries again
            log.exception("The automatic backup couldn't be made")
        try:
            await asyncio.to_thread(keeping.keep_three_months, ctx)
        except Exception:
            log.exception("The backups over 3 months old couldn't be tidied")
        try:
            if copied := await asyncio.to_thread(elsewhere.catch_up, ctx):
                log.info("Copied %d backups elsewhere", copied)
        except Exception:
            log.exception("The backups couldn't be copied elsewhere")
        await asyncio.sleep(every)
