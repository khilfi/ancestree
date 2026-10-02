"""The family through the family folder: the keeper's family as entries, and a relative's
computer restoring it, with a real database. The made-up family, with a photo and a story."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.exchange.restore import restore_archive
from ancestree.familyfolder.entries import build_archive, family_entries
from ancestree.migrations.runner import apply_migrations
from ancestree.repo.export import export_graph
from ancestree.seed.loader import load_seed
from ancestree.services.context import Context

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


def _plain(graph: dict[str, Any]) -> dict[str, Any]:
    def text(value: object) -> str:
        return str(value.iso_format())  # type: ignore[attr-defined]

    found: dict[str, Any] = json.loads(json.dumps(graph, default=text))
    return found


async def test_a_relatives_computer_restores_the_family_as_the_keeper_has_it(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    await apply_migrations(driver, settings.neo4j_database)
    await load_seed(driver, settings.neo4j_database)
    keeper_dir = settings.data_dir
    graph = await export_graph(driver, settings.neo4j_database)
    someone = graph["people"][0]["id"]
    folder = keeper_dir / "people" / someone
    (folder / "photos").mkdir(parents=True)
    (folder / "photos" / "portrait.jpg").write_bytes(b"\xff\xd8 a made-up photo")
    (folder / "biography.md").write_text("# A made-up story\n", encoding="utf-8")
    (keeper_dir / "settings").mkdir(parents=True, exist_ok=True)
    (keeper_dir / "settings" / "app.json").write_text(
        json.dumps(
            {
                "kinship": {"language": "ms", "titles": ["long", "ngah", "chik"], "youngest": "su"},
                "places": {"pins": []},
                "me": {"person": someone},
            }
        ),
        encoding="utf-8",
    )

    blobs: dict[str, bytes] = {}

    def store(data: bytes) -> str:
        name = hashlib.sha256(data).hexdigest()[:32]
        blobs[name] = data
        return name

    named: dict[str, tuple[int, int, str, str]] = {}
    entries = family_entries(graph, keeper_dir, "Keluarga Contoh", store, named)
    assert entries["setting/kinship"] == {"titles": ["long", "ngah", "chik"], "youngest": "su"}
    assert "me" not in json.dumps(entries["setting/kinship"])  # "Me" stays on each computer
    stored = len(blobs)
    family_entries(graph, keeper_dir, "Keluarga Contoh", store, named)
    assert len(blobs) == stored  # unchanged files aren't read or stored again

    # The relative's computer: its own data folder, its own choices, the database emptied.
    relative_dir = tmp_path / "relative"
    (relative_dir / "settings").mkdir(parents=True)
    (relative_dir / "settings" / "app.json").write_text(
        json.dumps({"kinship": {"language": "jv"}, "tree": {"colours": "generation"}}),
        encoding="utf-8",
    )
    await driver.execute_query(
        "MATCH (n) WHERE n:Person OR n:RelationshipKind DETACH DELETE n",
        database_=settings.neo4j_database,
    )
    tomb = relative_dir / "trash" / "2026-10-03T10-00-00_someone" / "tombstone.json"
    tomb.parent.mkdir(parents=True)
    tomb.write_text('{"format": 1}', encoding="utf-8")  # someone this computer deleted
    received = tmp_path / "received"
    received.mkdir()
    archive = build_archive(entries, blobs.get, relative_dir, received, keep_trash=True)
    assert archive is not None
    ctx = Context(driver, settings.neo4j_database, relative_dir)
    restored = await restore_archive(ctx, archive, backup_first=False)

    assert restored.backup == ""
    assert not (relative_dir / "exports").exists()  # no backup made before it
    again = await export_graph(driver, settings.neo4j_database)
    assert _plain(again) == _plain(graph)
    here = relative_dir / "people" / someone
    assert (here / "photos" / "portrait.jpg").read_bytes() == b"\xff\xd8 a made-up photo"
    assert (here / "biography.md").read_text(encoding="utf-8") == "# A made-up story\n"
    kept = json.loads((relative_dir / "settings" / "app.json").read_text(encoding="utf-8"))
    assert kept["kinship"] == {
        "language": "jv",
        "titles": ["long", "ngah", "chik"],
        "youngest": "su",
    }
    assert kept["tree"] == {"colours": "generation"}
    assert "me" not in kept  # the keeper's "Me" never travels
    assert tomb.read_text(encoding="utf-8") == '{"format": 1}'  # its own Trash stays (0.3.1)


def test_an_archive_waits_for_every_file(tmp_path: Path) -> None:
    entries: dict[str, dict[str, Any]] = {
        "schema": {"version": 9},
        "file/people/x/photo.jpg": {
            "size": 3,
            "sha256": hashlib.sha256(b"abc").hexdigest(),
            "blob": "b1",
        },
    }
    assert build_archive(entries, lambda name: None, tmp_path, tmp_path) is None
    assert list(tmp_path.iterdir()) == []  # nothing left behind
