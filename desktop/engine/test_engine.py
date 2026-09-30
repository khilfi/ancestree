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
