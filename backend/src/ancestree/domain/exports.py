"""Exports and backup archives."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints


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
    # Which family it's of, of several on the computer (0.4.0); none before 0.4.0.
    family_id: str | None = None
    family_name: str = ""


class Elsewhere(BaseModel):
    """The second place a family's backups are copied to (0.4.0), and how its copies stand."""

    folder: str  # the place, as chosen
    inside: str  # the family's own folder there
    locked: bool  # copies locked with a password
    reachable: bool  # False while its disk isn't there
    copies: int  # copies there now
    waiting: int  # backups here not copied there yet
    copied: datetime | None  # when a copy was last made there
    problem: str  # why the last copy couldn't be made; empty if it could


class CopyPlace(BaseModel):
    """A place on this computer that suits copies of backups: a disk, or a cloud's folder."""

    path: str
    kind: Literal["disk", "cloud"]
    name: str


class ElsewhereChoice(BaseModel):
    folder: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    # None: copies unlocked. Otherwise the password they're locked with, kept nowhere.
    password: Annotated[str, StringConstraints(max_length=200)] | None = None


class BackupChecked(BaseModel):
    """A backup read whole, every file against its checksum, with nothing restored."""

    name: str
    people: int
    links: int
    files: int


class BackupList(BaseModel):
    folder: str  # where new backups go (BACKUP_DIR)
    reachable: bool  # False when that folder's disk isn't there
    backups: list[Backup]  # newest first
    automatic_backups: bool = False  # whether one is made each day
    # The family that's open, of several on the computer (0.4.0); none outside the desktop app.
    family_id: str | None = None
    family_name: str = ""
    elsewhere: Elsewhere | None = None  # the second place copies go, if one's chosen (0.4.0)


class BackupRestored(BaseModel):
    made_at: datetime  # when the restored archive was made
    people: int
    links: int
    files: int
    backup: str  # the archive holding everything as it was just before
