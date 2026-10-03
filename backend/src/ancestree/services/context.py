"""What every service needs, and the errors services raise."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID
from weakref import WeakValueDictionary

from neo4j import AsyncDriver, AsyncManagedTransaction

from ancestree.config import WhichFamily


@dataclass(frozen=True)
class Context:
    driver: AsyncDriver
    database: str
    data_dir: Path
    backup_dir: Path | None = None
    automatic_backups: bool = False
    family: WhichFamily | None = None  # which family, of several on the computer (0.4.0)

    @property
    def backups(self) -> Path:
        """Where backup archives go: BACKUP_DIR, or DATA_DIR/exports if that isn't set."""
        return self.backup_dir or self.data_dir / "exports"


class NotFoundError(Exception):
    """Someone or something that isn't there (HTTP 404)."""


class RuleError(Exception):
    """A change that would break the tree's rules, such as a cycle (HTTP 409).

    `details` travel to the client, e.g. the parents to choose from.
    """

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


_folders: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()


def folder_lock(person_id: UUID | str) -> asyncio.Lock:
    """One change at a time to a person's folder. Closing a panel saves the story being
    written just as "Move to Trash" moves the folder away: without this, the save could
    write into people/ after the folder has gone, leaving a stray copy that spoils a restore.
    """
    key = str(person_id)
    lock = _folders.get(key)
    if lock is None:
        lock = _folders[key] = asyncio.Lock()
    return lock


async def read[T](ctx: Context, work: Callable[[AsyncManagedTransaction], Awaitable[T]]) -> T:
    async with ctx.driver.session(database=ctx.database) as session:
        return await session.execute_read(work)


async def write[T](ctx: Context, work: Callable[[AsyncManagedTransaction], Awaitable[T]]) -> T:
    """One transaction: the rules are checked against the same data that gets written."""
    async with ctx.driver.session(database=ctx.database) as session:
        return await session.execute_write(work)
