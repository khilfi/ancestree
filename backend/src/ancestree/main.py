"""The FastAPI application."""

import asyncio
import logging
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse, Response

from ancestree import __version__
from ancestree.api import (
    dates,
    downloads,
    exports,
    family,
    family_folder,
    graph,
    history,
    imports,
    kinship,
    map_packs,
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
from ancestree.familyfolder.drive import DriveError
from ancestree.familyfolder.google import GoogleError, OfflineError
from ancestree.familyfolder.protect import ProtectError
from ancestree.familyfolder.seals import RefusedError
from ancestree.importing.sheet import SheetError
from ancestree.maps.packs import PackStore
from ancestree.media.photos import PhotoError
from ancestree.migrations.runner import apply_migrations
from ancestree.places import gazetteer as gazetteer_module
from ancestree.seed.example import ExampleRefusedError, write_example
from ancestree.services import journal, placing
from ancestree.services.automatic import keep_backing_up
from ancestree.services.context import Context, NotFoundError, RuleError
from ancestree.services.familyfolder import FamilyFolder, keep_in_step
from ancestree.services.history import History, Step
from ancestree.storage.data_dir import ensure_data_dir
from ancestree.storage.files import TRASH_DAYS, clean_photos, photos_cleaned, purge_trash

# uvicorn's logger, so startup messages appear in the server console.
log = logging.getLogger("uvicorn.error")


async def _clean_photos(data_dir: Path) -> None:
    changed = await asyncio.to_thread(clean_photos, data_dir)
    if changed:
        log.info("Took what cameras wrote out of %d photos kept from before", changed)


def create_app(
    settings: Settings | None = None,
    *,
    on_round: Callable[[FamilyFolder], None] | None = None,
    docs: bool = True,
) -> FastAPI:
    """Build the app. Settings are read at startup unless given (tests pass their own).
    `on_round`: told after each round with the family folder, as the desktop app's engine is
    (0.4.0). `docs`: the API's own pages (/docs, /redoc, /openapi.json), for development."""

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
            app.state.map_packs = PackStore(active.maps)  # the map's packs
            if tidied := await asyncio.to_thread(app.state.map_packs.tidy):
                log.info("Removed map packs of an earlier build: %s", ", ".join(tidied))
            # The places downloaded with them, read by the gazetteer, afresh when they change.
            gazetteer_module.places_of = app.state.map_packs.places_path
            app.state.map_packs.places_changed = lambda country, here: (
                gazetteer_module.gazetteer.cache_clear()
            )
            gazetteer_module.gazetteer.cache_clear()
            context = Context(
                driver,
                active.neo4j_database,
                active.data_dir,
                active.backup_dir,
                active.automatic_backups,
                active.family,
            )
            if active.restore_first is not None and active.restore_first.is_file():
                # A family added from a backup, opening for the first time (0.4.0). One that
                # can't be restored leaves the family empty, with the backup in its list.
                try:
                    await restore_archive(context, active.restore_first, backup_first=False)
                    log.info("Restored %s, as the family opened", active.restore_first.name)
                except ArchiveError as error:
                    log.warning("The family's backup couldn't be restored: %s", error)
            if active.example_first:
                # The example family, opening for the first time: filled with it, unless
                # anyone is here already.
                try:
                    filled = await write_example(context)
                    log.info("Filled with the example family: %s people", filled.people)
                except ExampleRefusedError as error:
                    log.warning("%s", error)
            backing_up = None
            if active.automatic_backups:
                backing_up = asyncio.create_task(keep_backing_up(context))
            # Photos kept from before 0.4.2 lose their camera's metadata, once, while the app
            # runs: started here, it holds nothing up.
            cleaning = None
            if not photos_cleaned(active.data_dir):
                cleaning = asyncio.create_task(_clean_photos(active.data_dir))
            history_now: History = app.state.history

            async def take_in(archive: Path, backup_first: bool) -> object:
                # As a restore by hand: no change slips in, and nothing before can be undone.
                async with history_now.lock:
                    restored = await restore_archive(context, archive, backup_first=backup_first)
                    history_now.clear()
                    return restored

            folder = FamilyFolder(
                context,
                restore=take_in,
                history=history_now,
                on_round=on_round,
                made_up=active.example,
            )
            app.state.family_folder = folder
            store: PackStore = app.state.map_packs
            loop = asyncio.get_running_loop()
            placing_now: set[asyncio.Task[None]] = set()

            async def place_more(country: str) -> None:
                # Only where the family may be changed with no review: on a relative's computer
                # it would wait for the keeper, from every relative who downloads the country.
                if not folder.editing:
                    return
                try:
                    moved = await placing.place_more_exactly(context, history_now, country)
                except Exception:
                    log.exception("The addresses in %s couldn't be placed more exactly", country)
                    return
                if moved:
                    store.placed[country] = store.placed.get(country, 0) + moved
                    log.info(
                        "%d addresses placed more exactly, as %s's places came", moved, country
                    )

            def places_changed(country: str, here: bool) -> None:
                # Told on the thread that fetched them: the rest is done on the event loop.
                gazetteer_module.gazetteer.cache_clear()
                if here:

                    def start() -> None:
                        task = loop.create_task(place_more(country))
                        placing_now.add(task)
                        task.add_done_callback(placing_now.discard)

                    loop.call_soon_threadsafe(start)

            store.places_changed = places_changed

            def journal_step(step: Step, how: str) -> None:
                by = folder.journaling()
                if by is not None:
                    journal.record(context.data_dir, step, by, how)

            history_now.journal = journal_step
            keeping = asyncio.create_task(keep_in_step(app.state.family_folder))
            yield
            await folder.last_round()  # nothing that could go is left waiting (0.4.0)
            keeping.cancel()
            if backing_up is not None:
                backing_up.cancel()
            if cleaning is not None:
                cleaning.cancel()
        finally:
            await driver.close()

    app = FastAPI(
        title="AncesTree",
        version=__version__,
        lifespan=lifespan,
        # Readable operation ids ("get_graph") for the generated frontend client. FastAPI
        # passes a route-like object here, not always an APIRoute, so don't isinstance-check.
        generate_unique_id_function=lambda route: route.name,
        # The API's own pages, for development: the desktop app's engine has none (`docs`).
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
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
        downloads,
        history,
        family,
        family_folder,
        imports,
        places,
        map_packs,
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

    # The family folder's own troubles, should one reach here unsaid (0.3.1): a sentence,
    # never a failure without one.
    async def family_folder_trouble(request: Request, error: Exception) -> JSONResponse:
        if isinstance(error, OfflineError):
            code, message = "offline", "Google Drive can't be reached: check the internet."
        elif isinstance(error, DriveError):
            code, message = "drive_said_no", str(error)
        elif isinstance(error, GoogleError):
            code, message = "google_said_no", str(error)
        elif isinstance(error, RefusedError):
            code = "didnt_check_out"
            message = f"Something in the family folder didn't check out ({error})."
        else:
            code = "cant_be_locked"
            message = f"This computer's keys couldn't be locked or opened here ({error})."
        return _error(status.HTTP_409_CONFLICT, code, message)

    app.add_exception_handler(NotFoundError, not_found)
    app.add_exception_handler(RuleError, rule_broken)
    app.add_exception_handler(PhotoError, bad_photo)
    app.add_exception_handler(ArchiveError, bad_archive)
    app.add_exception_handler(SheetError, bad_spreadsheet)
    for trouble in (OfflineError, DriveError, GoogleError, RefusedError, ProtectError):
        app.add_exception_handler(trouble, family_folder_trouble)

    @app.middleware("http")
    async def kept_by_the_keeper(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """On a relative's computer the family arrives from the family folder. One that
        sends its changes to the keeper changes people, links, stories and photos, which wait
        for the keeper; the family's own settings, imports and restoring a backup stay
        the keeper's. Any other changes nothing: a change made there would be lost."""
        folder: FamilyFolder | None = getattr(request.app.state, "family_folder", None)
        if (
            folder is not None
            and folder.offering
            and (_changes_family(request) or _keepers_own(request))
        ):
            # Offered to another computer: what changed here would never reach anyone.
            return _error(status.HTTP_409_CONFLICT, "offered", folder.offered_words())
        if folder is None or folder.editing:
            return _nudged(folder, request, await call_next(request))
        if folder.proposing and _keepers_own(request):
            return _error(
                status.HTTP_409_CONFLICT,
                "kept_by_the_keeper",
                "That's for the family's keeper to change: it arrives here from the family folder.",
            )
        if (
            not folder.proposing
            and _changes_family(request)
            and not (folder.sending and _says(request))
        ):
            return _error(
                status.HTTP_409_CONFLICT,
                "kept_by_the_keeper",
                "This family is kept by its keeper, and arrives from the family folder: "
                "it can't be changed on this computer.",
            )
        return _nudged(folder, request, await call_next(request))

    return app


# Someone's own words about someone: a viewer's computer may write these alone, which go
# to the keeper for review, as they're all the keeper's computer takes from it.
_SAYS = re.compile(r"^/api/persons/[^/]+/said(?:/[^/]+)?$")


def _says(request: Request) -> bool:
    return bool(_SAYS.match(request.url.path))


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


def _nudged(folder: FamilyFolder | None, request: Request, response: Response) -> Response:
    """A change to the family made here: the family folder keeps in step a few seconds after,
    rather than within the minute (0.4.0)."""
    if folder is not None and response.status_code < 400 and _changes_family(request):
        folder.nudge()
    return response


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
