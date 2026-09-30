"""Request dependencies: the driver and settings opened by the app's lifespan."""

from typing import Annotated, cast

from fastapi import Depends, Request
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.services.context import Context
from ancestree.services.history import History


def _driver(request: Request) -> AsyncDriver:
    return cast(AsyncDriver, request.app.state.driver)


def _settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def _context(request: Request) -> Context:
    settings = _settings(request)
    return Context(
        _driver(request),
        settings.neo4j_database,
        settings.data_dir,
        settings.backup_dir,
        settings.automatic_backups,
    )


def _history(request: Request) -> History:
    return cast(History, request.app.state.history)


Driver = Annotated[AsyncDriver, Depends(_driver)]
AppSettings = Annotated[Settings, Depends(_settings)]
Ctx = Annotated[Context, Depends(_context)]
Hist = Annotated[History, Depends(_history)]
