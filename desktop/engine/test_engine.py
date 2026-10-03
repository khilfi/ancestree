"""The engine's side of updates: what the shell tells it, and what the app's pages may
ask. From backend/:   uv run pytest ../desktop/engine
"""

# ruff: noqa: S101

import importlib.util
import io
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

_spec = importlib.util.spec_from_file_location("engine", Path(__file__).with_name("engine.py"))
assert _spec
assert _spec.loader
engine = importlib.util.module_from_spec(_spec)
sys.modules["engine"] = engine
_spec.loader.exec_module(engine)

pytestmark = pytest.mark.anyio


def said(capsys: pytest.CaptureFixture[str]) -> list[str]:
    """The stages the engine told the shell, one JSON line each."""
    return [json.loads(line)["stage"] for line in capsys.readouterr().out.splitlines()]


def test_the_shell_s_lines_about_new_versions() -> None:
    updates = engine.Updates("0.1.0")
    assert updates.state()["available"] is None

    updates.hear('update {"version": "0.2.0", "notes": "The map shows towns."}')
    assert updates.state()["available"] == {"version": "0.2.0", "notes": "The map shows towns."}
    assert updates.state()["checked_at"]

    updates.hear("update-failed no answer from the repository")
    assert updates.state()["problem"] == "no answer from the repository"
    updates.hear("update-none")
    assert updates.state()["problem"] is None


def test_what_the_shell_never_writes_is_ignored() -> None:
    updates = engine.Updates("0.1.0")
    for line in ("update {not json", 'update {"notes": "no version"}', "hello", ""):
        updates.hear(line)
    assert updates.state() == engine.Updates("0.1.0").state()


def app_with(updates: object) -> httpx.AsyncClient:
    app = FastAPI()
    engine.add_desktop_routes(app, Path("."), {"app": "0.1.0"}, updates)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_the_pages_ask_the_shell_to_look_once_at_a_time(
    capsys: pytest.CaptureFixture[str],
) -> None:
    updates = engine.Updates("0.1.0")
    async with app_with(updates) as pages:
        first = await pages.post("/api/desktop/update/check")
        again = await pages.post("/api/desktop/update/check")
        assert first.json()["checking"] is True
        assert again.json()["checking"] is True
        assert said(capsys) == ["check-updates"]  # asked once, not twice

        updates.hear("update-none")
        state = (await pages.get("/api/desktop/update")).json()
        assert state == {
            "current": "0.1.0",
            "available": None,
            "checking": False,
            "checked_at": state["checked_at"],
            "problem": None,
        }


async def test_restarting_needs_a_new_version(capsys: pytest.CaptureFixture[str]) -> None:
    updates = engine.Updates("0.1.0")
    async with app_with(updates) as pages:
        refused = await pages.post("/api/desktop/update/restart")
        assert refused.status_code == 409
        assert refused.json()["detail"]["code"] == "no_update"
        assert said(capsys) == []

        updates.hear('update {"version": "0.2.0", "notes": ""}')
        started = await pages.post("/api/desktop/update/restart")
        assert started.status_code == 200
        assert said(capsys) == ["restart-to-update"]


def test_stop_still_stops_among_the_shell_s_lines(monkeypatch: pytest.MonkeyPatch) -> None:
    updates = engine.Updates("0.1.0")
    stop = engine.Stop()
    monkeypatch.setattr(
        sys, "stdin", io.StringIO('update {"version": "0.2.0"}\nstop\nupdate-failed later\n')
    )
    stop.watch(updates)
    assert stop.asked.is_set()
    assert updates.state()["available"] == {"version": "0.2.0", "notes": ""}
    assert updates.state()["problem"] is None  # nothing after "stop" is read


# Several families on one computer (0.4.0)


def families_app(root: Path, external: bool = False) -> tuple[httpx.AsyncClient, object]:
    families = engine.Families.load(root, "Keluarga Contoh")
    app = FastAPI()
    engine.add_family_routes(app, families, families.open, external=external)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    return client, families


async def test_families_are_added_renamed_removed_and_put_back(tmp_path: Path) -> None:
    pages, _ = families_app(tmp_path)
    async with pages:
        listed = (await pages.get("/api/desktop/families")).json()
        assert [family["name"] for family in listed["families"]] == ["Keluarga Contoh"]
        assert listed["single"] is False

        added = (await pages.post("/api/desktop/families", json={"name": "Keluarga Ibu"})).json()
        mothers = added["added"]
        assert [family["name"] for family in added["families"]] == [
            "Keluarga Contoh",
            "Keluarga Ibu",
        ]
        renamed = await pages.patch(f"/api/desktop/families/{mothers}", json={"name": "Ibu"})
        assert [family["name"] for family in renamed.json()["families"]][1] == "Ibu"

        open_one = listed["open"]
        refused = await pages.delete(f"/api/desktop/families/{open_one}")
        assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "family_open")
        removed = (await pages.delete(f"/api/desktop/families/{mothers}")).json()
        assert [family["name"] for family in removed["removed"]] == ["Ibu"]
        back = await pages.post(f"/api/desktop/families/removed/{mothers}/put-back")
        assert [family["name"] for family in back.json()["families"]][1] == "Ibu"

        missing = await pages.patch("/api/desktop/families/0000000000000000", json={"name": "X"})
        assert missing.status_code == 404


async def test_opening_another_family_asks_the_shell_to_start_again_on_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    pages, _ = families_app(tmp_path)
    async with pages:
        added = (await pages.post("/api/desktop/families", json={"name": "Keluarga Ibu"})).json()
        said(capsys)
        opening = (await pages.post(f"/api/desktop/families/{added['added']}/open")).json()
        assert opening["opening"] == "Keluarga Ibu"
        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
        assert [(line["stage"], line["family"]) for line in lines] == [("restart", "Keluarga Ibu")]
        assert engine.Families.load(tmp_path).open.id == added["added"]  # opened at the start


async def test_a_family_from_a_backup_keeps_its_id_and_is_restored_as_it_opens(
    tmp_path: Path,
) -> None:
    from ancestree.config import WhichFamily
    from ancestree.exchange.backup import write_archive

    graph = {"schema_version": 9, "people": [], "links": [], "relationship_kinds": []}
    family = WhichFamily("3f9c0a1b2c3d4e5f", "Keluarga Ibu")
    archive = write_archive(graph, tmp_path / "elsewhere", tmp_path / "made", family=family).path
    pages, _ = families_app(tmp_path / "app")
    async with pages:
        with archive.open("rb") as file:
            added = await pages.post(
                "/api/desktop/families/from-backup", files={"file": (archive.name, file)}
            )
        assert added.json()["added"] == "3f9c0a1b2c3d4e5f"
        again = engine.Families.load(tmp_path / "app")
        restored = again.get("3f9c0a1b2c3d4e5f")
        assert restored.name == "Keluarga Ibu"
        assert (again.places(restored).backups / restored.restore).is_file()

        with archive.open("rb") as file:
            twice = await pages.post(
                "/api/desktop/families/from-backup", files={"file": (archive.name, file)}
            )
        assert twice.json()["detail"]["code"] == "family_here"
        junk = await pages.post(
            "/api/desktop/families/from-backup", files={"file": ("x.zip", b"not a zip")}
        )
        assert (junk.status_code, junk.json()["detail"]["code"]) == (422, "bad_archive")


async def test_a_database_of_ones_own_keeps_one_family(tmp_path: Path) -> None:
    pages, _ = families_app(tmp_path, external=True)
    async with pages:
        assert (await pages.get("/api/desktop/families")).json()["single"] is True
        refused = await pages.post("/api/desktop/families", json={"name": "Keluarga Ibu"})
        assert refused.json()["detail"]["code"] == "one_database"


def test_the_first_family_is_named_after_its_family_folder(tmp_path: Path) -> None:
    assert engine.first_name(tmp_path) == "My family"
    setup = tmp_path / "family" / "familyfolder" / "setup.json"
    setup.parent.mkdir(parents=True)
    setup.write_text(json.dumps({"family": "Keluarga Contoh"}), encoding="utf-8")
    assert engine.first_name(tmp_path) == "Keluarga Contoh"


def test_the_shell_s_sync_now_reaches_the_family_folder(monkeypatch: pytest.MonkeyPatch) -> None:
    asked: list[str] = []

    class Folder:
        def sync_soon(self) -> None:
            asked.append("sync")

    stop = engine.Stop()
    stop.app = FastAPI()
    stop.app.state.family_folder = Folder()
    monkeypatch.setattr(sys, "stdin", io.StringIO("sync\nstop\n"))
    stop.watch(engine.Updates("0.1.0"))
    assert asked == ["sync"]


def test_the_icon_by_the_clock_says_how_the_family_stands() -> None:
    from datetime import UTC, datetime
    from types import SimpleNamespace

    now = datetime.now(UTC)
    folder = SimpleNamespace(
        setup=object(), last_sync=now, syncing=False, went_through=True, drive=object()
    )
    line = engine.in_step_line(folder, "Keluarga Contoh")
    assert line.startswith("AncesTree · Keluarga Contoh · in step at ")
    assert len(line) <= 127  # Windows shows no more
    folder.syncing = True
    assert engine.in_step_line(folder, "Keluarga Contoh").endswith("keeping in step…")
    folder.syncing, folder.went_through = False, False
    assert "not in step since" in engine.in_step_line(folder, "Keluarga Contoh")
    folder.drive = None
    assert engine.in_step_line(folder, "Keluarga Contoh").endswith("sign in to Google, in Settings")
    folder.setup = None
    assert engine.in_step_line(folder, "A" * 200) == "AncesTree · " + "A" * 40
