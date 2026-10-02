"""The FastAPI application."""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse, Response

from ancestree import __version__
from ancestree.api import (
    dates,
    exports,
    family,
    family_folder,
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
from ancestree.exchange.restore import ArchiveError, restore_archive
from ancestree.importing.sheet import SheetError
from ancestree.media.photos import PhotoError
from ancestree.migrations.runner import apply_migrations
from ancestree.services import journal
from ancestree.services.automatic import keep_backing_up
from ancestree.services.context import Context, NotFoundError, RuleError
from ancestree.services.familyfolder import FamilyFolder, keep_in_step
from ancestree.services.history import History, Step
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
            context = Context(
                driver,
                active.neo4j_database,
                active.data_dir,
                active.backup_dir,
                active.automatic_backups,
            )
            backing_up = None
            if active.automatic_backups:
                backing_up = asyncio.create_task(keep_backing_up(context))
            history_now: History = app.state.history

            async def take_in(archive: Path, backup_first: bool) -> object:
                # As a restore by hand: no change slips in, and nothing before can be undone.
                async with history_now.lock:
                    restored = await restore_archive(context, archive, backup_first=backup_first)
                    history_now.clear()
                    return restored

            folder = FamilyFolder(context, restore=take_in, history=history_now)
            app.state.family_folder = folder

            def journal_step(step: Step, how: str) -> None:
                by = folder.journaling()
                if by is not None:
                    journal.record(context.data_dir, step, by, how)

            history_now.journal = journal_step
            keeping = asyncio.create_task(keep_in_step(app.state.family_folder))
            yield
            keeping.cancel()
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
        family_folder,
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

    app.add_exception_handler(NotFoundError, not_found)
    app.add_exception_handler(RuleError, rule_broken)
    app.add_exception_handler(PhotoError, bad_photo)
    app.add_exception_handler(ArchiveError, bad_archive)
    app.add_exception_handler(SheetError, bad_spreadsheet)

    @app.middleware("http")
    async def kept_by_the_keeper(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """On a relative's computer the family arrives from the family folder. One that
        sends its changes to the keeper changes people, links, stories and photos, which wait
        for the keeper; the family's own settings, imports and restoring a backup stay
        the keeper's. Any other changes nothing: a change made there would be lost."""
        folder: FamilyFolder | None = getattr(request.app.state, "family_folder", None)
        if folder is None or folder.editing:
            return await call_next(request)
        if folder.proposing and _keepers_own(request):
            return _error(
                status.HTTP_409_CONFLICT,
                "kept_by_the_keeper",
                "That's for the family's keeper to change: it arrives here from the family folder.",
            )
        if not folder.proposing and _changes_family(request):
            return _error(
                status.HTTP_409_CONFLICT,
                "kept_by_the_keeper",
                "This family is kept by its keeper, and arrives from the family folder: "
                "it can't be changed on this computer.",
            )
        return await call_next(request)

    return app


# What changes the family itself, rather than this computer's own choices ("Me", the kinship
# language, layouts) or making exports and backups.
_FAMILY_CHANGES = (
    "/api/persons",
    "/api/relationships",
    "/api/relationship-kinds",
    "/api/trash",
    "/api/history",
    "/api/places/pins",
)


# Of those, what stays the keeper's even on a relative's computer that sends its changes to
# the keeper, whose review takes people, links, stories and photos.
_KEEPERS_OWN = ("/api/relationship-kinds", "/api/places/pins")


def _changes_family(request: Request) -> bool:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return False
    path = request.url.path
    if path.startswith(_FAMILY_CHANGES):
        return True
    return _brings_in(path)


def _keepers_own(request: Request) -> bool:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return False
    path = request.url.path
    return path.startswith(_KEEPERS_OWN) or _brings_in(path)


def _brings_in(path: str) -> bool:
    """An import, or a backup restored: a whole family's worth of changes at once."""
    if path.startswith("/api/imports"):
        return not path.endswith("/preview")
    return path.startswith("/api/backups/") and path.endswith("/restore")


def _error(status_code: int, code: str, message: str, **details: object) -> JSONResponse:
    """Errors carry a code for the app and a plain sentence for people."""
    return JSONResponse(
        status_code=status_code, content={"detail": {"code": code, "message": message, **details}}
    )
