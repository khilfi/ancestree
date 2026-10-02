"""Exports and backup archives."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ExportFormat(StrEnum):
    ARCHIVE = "archive"  # everything, for backups and moving to a new PC
    GEDCOM = "gedcom"  # for other genealogy programs
    CSV = "csv"  # a spreadsheet, one row per person
    COPY = "copy"  # a view-only copy of the app with the family inside, to give


class ExportRequest(BaseModel):
    format: ExportFormat
    # For a copy:
    title: str = Field(default="", max_length=60)  # at its top, and in its file name
    hide_living: bool = False  # living people's details left out
    password: str | None = Field(default=None, min_length=6, max_length=200)  # kept nowhere
    archive: bool = True  # the full archive among its exports


class ExportFile(BaseModel):
    name: str  # also how it's downloaded
    folder: str  # where it was saved: the backup folder for an archive, else DATA_DIR/exports
    format: ExportFormat
    size: int  # bytes


class Backup(BaseModel):
    """A backup archive, from its manifest."""

    name: str
    folder: str  # where it is: the backup folder, or DATA_DIR/exports for older ones
    size: int
    made_at: datetime
    app_version: str
    people: int
    links: int
    files: int
    automatic: bool = False  # made by the daily automatic backup, kept 30 at a time


class BackupList(BaseModel):
    folder: str  # where new backups go (BACKUP_DIR)
    reachable: bool  # False when that folder's disk isn't there
    backups: list[Backup]  # newest first
    automatic_backups: bool = False  # whether one is made each day


class BackupRestored(BaseModel):
    made_at: datetime  # when the restored archive was made
    people: int
    links: int
    files: int
    backup: str  # the archive holding everything as it was just before
