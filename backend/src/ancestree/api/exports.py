from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status
from fastapi.responses import FileResponse

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.exports import (
    Backup,
    BackupList,
    BackupRestored,
    ExportFile,
    ExportRequest,
)
from ancestree.exchange.copies import CopyOptions
from ancestree.services import exports

router = APIRouter(tags=["export"])

_MEDIA_TYPES = {
    ".zip": "application/zip",
    ".ged": "application/x-gedcom",
    ".csv": "text/csv",
    ".html": "text/html; charset=utf-8",  # a copy, downloaded as a file
}


@router.post("/exports", status_code=status.HTTP_201_CREATED)
async def make_export(ctx: Ctx, request: ExportRequest) -> ExportFile:
    """Make an export in DATA_DIR/exports: the full archive, GEDCOM 5.5.1, a spreadsheet, or
    a view-only copy of the app with the family inside, following its choices."""
    copy = CopyOptions(
        title=" ".join(request.title.split()),
        hide_living=request.hide_living,
        password=request.password,
        archive=request.archive,
    )
    return await exports.make_export(ctx, request.format, copy=copy)


@router.get("/exports/{name}", response_class=FileResponse)
async def download_export(ctx: Ctx, name: str) -> FileResponse:
    """An export or backup from DATA_DIR/exports, as a download."""
    path = exports.export_path(ctx, name)
    return FileResponse(path, media_type=_MEDIA_TYPES[path.suffix], filename=path.name)


@router.get("/backups")
async def list_backups(ctx: Ctx) -> BackupList:
    """The backup archives, newest first, with what each holds; and the backup folder
    (BACKUP_DIR), with whether it can be reached."""
    return await exports.list_backups(ctx)


@router.post("/backups", status_code=status.HTTP_201_CREATED)
async def add_backup(
    ctx: Ctx, file: Annotated[UploadFile, File(description="An AncesTree backup archive (.zip)")]
) -> Backup:
    """Bring in a backup archive from elsewhere, e.g. another disk, to restore from."""
    return await exports.add_backup(ctx, file.file)


@router.post("/backups/{name}/restore")
async def restore_backup(ctx: Ctx, history: Hist, name: str) -> BackupRestored:
    """Replace everything with this backup. Everything as it is now is backed up first.
    Refused (422, "bad_archive") if the archive is damaged: then nothing changes."""
    async with history.lock:  # no change may slip in; and nothing before can be undone after
        restored = await exports.restore_backup(ctx, name)
        history.clear()
    return restored
