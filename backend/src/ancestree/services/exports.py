"""Exports in DATA_DIR/exports, and backup archives in the backup folder.

The backup folder is BACKUP_DIR, best on another disk; unset, backups stay in
DATA_DIR/exports. Backups made there before BACKUP_DIR was set are still listed.
"""

import asyncio
import hashlib
import re
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from ancestree.domain.exports import (
    Backup,
    BackupChecked,
    BackupList,
    BackupRestored,
    ExportFile,
    ExportFormat,
)
from ancestree.exchange.backup import create_backup, is_automatic, unused_path
from ancestree.exchange.copies import CopyOptions, make_copy
from ancestree.exchange.copy_app import CopyAppError, copy_app
from ancestree.exchange.family import load_family
from ancestree.exchange.gedcom import write_gedcom
from ancestree.exchange.locked import MAGIC, LockedError, key_for, unlock
from ancestree.exchange.restore import (
    ArchiveError,
    ArchiveInfo,
    check_archive,
    read_info,
    restore_archive,
)
from ancestree.exchange.spreadsheet import ENCODING, write_people_csv
from ancestree.services import elsewhere
from ancestree.services.context import Context, NotFoundError, RuleError
from ancestree.storage.files import atomic_write

EXPORTS = "exports"
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(zip|ged|csv|html)$")


def exports_dir(ctx: Context) -> Path:
    return ctx.data_dir / EXPORTS


def _folders(ctx: Context) -> list[Path]:
    """Where exports and backups may be: the backup folder first."""
    return list(dict.fromkeys([ctx.backups, exports_dir(ctx)]))


def _unreachable(ctx: Context, error: OSError) -> RuleError:
    return RuleError(
        "backup_folder",
        f"The backup folder {ctx.backups} can't be reached ({error.strerror or error}). "
        "Is its disk connected?",
    )


def _slug(title: str) -> str:
    """ "Keluarga Contoh" -> "keluarga-contoh", for a file name; "" when nothing's left."""
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]


def _copy_name(options: CopyOptions) -> str:
    """ "ancestree-keluarga-contoh-2026-09-29.html"."""
    parts = ["ancestree", _slug(options.title), date.today().isoformat()]
    return "-".join(part for part in parts if part) + ".html"


async def _copy(ctx: Context, folder: Path, options: CopyOptions) -> Path:
    try:
        app = await copy_app()
    except CopyAppError as error:
        raise RuleError("copy_app", str(error)) from error
    made = await make_copy(ctx, app, options)
    path = unused_path(folder / _copy_name(options))
    await asyncio.to_thread(atomic_write, path, made.encode("utf-8"))
    return path


async def make_export(
    ctx: Context,
    export_format: ExportFormat,
    folder: Path | None = None,
    copy: CopyOptions | None = None,
) -> ExportFile:
    """Write an export: an archive to the backup folder, anything else to DATA_DIR/exports,
    unless `folder` is given. A copy follows `copy`'s choices."""
    if export_format is ExportFormat.ARCHIVE:
        try:
            backup = await create_backup(
                ctx.driver, ctx.database, ctx.data_dir, folder or ctx.backups, ctx.family
            )
        except OSError as error:
            raise _unreachable(ctx, error) from error
        path = backup.path
        if folder is None:  # a backup: copied elsewhere too, if a place is chosen (0.4.0)
            await asyncio.to_thread(elsewhere.catch_up, ctx)
    elif export_format is ExportFormat.COPY:
        path = await _copy(ctx, folder or exports_dir(ctx), copy or CopyOptions())
    else:
        folder = folder or exports_dir(ctx)
        now = datetime.now().astimezone()
        family = await load_family(ctx)
        if export_format is ExportFormat.GEDCOM:
            path = unused_path(folder / f"ancestree-{now:%Y-%m-%dT%H-%M-%S}.ged")
            data = write_gedcom(family, made_at=now, file_name=path.name).encode("utf-8")
        else:
            path = unused_path(folder / f"ancestree-people-{now:%Y-%m-%dT%H-%M-%S}.csv")
            data = write_people_csv(family).encode(ENCODING)
        await asyncio.to_thread(atomic_write, path, data)
    return ExportFile(
        name=path.name, folder=str(path.parent), format=export_format, size=path.stat().st_size
    )


def export_path(ctx: Context, name: str) -> Path:
    """An export or backup, by name; nothing outside their folders."""
    if _NAME.match(name):
        for folder in _folders(ctx):
            if (folder / name).is_file():
                return folder / name
    raise NotFoundError("There's no such export.")


def _backup(path: Path) -> Backup:
    info = read_info(path)
    return Backup(
        name=path.name,
        folder=str(path.parent),
        size=path.stat().st_size,
        made_at=info.made_at,
        app_version=info.app_version,
        people=info.people,
        links=info.links,
        files=info.files,
        automatic=is_automatic(path.name),
        family_id=info.family_id,
        family_name=info.family_name,
    )


def ours(ctx: Context, info: ArchiveInfo) -> None:
    """Refuse another family's backup (0.4.0): one family's can't be restored into another,
    of several on the computer. One made before 0.4.0 names no family, so it's let through,
    and the app asks to check it."""
    family = ctx.family
    if family is None or info.family_id is None or info.family_id == family.id:
        return
    raise RuleError(
        "other_family",
        f"That backup is of {info.family_name or 'another family'}, not {family.name}. To "
        "bring it back, open that family, or add it as a family of its own: Settings → "
        "Families.",
        family=info.family_name,
    )


def _backups(ctx: Context) -> BackupList:
    found: list[Backup] = []
    for folder in _folders(ctx):
        try:
            paths = sorted(folder.glob("*.zip")) if folder.is_dir() else []
        except OSError:
            continue
        for path in paths:
            try:
                found.append(_backup(path))
            except ArchiveError:
                continue  # some other zip file: not a backup
    try:
        ctx.backups.mkdir(parents=True, exist_ok=True)
        reachable = True
    except OSError:
        reachable = False
    return BackupList(
        folder=str(ctx.backups),
        reachable=reachable,
        backups=sorted(found, key=lambda backup: backup.made_at, reverse=True),
        automatic_backups=ctx.automatic_backups,
        family_id=ctx.family.id if ctx.family else None,
        family_name=ctx.family.name if ctx.family else "",
        elsewhere=elsewhere.status(ctx),
    )


async def list_backups(ctx: Context) -> BackupList:
    """The backups, newest first, and whether the backup folder can be reached."""
    return await asyncio.to_thread(_backups, ctx)


def _sha256(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def _keep(ctx: Context, upload: BinaryIO, folder: Path, password: str | None = None) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    partial = folder / f".upload-{uuid4().hex}.partial"
    opened = folder / f".upload-{uuid4().hex}.opened"
    try:
        with partial.open("wb") as out:
            shutil.copyfileobj(upload, out, 1 << 20)
        with partial.open("rb") as start:
            locked = start.read(len(MAGIC)) == MAGIC
        if locked:  # a copy kept elsewhere, locked with a password (0.4.0)
            if not password:
                raise RuleError(
                    "locked_backup", "That backup is locked: type the password it was locked with."
                )
            try:
                unlock(partial, opened, key_for(partial, password))
            except LockedError as error:
                raise RuleError("not_unlocked", str(error)) from error
            opened.replace(partial)
        info = read_info(partial)  # refuses anything but a backup archive
        ours(ctx, info)
        made_at = info.made_at
        name = folder / f"ancestree-backup-{made_at:%Y-%m-%dT%H-%M-%S}.zip"
        if name.exists() and _sha256(name) == _sha256(partial):
            return name  # already here: no second copy
        final = unused_path(name)
        partial.replace(final)
        return final
    finally:
        partial.unlink(missing_ok=True)
        opened.unlink(missing_ok=True)


async def add_backup(ctx: Context, upload: BinaryIO, password: str | None = None) -> Backup:
    """A backup archive from elsewhere, e.g. another PC, kept with the others so it can be
    restored. Its name says when it was made. One locked with a password, as copies kept
    elsewhere can be (0.4.0), is opened with it first."""
    try:
        path = await asyncio.to_thread(_keep, ctx, upload, ctx.backups, password)
    except OSError as error:
        raise _unreachable(ctx, error) from error
    return await asyncio.to_thread(_backup, path)


async def check_backup(ctx: Context, name: str) -> BackupChecked:
    """A backup read whole, every file against its checksum, with nothing restored (0.4.0)."""
    path = export_path(ctx, name)
    if path.suffix != ".zip":
        raise NotFoundError("There's no such backup.")
    info = await asyncio.to_thread(check_archive, path)
    return BackupChecked(name=path.name, people=info.people, links=info.links, files=info.files)


async def copy_elsewhere(ctx: Context) -> BackupList:
    """Copies of the backups not copied yet, in the second place chosen, now (0.4.0)."""
    await asyncio.to_thread(elsewhere.catch_up, ctx)
    return await list_backups(ctx)


async def restore_backup(ctx: Context, name: str) -> BackupRestored:
    """Replace everything with a backup; everything as it is now is backed up first."""
    path = export_path(ctx, name)
    if path.suffix != ".zip":
        raise NotFoundError("There's no such backup.")
    ours(ctx, await asyncio.to_thread(read_info, path))
    return await restore_archive(ctx, path)
