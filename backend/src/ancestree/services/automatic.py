"""Automatic backups: one a day while the app runs, the last 30 kept.

Backups made by hand are never deleted. Automatic ones are named for what they are,
"ancestree-backup-<when>-automatic.zip", and only they are ever tidied away.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path

from ancestree.exchange.backup import AUTOMATIC_NAME, KEEP_AUTOMATIC, BackupResult, write_archive
from ancestree.repo.export import export_graph
from ancestree.services import elsewhere
from ancestree.services.context import Context

KEEP = KEEP_AUTOMATIC
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


def tidy(folder: Path, keep: int = KEEP) -> list[str]:
    """Delete all but the newest `keep` automatic backups; the names of those deleted."""
    archives = automatic_archives(folder)
    gone = [path for _, path in archives[:-keep]] if len(archives) > keep else []
    for path in gone:
        path.unlink(missing_ok=True)
    return [path.name for path in gone]


async def back_up_if_due(ctx: Context, now: datetime | None = None) -> BackupResult | None:
    """An automatic backup if the last is a day old or there's none; none of an empty tree."""
    now = now or datetime.now().astimezone()
    archives = await asyncio.to_thread(automatic_archives, ctx.backups)
    if archives and now - archives[-1][0] < EVERY:
        return None
    graph = await export_graph(ctx.driver, ctx.database)
    if not graph["people"]:
        return None  # nothing to keep yet
    made = await asyncio.to_thread(
        lambda: write_archive(graph, ctx.data_dir, ctx.backups, automatic=True, family=ctx.family)
    )
    await asyncio.to_thread(tidy, ctx.backups)
    return made


async def keep_backing_up(ctx: Context, first_after: float = 60, every: float = 3600) -> None:
    """While the app runs: a minute after it starts, then every hour, a backup if one is due;
    and copies of the backups in the second place chosen, if one is, once it's there (0.4.0)."""
    await asyncio.sleep(first_after)
    while True:
        try:
            if made := await back_up_if_due(ctx):
                log.info("Automatic backup: %s", made.path.name)
        except Exception:  # e.g. the backup folder's disk is gone: the next hour tries again
            log.exception("The automatic backup couldn't be made")
        try:
            if copied := await asyncio.to_thread(elsewhere.catch_up, ctx):
                log.info("Copied %d backups elsewhere", copied)
        except Exception:
            log.exception("The backups couldn't be copied elsewhere")
        await asyncio.sleep(every)
