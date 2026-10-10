"""Backups that know their family (0.4.0): of several families on one computer, one family's
backup can't be restored into another."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ancestree.config import WhichFamily
from ancestree.exchange.backup import write_archive
from ancestree.exchange.restore import read_info
from ancestree.services.context import Context, RuleError
from ancestree.services.exports import ours

FATHERS = WhichFamily("3f9c0a1b2c3d4e5f", "Keluarga Contoh")
MOTHERS = WhichFamily("0a1b2c3d4e5f6a7b", "Keluarga Ibu")


def graph() -> dict[str, Any]:
    return {
        "schema_version": 9,
        "people": [{"id": "00000000-0000-4000-8000-000000000001", "full_name": "Hassan"}],
        "links": [],
        "relationship_kinds": [],
    }


def context(tmp_path: Path, family: WhichFamily | None) -> Context:
    return Context(None, "neo4j", tmp_path / "data", family=family)  # type: ignore[arg-type]


def test_a_backup_names_its_family(tmp_path: Path) -> None:
    made = write_archive(graph(), tmp_path / "data", tmp_path / "backups", family=FATHERS)
    info = read_info(made.path)
    assert (info.family_id, info.family_name) == (FATHERS.id, "Keluarga Contoh")
    plain = read_info(write_archive(graph(), tmp_path / "data", tmp_path / "older").path)
    assert (plain.family_id, plain.family_name) == (None, "")  # as before 0.4.0


def test_another_familys_backup_is_refused(tmp_path: Path) -> None:
    fathers = read_info(
        write_archive(graph(), tmp_path / "data", tmp_path / "backups", family=FATHERS).path
    )
    ours(context(tmp_path, FATHERS), fathers)  # its own: fine
    with pytest.raises(RuleError) as refused:
        ours(context(tmp_path, MOTHERS), fathers)
    assert refused.value.code == "other_family"
    assert "Keluarga Contoh, not Keluarga Ibu" in refused.value.message
    assert refused.value.details == {"family": "Keluarga Contoh"}


def test_a_backup_from_before_0_4_0_or_outside_the_desktop_app_is_let_through(
    tmp_path: Path,
) -> None:
    older = read_info(write_archive(graph(), tmp_path / "data", tmp_path / "older").path)
    ours(context(tmp_path, MOTHERS), older)  # names no family: the app asks to check it
    fathers = read_info(
        write_archive(graph(), tmp_path / "data", tmp_path / "backups", family=FATHERS).path
    )
    ours(context(tmp_path, None), fathers)  # one family alone, as in development


def _crafted(path: Path, manifest: dict[str, Any], files: dict[str, bytes] | None = None) -> Path:
    """An archive made by hand, as someone could send one: not by AncesTree."""
    import json
    from zipfile import ZIP_DEFLATED, ZipFile

    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, data in (files or {}).items():
            archive.writestr(name, data)
    return path


MANIFEST = {
    "format": 1,
    "app_version": "0.4.0",
    "schema_version": 1,
    "created_at": "2026-10-01T09:00:00+00:00",
    "counts": {"people": 0},
    "sha256": {},
}


@pytest.mark.parametrize("family_id", ["../../Documents", "C:/Windows", "..", "0123456789ABCDEF"])
def test_a_backup_naming_its_family_otherwise_names_none(tmp_path: Path, family_id: str) -> None:
    """A family's id names its folder: one that isn't 16 hex digits is never read as one."""
    made = {**MANIFEST, "family": {"id": family_id, "name": "Not ours"}}
    info = read_info(_crafted(tmp_path / "crafted.zip", made))
    assert info.family_id is None


def test_a_backup_made_to_fill_the_disk_is_refused_unread(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A "zip bomb": a file that unpacks to far more than any family's is refused by its size,
    before anything of it is written."""
    from ancestree.exchange import restore

    monkeypatch.setattr(restore, "MOST_GRAPH", 1024 * 1024)
    made = {**MANIFEST, "sha256": {"graph.json": "0" * 64}}
    path = _crafted(tmp_path / "bomb.zip", made, {"graph.json": bytes(2 * 1024 * 1024)})
    staging = tmp_path / "staging"
    staging.mkdir()
    with pytest.raises(restore.ArchiveError, match="larger than any"):
        restore._stage(path, staging)
    assert not any(staging.iterdir())
