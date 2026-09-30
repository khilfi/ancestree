"""Automatic backups, made from the database: when they're due, and how they're listed."""

from datetime import datetime, timedelta
from typing import Any

import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.migrations.runner import apply_migrations
from ancestree.seed.loader import load_seed
from ancestree.services.automatic import automatic_archives, back_up_if_due
from ancestree.services.context import Context
from ancestree.services.exports import list_backups

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def context(driver: AsyncDriver, settings: Settings) -> Context:
    return Context(driver, settings.neo4j_database, settings.data_dir, settings.backup_dir, True)


async def test_nothing_is_kept_of_an_empty_tree(driver: AsyncDriver, settings: Settings) -> None:
    await apply_migrations(driver, settings.neo4j_database)

    assert await back_up_if_due(context(driver, settings)) is None
    assert automatic_archives(context(driver, settings).backups) == []


async def test_a_backup_a_day_listed_as_automatic(driver: AsyncDriver, settings: Settings) -> None:
    await apply_migrations(driver, settings.neo4j_database)
    await load_seed(driver, settings.neo4j_database)
    ctx = context(driver, settings)
    now = datetime.now().astimezone()

    first = await back_up_if_due(ctx, now)
    assert first is not None
    assert first.people >= 40  # the made-up family, less its unknown parent
    assert await back_up_if_due(ctx, now + timedelta(hours=23)) is None  # not due yet
    second = await back_up_if_due(ctx, now + timedelta(days=1, seconds=1))
    assert second is not None

    listed = await list_backups(ctx)
    backups: list[Any] = listed.backups
    assert listed.automatic_backups is True
    assert [backup.automatic for backup in backups] == [True, True]
    assert {backup.name for backup in backups} == {first.path.name, second.path.name}
