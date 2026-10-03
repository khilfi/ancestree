import asyncio
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, status
from fastapi.responses import FileResponse

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.exports import (
    Backup,
    BackupChecked,
    BackupList,
    BackupRestored,
    CopyPlace,
    ElsewhereChoice,
    ExportFile,
    ExportRequest,
)
from ancestree.exchange.copies import CopyOptions
from ancestree.services import elsewhere, exports

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
    ctx: Ctx,
    file: Annotated[UploadFile, File(description="An AncesTree backup archive (.zip)")],
    password: Annotated[str | None, Form(max_length=200)] = None,
) -> Backup:
    """Bring in a backup archive from elsewhere, e.g. another disk, to restore from. A copy
    locked with a password (0.4.0) is opened with `password`."""
    return await exports.add_backup(ctx, file.file, password)


@router.get("/backups/places")
async def places_for_copies() -> list[CopyPlace]:
    """Places on this computer that suit copies of the backups (0.4.0): other disks, and the
    folders OneDrive, Dropbox and Google Drive's own app keep."""
    return await asyncio.to_thread(elsewhere.places)


@router.put("/backups/elsewhere")
async def copy_backups_elsewhere(ctx: Ctx, body: ElsewhereChoice) -> BackupList:
    """Copy every backup to a second place from now on, locked with a password if one is given,
    which is kept nowhere (0.4.0). The copies not there yet are made at once."""
    await asyncio.to_thread(elsewhere.choose, ctx, body.folder, body.password or None)
    return await exports.copy_elsewhere(ctx)


@router.post("/backups/elsewhere/copy")
async def copy_backups_now(ctx: Ctx) -> BackupList:
    """Make the copies not made yet in the second place, now (0.4.0)."""
    return await exports.copy_elsewhere(ctx)


@router.delete("/backups/elsewhere")
async def stop_copying_backups(ctx: Ctx) -> BackupList:
    """No more copies in the second place; those made there stay (0.4.0)."""
    await asyncio.to_thread(elsewhere.stop, ctx)
    return await exports.list_backups(ctx)


@router.post("/backups/{name}/check")
async def check_backup(ctx: Ctx, name: str) -> BackupChecked:
    """Read a backup whole, every file against its checksum, restoring nothing (0.4.0).
    Refused (422, "bad_archive") if it's damaged."""
    return await exports.check_backup(ctx, name)


@router.post("/backups/{name}/restore")
async def restore_backup(ctx: Ctx, history: Hist, name: str) -> BackupRestored:
    """Replace everything with this backup. Everything as it is now is backed up first.
    Refused (422, "bad_archive") if the archive is damaged: then nothing changes."""
    async with history.lock:  # no change may slip in; and nothing before can be undone after
        restored = await exports.restore_backup(ctx, name)
        history.clear()
    return restored
