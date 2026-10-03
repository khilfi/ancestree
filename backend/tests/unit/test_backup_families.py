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
