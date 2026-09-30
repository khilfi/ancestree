"""The desktop app's engine: AncesTree's pages and API, on the app's own Neo4j.

The desktop shell starts it with --managed, reads one JSON line per event from its output,
and writes "stop" to its input, or closes it, to stop it; it stops at once, even while
Neo4j is still starting. By hand, from backend/:

    uv run python ../desktop/engine/engine.py --data <folder>

The shell passes a secret made for each start in ANCESTREE_SESSION, and then only its window
gets in (ancestree/desktop/guard.py). A backup is made each day, into the data folder's
backups/, the last 30 kept.

With ANCESTREE_NEO4J_URI and ANCESTREE_NEO4J_PASSWORD set, it uses that Neo4j instead, yours
in Docker for example, and starts none of its own. With ANCESTREE_NEO4J_RUNTIME set, its own
Neo4j runs from the Neo4j and Java already fetched there, as in the tests.
"""

from __future__ import annotations

import argparse
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
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import SecretStr

from ancestree import __version__
from ancestree.config import Settings
from ancestree.desktop.guard import SessionGuard
from ancestree.exchange.copy_app import PREBUILT
from ancestree.main import create_app
from ancestree.ownneo4j.runtime import NEO4J_VERSION, FetchError, Runtime
from ancestree.ownneo4j.server import OwnNeo4j, StoppedError, send_ctrl_c

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


class Stop:
    """A stop the shell asks for, at any time: while Neo4j starts, or once the app runs."""

    def __init__(self) -> None:
        self.asked = threading.Event()
        self.server: uvicorn.Server | None = None

    def watch(self, updates: Updates | None = None) -> None:
        """The shell writes "stop", or closes our input when it goes: either way, stop. Its
        other lines tell of new versions of the app."""
        for line in sys.stdin:
            text = line.strip()
            if text == "stop":
                break
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
    stop = Stop()
    updates = Updates(os.environ.get("ANCESTREE_APP_VERSION", __version__))
    if args.managed:
        threading.Thread(target=stop.watch, args=(updates,), daemon=True).start()
    emit(stage="preparing", version=__version__, neo4j=NEO4J_VERSION)
    own: OwnNeo4j | None = None
    about: dict[str, Any] = {"engine": __version__, "app": updates.current}
    try:
        if external := os.environ.get("ANCESTREE_NEO4J_URI"):
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
            own = OwnNeo4j(root / "neo4j", runtime, helper_command())
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
            data_dir=root / "family",
            backup_dir=root / "backups",
            automatic_backups=True,
        )
        if FROZEN:  # the copy's app came ready built, beside the app's pages
            os.environ.setdefault(
                PREBUILT, str(Path(getattr(sys, "_MEIPASS", "")) / "viewer" / "viewer.html")
            )
        app = create_app(settings)
        add_desktop_routes(app, root, about, updates)
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
