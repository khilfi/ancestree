"""The desktop app's engine: AncesTree's pages and API, on the app's own Neo4j.

The desktop shell starts it with --managed, reads one JSON line per event from its output,
and writes "stop" to its input, or closes it, to stop it; it stops at once, even while
Neo4j is still starting. By hand, from backend/:

    uv run python ../desktop/engine/engine.py --data <folder>

The shell passes a secret made for each start in ANCESTREE_SESSION, and then only its window
gets in (ancestree/desktop/guard.py). A backup is made each day, into the family's backups/,
the last 30 kept.

The data folder can hold several families, each apart (0.4.0; ancestree/desktop/families.py).
The engine opens the one families.json names, with its folders alone. Opening another, from the
app, says "restart" to the shell, which starts the engine again on it.

With ANCESTREE_NEO4J_URI and ANCESTREE_NEO4J_PASSWORD set, it uses that Neo4j instead, yours
in Docker for example, and starts none of its own. With ANCESTREE_NEO4J_RUNTIME set, its own
Neo4j runs from the Neo4j and Java already fetched there, as in the tests.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import os
import socket
import sys
import threading
import time
from datetime import UTC, datetime
from http.client import HTTPException
from pathlib import Path
from typing import Annotated, Any

import uvicorn
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, SecretStr, StringConstraints

from ancestree import __version__
from ancestree.config import Settings
from ancestree.desktop.families import Families, FamiliesError, Family
from ancestree.desktop.guard import SessionGuard
from ancestree.exchange.copy_app import PREBUILT
from ancestree.exchange.locked import MAGIC, LockedError, key_for, unlock
from ancestree.exchange.restore import ArchiveError, read_info
from ancestree.main import create_app
from ancestree.ownneo4j.runtime import NEO4J_VERSION, FetchError, Runtime
from ancestree.ownneo4j.server import OwnNeo4j, StoppedError, send_ctrl_c
from ancestree.services.familyfolder import FamilyFolder

FROZEN = getattr(sys, "frozen", False)


def emit(**event: Any) -> None:
    """One line of JSON for the shell. Once the shell has gone, crashed or force-quit, there's
    no one to tell, and the engine carries on: stopping Neo4j matters more."""
    line = json.dumps({"at": datetime.now(UTC).isoformat(timespec="seconds"), **event})
    try:
        print(line, flush=True)
    except OSError:  # the pipe is broken: EPIPE, or EINVAL on Windows
        # Python flushes its output again as it exits: send it nowhere, so that can't fail.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


def pages_folder() -> Path:
    """The built app: inside the engine when frozen, frontend/dist when run from the code."""
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", "")) / "pages"
    return Path(__file__).resolve().parents[2] / "frontend" / "dist"


def helper_command() -> list[str]:
    """How to run the Ctrl+C helper: this engine again when frozen, Python otherwise."""
    if FROZEN:
        return [sys.executable, "--send-ctrl-c"]
    return [sys.executable, "-m", "ancestree.ownneo4j.server"]


def add_pages(app: FastAPI, pages: Path) -> None:
    """The app's pages at every address but /api, where the app's own router takes over."""
    # Windows can map .js to text/plain in its registry; browsers refuse such a module.
    for kind, suffix in (
        ("text/javascript", ".js"),
        ("text/css", ".css"),
        ("image/svg+xml", ".svg"),
        ("font/woff2", ".woff2"),
        ("application/json", ".json"),
        ("image/webp", ".webp"),
    ):
        mimetypes.add_type(kind, suffix)
    root = pages.resolve()
    index = root / "index.html"

    @app.get("/{path:path}", include_in_schema=False, response_model=None)
    async def page(path: str) -> FileResponse | JSONResponse:
        if path == "api" or path.startswith("api/"):
            return JSONResponse(
                {"detail": {"code": "not_found", "message": "Nothing at this address"}},
                status_code=404,
            )
        file = (root / path).resolve()
        if path and file.is_file() and file.is_relative_to(root):
            return FileResponse(file)
        return FileResponse(index)


class Updates:
    """What the shell has found out about new versions of the app. Only the engine speaks
    to the app's pages, so the shell tells it, a line at a time on its input:

        update {"version": "0.2.0", "notes": "..."}   a new version, fetched and checked
        update-none                                   there's none
        update-failed <why>                           the check didn't get an answer
    """

    GIVE_UP = 15 * 60  # seconds: a check the shell never answered no longer counts

    def __init__(self, current: str) -> None:
        self.current = current
        self.available: dict[str, str] | None = None
        self.checking_since: float | None = None
        self.checked_at: str | None = None
        self.problem: str | None = None

    def hear(self, line: str) -> None:
        command, _, rest = line.partition(" ")
        if command == "update":
            try:
                found = json.loads(rest)
                self.available = {
                    "version": str(found["version"]),
                    "notes": str(found.get("notes") or ""),
                }
            except ValueError, KeyError, TypeError:
                return  # not what the shell writes: nothing to show
            self.problem = None
        elif command == "update-none":
            self.problem = None
        elif command == "update-failed":
            self.problem = rest.strip()[:300] or "The check didn't get an answer"
        else:
            return
        self.checking_since = None
        self.checked_at = datetime.now(UTC).isoformat(timespec="seconds")

    def check(self) -> bool:
        """Ask the shell to look now; False if it's looking already."""
        if self.checking:
            return False
        self.checking_since = time.monotonic()
        emit(stage="check-updates")
        return True

    @property
    def checking(self) -> bool:
        since = self.checking_since
        return since is not None and time.monotonic() - since < self.GIVE_UP

    def state(self) -> dict[str, Any]:
        return {
            "current": self.current,
            "available": self.available,
            "checking": self.checking,
            "checked_at": self.checked_at,
            "problem": self.problem,
        }


def add_desktop_routes(app: FastAPI, root: Path, about: dict[str, Any], updates: Updates) -> None:
    @app.get("/api/desktop/about", include_in_schema=False)
    async def get_about() -> dict[str, Any]:
        return about

    @app.get("/api/desktop/update", include_in_schema=False)
    async def get_update() -> dict[str, Any]:
        return updates.state()

    @app.post("/api/desktop/update/check", include_in_schema=False)
    async def check_update() -> dict[str, Any]:
        updates.check()
        return updates.state()

    @app.post("/api/desktop/update/restart", include_in_schema=False, response_model=None)
    async def restart_to_update() -> dict[str, Any] | JSONResponse:
        if updates.available is None:
            return JSONResponse(
                {"detail": {"code": "no_update", "message": "There's no new version yet."}},
                status_code=409,
            )
        emit(stage="restart-to-update", version=updates.available["version"])
        return updates.state()

    @app.post("/api/desktop/bench", include_in_schema=False)
    async def save_bench(request: Request) -> dict[str, str]:
        result = await request.json()
        (root / "bench.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        emit(stage="bench", result=result)
        return {"saved": "bench.json"}


class FamilyName(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


FAMILY_ID = r"^[0-9a-f]{16}$"


def _refused(code: str, message: str, status: int = 409) -> JSONResponse:
    return JSONResponse({"detail": {"code": code, "message": message}}, status_code=status)


def _refused_for(error: FamiliesError) -> JSONResponse:
    return _refused(error.code, error.message, 404 if error.code == "no_such_family" else 409)


def add_family_routes(app: FastAPI, families: Families, family: Family, external: bool) -> None:
    """Several families on one computer (0.4.0): the list, adding, renaming, removing and
    putting back, and opening another, which the shell does by starting the engine again on
    its folders. With a database of the developer's own (ANCESTREE_NEO4J_URI), one family."""

    @app.get("/api/desktop/families", include_in_schema=False)
    async def list_families() -> dict[str, Any]:
        return {**families.listed(), "single": external}

    @app.post("/api/desktop/families", include_in_schema=False, response_model=None)
    async def add_family(body: FamilyName) -> dict[str, Any] | JSONResponse:
        if external:
            return _refused(
                "one_database",
                "This AncesTree uses a database of its own choosing, which holds one family.",
            )
        try:
            added = families.add(body.name)
        except FamiliesError as error:
            return _refused(error.code, error.message)
        return {**families.listed(), "added": added.id}

    @app.post("/api/desktop/families/from-backup", include_in_schema=False, response_model=None)
    async def add_family_from_backup(
        file: Annotated[UploadFile, File()],
        password: Annotated[str | None, Form(max_length=200)] = None,
    ) -> dict[str, Any] | JSONResponse:
        """A family from a backup: added, with the backup kept in its backups, and restored
        when it first opens. It keeps the family's id, so its backups are its own. A copy
        locked with a password is opened with `password` first."""
        if external:
            return _refused(
                "one_database",
                "This AncesTree uses a database of its own choosing, which holds one family.",
            )
        staging = families.root / f".family-from-backup-{os.getpid()}.zip"
        opened = staging.with_suffix(".opened")
        try:
            with staging.open("wb") as out:
                while chunk := await file.read(1 << 20):
                    out.write(chunk)
            with staging.open("rb") as start:
                if start.read(len(MAGIC)) == MAGIC:
                    if not password:
                        return _refused(
                            "locked_backup",
                            "That backup is locked: type the password it was locked with.",
                        )
                    try:
                        unlock(staging, opened, key_for(staging, password))
                    except LockedError as error:
                        return _refused("not_unlocked", str(error))
            if opened.is_file():
                opened.replace(staging)
            info = read_info(staging)
            added = families.add(
                info.family_name or "A family from a backup", family_id=info.family_id
            )
            name = f"ancestree-backup-{info.made_at:%Y-%m-%dT%H-%M-%S}.zip"
            staging.replace(families.places(added).backups / name)
            families.note(added.id, restore=name)
        except ArchiveError as error:
            return _refused("bad_archive", str(error), 422)
        except FamiliesError as error:
            return _refused(error.code, error.message)
        finally:
            staging.unlink(missing_ok=True)
            opened.unlink(missing_ok=True)
        return {**families.listed(), "added": added.id}

    @app.patch("/api/desktop/families/{family_id}", include_in_schema=False, response_model=None)
    async def rename_family(family_id: str, body: FamilyName) -> dict[str, Any] | JSONResponse:
        try:
            families.rename(family_id, body.name)
        except FamiliesError as error:
            return _refused_for(error)
        return families.listed()

    @app.delete("/api/desktop/families/{family_id}", include_in_schema=False, response_model=None)
    async def remove_family(family_id: str) -> dict[str, Any] | JSONResponse:
        try:
            await asyncio.to_thread(families.remove, family_id)
        except FamiliesError as error:
            return _refused_for(error)
        except OSError as error:
            return _refused(
                "cant_be_moved",
                f"That family's folders couldn't be moved to AncesTree's bin ({error}).",
            )
        return families.listed()

    @app.post(
        "/api/desktop/families/removed/{family_id}/put-back",
        include_in_schema=False,
        response_model=None,
    )
    async def put_family_back(family_id: str) -> dict[str, Any] | JSONResponse:
        try:
            await asyncio.to_thread(families.put_back, family_id)
        except FamiliesError as error:
            return _refused_for(error)
        return families.listed()

    @app.post(
        "/api/desktop/families/{family_id}/open", include_in_schema=False, response_model=None
    )
    async def open_family(family_id: str, request: Request) -> dict[str, Any] | JSONResponse:
        """Another family, opened: the open one has a last round in step, so nothing that
        could go is left waiting; then the shell starts the engine again, on the other."""
        try:
            chosen = families.choose(family_id)
        except FamiliesError as error:
            return _refused(error.code, error.message, 404)
        if chosen.id == family.id:
            return {**families.listed(), "opening": None}
        folder: FamilyFolder | None = getattr(request.app.state, "family_folder", None)
        if folder is not None:
            await folder.last_round()
        emit(stage="restart", family=chosen.name)
        return {**families.listed(), "opening": chosen.name}


class Stop:
    """A stop the shell asks for, at any time: while Neo4j starts, or once the app runs."""

    def __init__(self) -> None:
        self.asked = threading.Event()
        self.server: uvicorn.Server | None = None
        self.app: FastAPI | None = None

    def watch(self, updates: Updates | None = None) -> None:
        """The shell writes "stop", or closes our input when it goes: either way, stop. Its
        other lines tell of new versions of the app, or ask the family folder to keep in step
        now, from the icon by the clock (0.4.0)."""
        for line in sys.stdin:
            text = line.strip()
            if text == "stop":
                break
            if text == "sync":
                folder = getattr(self.app.state, "family_folder", None) if self.app else None
                if folder is not None:
                    folder.sync_soon()
                continue
            if updates is not None:
                updates.hear(text)
        self.asked.set()
        if self.server is not None:
            self.server.should_exit = True


def install(runtime: Runtime, stop: Stop) -> bool:
    """Fetch Neo4j and Java if need be; without the internet, say so and try again."""
    wait = 10
    while True:
        try:
            return runtime.install(
                lambda what, done, total: emit(stage="download", what=what, done=done, total=total)
            )
        except (OSError, HTTPException, FetchError) as error:  # no internet, or cut off
            emit(stage="waiting-for-internet", message=str(error)[:300], retry_in=wait)
            if stop.asked.wait(wait):
                raise StoppedError from error
            wait = min(wait * 2, 60)


def in_step_line(folder: FamilyFolder, name: str) -> str:
    """The icon by the clock's tooltip: the family open, and how it stands with its family
    folder (0.4.0). Short: Windows shows 127 characters at most."""
    head = f"AncesTree · {name[:40]}"
    if folder.setup is None:
        return head
    when = ""
    if folder.last_sync is not None:
        local = folder.last_sync.astimezone()
        today = local.date() == datetime.now().astimezone().date()
        when = local.strftime("%H:%M" if today else "%d %b, %H:%M")
    if folder.syncing:
        return f"{head} · keeping in step…"
    if folder.went_through:
        return f"{head} · in step at {when}"
    if folder.drive is None:
        return f"{head} · sign in to Google, in Settings"
    if when:
        return f"{head} · not in step since {when}: see Settings"
    return f"{head} · not in step yet: see Settings"


def first_name(root: Path) -> str:
    """The first family's name, before 0.4.0's families list: its family folder's, if it has
    one."""
    try:
        setup = json.loads((root / "family" / "familyfolder" / "setup.json").read_text("utf-8"))
        return str(setup.get("family") or "") or "My family"
    except OSError, ValueError, AttributeError:
        return "My family"


def _announce(server: uvicorn.Server, port: int) -> None:
    while not server.started:
        if server.should_exit:
            return
        time.sleep(0.05)
    emit(stage="ready", port=port)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="AncesTree's engine for the desktop app")
    parser.add_argument("--data", type=Path, help="the app's data folder")
    parser.add_argument("--port", type=int, default=0, help="the app's port (default: any free)")
    parser.add_argument("--browser", action="store_true", help="also serve Neo4j Browser")
    parser.add_argument("--managed", action="store_true", help="stop when the input closes")
    parser.add_argument("--send-ctrl-c", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.send_ctrl_c:
        send_ctrl_c(args.send_ctrl_c)
        return
    if args.data is None:
        parser.error("--data is required")

    root: Path = args.data.resolve()
    root.mkdir(parents=True, exist_ok=True)
    families = Families.load(root, first_name(root))
    external = os.environ.get("ANCESTREE_NEO4J_URI")
    if external:
        families.open_id = families.families[0].id  # one database: the first family alone
    family = families.open
    places = families.places(family)
    if gone := families.tidy():
        print(f"Families removed over 30 days ago, deleted: {', '.join(gone)}", file=sys.stderr)
    stop = Stop()
    updates = Updates(os.environ.get("ANCESTREE_APP_VERSION", __version__))
    if args.managed:
        threading.Thread(target=stop.watch, args=(updates,), daemon=True).start()
    emit(stage="preparing", version=__version__, neo4j=NEO4J_VERSION, family=family.name)
    own: OwnNeo4j | None = None
    about: dict[str, Any] = {"engine": __version__, "app": updates.current}
    try:
        if external:
            uri, password = external, os.environ.get("ANCESTREE_NEO4J_PASSWORD", "")
            about["neo4j"] = "external"
            emit(stage="database-ready", external=True)
        else:
            fetched_before = os.environ.get("ANCESTREE_NEO4J_RUNTIME")
            runtime = Runtime(
                Path(fetched_before) if fetched_before else root / "neo4j" / "runtime"
            )
            began = time.monotonic()
            fetched = install(runtime, stop)
            own = OwnNeo4j(places.neo4j, runtime, helper_command())
            browser_port = free_port() if args.browser else None
            own.configure(free_port(), browser_port)
            emit(
                stage="starting-database",
                fetched=fetched,
                install_seconds=round(time.monotonic() - began, 1),
            )
            own.start()
            seconds = own.wait_ready(stopping=stop.asked)
            tidied = [] if fetched_before else runtime.tidy()  # a shared folder is left be
            emit(
                stage="database-ready",
                seconds=round(seconds, 1),
                browser_port=browser_port,
                tidied=tidied,
            )
            uri, password = own.uri, own.password()
            about.update(
                neo4j=NEO4J_VERSION, database_start_seconds=round(seconds, 1), fetched=fetched
            )
        settings = Settings(
            _env_file=None,  # never the repository's .env
            neo4j_uri=uri,
            neo4j_user=os.environ.get("ANCESTREE_NEO4J_USER", "neo4j"),
            neo4j_password=SecretStr(password),
            neo4j_database=os.environ.get("ANCESTREE_NEO4J_DATABASE", "neo4j"),
            data_dir=places.data,
            backup_dir=places.backups,
            automatic_backups=True,
            family_id=family.id,
            family_name=family.name,
            restore_first=places.backups / family.restore if family.restore else None,
        )
        # Tried once, as the family opens: one that can't be restored stays in its backups.
        families.note(family.id, restore="")
        if FROZEN:  # the copy's app came ready built, beside the app's pages
            os.environ.setdefault(
                PREBUILT, str(Path(getattr(sys, "_MEIPASS", "")) / "viewer" / "viewer.html")
            )

        def in_step(folder: FamilyFolder) -> None:
            """Each round: the families list notes it, and the icon by the clock shows it."""
            setup = folder.setup
            families.note(
                family.id,
                role=setup.role if setup else "",
                in_step=setup.in_step if setup else "",
            )
            emit(stage="in-step", family=family.name, text=in_step_line(folder, family.name))

        app = create_app(settings, on_round=in_step)
        stop.app = app
        add_desktop_routes(app, root, about, updates)
        add_family_routes(app, families, family, external=bool(external))
        add_pages(app, pages_folder())
        port = args.port or free_port()
        if secret := os.environ.get("ANCESTREE_SESSION"):
            app.add_middleware(SessionGuard, secret=secret, port=port)
        server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        )
        stop.server = server
        threading.Thread(target=_announce, args=(server, port), daemon=True).start()
        if not stop.asked.is_set():
            server.run()
    except StoppedError:
        emit(stage="stopped-while-starting")
    finally:
        if own is not None:
            emit(stage="stopping-database")
            emit(stage="stopped", database=own.stop())


if __name__ == "__main__":
    main()
