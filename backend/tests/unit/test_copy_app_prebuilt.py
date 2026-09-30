"""In the desktop app the copy's app comes ready built: nothing is built on a relative's
computer, which has neither the frontend's code nor Node.js."""

from pathlib import Path

import pytest

from ancestree.exchange.copy_app import PREBUILT, copy_app

pytestmark = pytest.mark.anyio


async def test_the_ready_built_copy_app_is_used_as_it_is(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = tmp_path / "viewer.html"
    page.write_text("<!doctype html><title>the copy's app</title>", encoding="utf-8")
    monkeypatch.setenv(PREBUILT, str(page))

    # A frontend that isn't there: building from it would fail.
    assert await copy_app(tmp_path / "no-frontend-here") == page.read_text(encoding="utf-8")
