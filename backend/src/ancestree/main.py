"""The FastAPI application."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from ancestree import __version__
from ancestree.api import (
    dates,
    exports,
    family,
    graph,
    history,
    imports,
    kinship,
    persons,
    places,
    relationship_kinds,
    relationships,
    system,
    trash,
)
from ancestree.config import Settings, get_settings
from ancestree.db import connect
from ancestree.exchange.restore import ArchiveError
from ancestree.exchange.returned import ReturnedError
from ancestree.importing.sheet import SheetError
from ancestree.media.photos import PhotoError
from ancestree.migrations.runner import apply_migrations
from ancestree.services.automatic import keep_backing_up
from ancestree.services.context import Context, NotFoundError, RuleError
from ancestree.services.history import History
from ancestree.storage.data_dir import ensure_data_dir
from ancestree.storage.files import TRASH_DAYS, purge_trash

# uvicorn's logger, so startup messages appear in the server console.
log = logging.getLogger("uvicorn.error")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Settings are read at startup unless given (tests pass their own)."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        active = settings or get_settings()
        driver = await connect(active)
        try:
            for migration in await apply_migrations(driver, active.neo4j_database):
                log.info("Applied migration %04d_%s", migration.version, migration.name)
            ensure_data_dir(active.data_dir)
            if purged := await asyncio.to_thread(purge_trash, active.data_dir):
                log.info("Emptied %d Trash entries older than %d days", purged, TRASH_DAYS)
            app.state.settings = active
            app.state.driver = driver
            backing_up = None
            if active.automatic_backups:
                context = Context(
                    driver, active.neo4j_database, active.data_dir, active.backup_dir, True
                )
                backing_up = asyncio.create_task(keep_backing_up(context))
            yield
            if backing_up is not None:
                backing_up.cancel()
        finally:
            await driver.close()

    app = FastAPI(
        title="AncesTree",
        version=__version__,
        lifespan=lifespan,
        # Readable operation ids ("get_graph") for the generated frontend client. FastAPI
        # passes a route-like object here, not always an APIRoute, so don't isinstance-check.
        generate_unique_id_function=lambda route: route.name,
    )
    app.state.history = History()  # undo and redo, for as long as the app runs
    for module in (
        system,
        graph,
        persons,
        relationships,
        relationship_kinds,
        kinship,
        trash,
        dates,
        exports,
        history,
        family,
        imports,
        places,
    ):
        app.include_router(module.router, prefix="/api")

    async def not_found(request: Request, error: Exception) -> JSONResponse:
        return _error(status.HTTP_404_NOT_FOUND, "not_found", str(error))

    async def rule_broken(request: Request, error: Exception) -> JSONResponse:
        if not isinstance(error, RuleError):  # registered for RuleError only
            raise error
        return _error(status.HTTP_409_CONFLICT, error.code, error.message, **error.details)

    async def bad_photo(request: Request, error: Exception) -> JSONResponse:
        return _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_photo", str(error))

    async def bad_archive(request: Request, error: Exception) -> JSONResponse:
        return _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_archive", str(error))

    async def bad_spreadsheet(request: Request, error: Exception) -> JSONResponse:
        return _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_spreadsheet", str(error))

    async def bad_copy(request: Request, error: Exception) -> JSONResponse:
        code = error.code if isinstance(error, ReturnedError) else "damaged"
        return _error(status.HTTP_422_UNPROCESSABLE_CONTENT, code, str(error))

    app.add_exception_handler(NotFoundError, not_found)
    app.add_exception_handler(RuleError, rule_broken)
    app.add_exception_handler(PhotoError, bad_photo)
    app.add_exception_handler(ArchiveError, bad_archive)
    app.add_exception_handler(SheetError, bad_spreadsheet)
    app.add_exception_handler(ReturnedError, bad_copy)
    return app


def _error(status_code: int, code: str, message: str, **details: object) -> JSONResponse:
    """Errors carry a code for the app and a plain sentence for people."""
    return JSONResponse(
        status_code=status_code, content={"detail": {"code": code, "message": message, **details}}
    )
