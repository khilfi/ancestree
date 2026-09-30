"""The copy's app: the frontend, built by Vite in view-only mode
into one HTML file.

Making a copy first checks whether the frontend's code has changed since the copy's app was
last built, and builds it again if so. Every copy therefore carries the app as it is now, new
features included, with no step of yours.

The desktop app carries the copy's app ready built, and names it in ANCESTREE_COPY_APP:
a relative's computer has neither the frontend's code nor Node.js to build it with.
"""

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from ancestree.config import REPO_ROOT

FRONTEND = REPO_ROOT / "frontend"
OUT = "dist-viewer"
PAGE = "viewer.html"
_STAMP = "copy-app.json"
# What the copy's app is built from: its code, its page, and the build's own settings.
_INPUTS = ("src", PAGE, "vite.config.ts", "package.json", "pnpm-lock.yaml", "tsconfig.json")
_TIMEOUT = 300  # seconds
PREBUILT = "ANCESTREE_COPY_APP"  # the page, built already: in the desktop app


class CopyAppError(Exception):
    """The copy's app can't be built here; the message says what's missing."""


def _input_files(frontend: Path) -> list[Path]:
    files: list[Path] = []
    for name in _INPUTS:
        path = frontend / name
        if path.is_dir():
            files += [p for p in path.rglob("*") if p.is_file()]
        elif path.is_file():
            files.append(path)
    return sorted(files)


def fingerprint(frontend: Path) -> str:
    """Changes whenever anything the copy's app is built from changes."""
    digest = hashlib.sha256()
    for path in _input_files(frontend):
        digest.update(path.relative_to(frontend).as_posix().encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


def _build(frontend: Path) -> None:
    node = shutil.which("node")
    if node is None:
        raise CopyAppError("Node.js isn't installed, so the copy's app can't be built.")
    vite = frontend / "node_modules" / "vite" / "bin" / "vite.js"
    if not vite.is_file():
        raise CopyAppError(
            "The frontend's packages aren't installed. In frontend/, run: pnpm install"
        )
    try:
        # Our own build, with fixed arguments: nothing from outside reaches the command.
        done = subprocess.run(  # noqa: S603
            [node, str(vite), "build", "--mode", "viewer"],
            cwd=frontend,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise CopyAppError("Building the copy's app took too long.") from error
    if done.returncode != 0:
        said = (done.stderr or done.stdout).strip().splitlines()[-12:]
        raise CopyAppError("The copy's app couldn't be built:\n" + "\n".join(said))


def ready_page(frontend: Path = FRONTEND) -> str:
    """The copy's app, built again first if the frontend has changed since."""
    out = frontend / OUT
    wanted = fingerprint(frontend)
    stamp = out / _STAMP
    built = json.loads(stamp.read_text("utf-8")).get("inputs") if stamp.is_file() else None
    if built != wanted or not (out / PAGE).is_file():
        _build(frontend)
        stamp.write_text(
            json.dumps({"inputs": wanted, "built_at": datetime.now().astimezone().isoformat()}),
            encoding="utf-8",
        )
    return (out / PAGE).read_text(encoding="utf-8")


_building = asyncio.Lock()  # two copies at once share one build


async def copy_app(frontend: Path = FRONTEND) -> str:
    if prebuilt := os.environ.get(PREBUILT):
        return await asyncio.to_thread(Path(prebuilt).read_text, encoding="utf-8")
    async with _building:
        return await asyncio.to_thread(ready_page, frontend)
