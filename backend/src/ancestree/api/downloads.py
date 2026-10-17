"""Downloads that say where they went: in the desktop app the
engine saves each one into the Downloads folder (DOWNLOADS_DIR, which only the desktop app's
engine sets) and says where, and Show in folder opens it there. In a browser, with no such
folder, each answers 409 browser_saves, and the browser saves them as ever."""

import asyncio
import re
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile, status
from pydantic import BaseModel, Field

from ancestree.api.deps import AppSettings, Ctx
from ancestree.desktop import downloads
from ancestree.exchange.spreadsheet import ENCODING
from ancestree.importing.template import template_csv
from ancestree.services import exports, imports
from ancestree.services.context import NotFoundError, RuleError

router = APIRouter(tags=["downloads"])

# The tree's picture, as the page names it: ancestree-tree-2026-10-17.png.
_PICTURE = re.compile(r"ancestree-tree-\d{4}-\d\d-\d\d\.(png|svg)")
_PICTURE_MOST = 200 * 1024 * 1024
_TEMPLATES = {
    "template": "ancestree-import-template.csv",
    "example": "ancestree-import-example.csv",
}


class DownloadRequest(BaseModel):
    what: Literal["export", "template", "example", "report"]
    name: str | None = Field(default=None, max_length=200)  # an export's or backup's
    id: str | None = Field(default=None, max_length=100)  # an import's, for its report


class Saved(BaseModel):
    """A download, saved."""

    name: str  # as saved there, with " (2)" if the name was taken
    folder: str  # the folder's own name, "Downloads"


def _folder(settings: AppSettings) -> Path:
    if settings.downloads_dir is None:
        raise RuleError("browser_saves", "Here the browser saves downloads.")
    return settings.downloads_dir


def _said(http: Request) -> set[str]:
    """The names saved since the app started: only those can be shown in their folder."""
    said: set[str] | None = getattr(http.app.state, "downloaded", None)
    if said is None:
        said = http.app.state.downloaded = set()
    return said


async def _save(http: Request, folder: Path, name: str, data: bytes | Path) -> Saved:
    try:
        path = await asyncio.to_thread(downloads.save, folder, name, data)
    except OSError as error:
        raise RuleError(
            "not_saved", f"{name} couldn't be saved in {folder.name} ({error.strerror or error})."
        ) from error
    _said(http).add(path.name)
    return Saved(name=path.name, folder=folder.name)


@router.post("/downloads", status_code=status.HTTP_201_CREATED)
async def save_download(
    ctx: Ctx, settings: AppSettings, http: Request, request: DownloadRequest
) -> Saved:
    """Save an export or backup, the import template or its example, or an import's report, in
    the Downloads folder: under its own name, or with " (2)" if that's taken."""
    folder = _folder(settings)
    data: bytes | Path
    if request.what == "export":
        data = exports.export_path(ctx, request.name or "")
        name = data.name
    elif request.what == "report":
        data = imports.report_path(ctx, request.id or "")
        name = f"ancestree-import-{request.id}.csv"
    else:
        name = _TEMPLATES[request.what]
        data = template_csv(example=request.what == "example").encode(ENCODING)
    return await _save(http, folder, name, data)


@router.post("/downloads/picture", status_code=status.HTTP_201_CREATED)
async def save_picture(
    settings: AppSettings,
    http: Request,
    file: Annotated[UploadFile, File()],
    name: Annotated[str, Form(max_length=40)],
) -> Saved:
    """Save the tree's picture, as the page drew it, in the Downloads folder."""
    folder = _folder(settings)
    if not _PICTURE.fullmatch(name):
        raise RuleError("not_a_picture", "That isn't the tree's picture's name.")
    data = await file.read(_PICTURE_MOST + 1)
    if len(data) > _PICTURE_MOST:
        raise RuleError("too_big", "The picture is too big to save.")
    return await _save(http, folder, name, data)


class Shown(BaseModel):
    name: str = Field(max_length=200)


@router.post("/downloads/show", status_code=status.HTTP_204_NO_CONTENT)
async def show_download(settings: AppSettings, http: Request, request: Shown) -> None:
    """Open the Downloads folder with this download chosen: only one saved since the app
    started, and still there."""
    folder = _folder(settings)
    path = folder / request.name
    if request.name not in _said(http) or not downloads.plain_name(request.name):
        raise NotFoundError("That isn't a download saved here.")
    if not path.is_file():
        raise NotFoundError(f"{request.name} isn't in {folder.name} any more.")
    await asyncio.to_thread(downloads.show, path)
