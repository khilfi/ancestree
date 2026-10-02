"""Imports on disk.

DATA_DIR/imports/<when>/ keeps the file as it came, the report, and a record: who the import
added, what it changed and left out, and whether it has been taken back. A spreadsheet's is
spreadsheet.json; changes a relative's computer sent through the family folder keep
folder.json, with what it sent and base.json.gz, what it was compared with (M26). Changes from a
copy to edit, brought in before it retired, kept copy.json: still listed, and taken back
the same way. The CSV and draw.io imports of M2 keep import.json beside them, which this never
reads.
"""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from ancestree.storage.files import atomic_write, write_json

RECORD = "spreadsheet.json"
COPY_RECORD = "copy.json"  # from a copy to edit, before it retired
SENT_RECORD = "folder.json"  # from a relative's computer, through the family folder
_RECORDS = (RECORD, COPY_RECORD, SENT_RECORD)
_ID = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{1,4})?$")


def _root(data_dir: Path) -> Path:
    return data_dir / "imports"


def new_import_folder(data_dir: Path, now: datetime) -> tuple[str, Path]:
    """A new, empty folder for an import, named by when it happened; and that name."""
    base = f"{now:%Y-%m-%dT%H-%M-%S}"
    name, number = base, 1
    while (_root(data_dir) / name).exists():
        number += 1
        name = f"{base}-{number}"
    folder = _root(data_dir) / name
    folder.mkdir(parents=True)
    return name, folder


def save_import(folder: Path, record: dict[str, Any], source: bytes, report: bytes) -> None:
    atomic_write(folder / "source.csv", source)
    atomic_write(folder / "report.csv", report)
    write_json(folder / RECORD, record)  # last: a folder without it holds no import


def _record_file(folder: Path) -> Path | None:
    return next((folder / name for name in _RECORDS if (folder / name).is_file()), None)


def _folder(data_dir: Path, import_id: str) -> Path:
    if not _ID.match(import_id):
        raise KeyError(import_id)
    folder = _root(data_dir) / import_id
    if _record_file(folder) is None:
        raise KeyError(import_id)
    return folder


def read_imports(data_dir: Path) -> list[dict[str, Any]]:
    """Every import, of a spreadsheet or of a relative's changes, newest first."""
    root = _root(data_dir)
    if not root.is_dir():
        return []
    records = []
    for folder in sorted(root.iterdir(), key=lambda p: p.name, reverse=True):
        path = _record_file(folder) if _ID.match(folder.name) and folder.is_dir() else None
        if path is None:
            continue
        try:
            records.append(json.loads(path.read_text(encoding="utf-8")))
        except OSError, ValueError:
            continue  # damaged: left out of the list rather than breaking it
    return records


def _record_path(data_dir: Path, import_id: str) -> Path:
    path = _record_file(_folder(data_dir, import_id))
    if path is None:
        raise KeyError(import_id)
    return path


def read_import(data_dir: Path, import_id: str) -> dict[str, Any]:
    path = _record_path(data_dir, import_id)
    record: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return record


def update_import(data_dir: Path, import_id: str, changes: dict[str, Any]) -> None:
    path = _record_path(data_dir, import_id)
    write_json(path, read_import(data_dir, import_id) | changes)


def report_file(data_dir: Path, import_id: str) -> Path:
    return _folder(data_dir, import_id) / "report.csv"


def remove_folder(folder: Path) -> None:
    """An import folder whose import failed, before anything was kept in it."""
    if folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()


def save_sent_import(
    folder: Path, record: dict[str, Any], sent: bytes, report: bytes, base: bytes
) -> None:
    """Changes brought in from a relative's computer through the family folder: what it
    sent, as it came, the report, what it was compared with, and the record."""
    atomic_write(folder / "sent.json.gz", sent)
    atomic_write(folder / "report.csv", report)
    atomic_write(folder / "base.json.gz", base)
    write_json(folder / SENT_RECORD, record)  # last: a folder without it holds no import
