"""The copy's app, built for a copy when AncesTree runs from its code."""

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from ancestree.exchange import copy_app


def test_the_build_has_an_input_of_its_own(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The engine waits on its input for the shell's word (sync, stop). On Windows, Node given
    that same input waited at its start for as long, so a copy never came (0.4.1)."""
    vite = tmp_path / "node_modules" / "vite" / "bin" / "vite.js"
    vite.parent.mkdir(parents=True)
    vite.write_text("")
    asked: dict[str, Any] = {}

    def run(command: list[str], **options: Any) -> subprocess.CompletedProcess[str]:
        asked.update(options, command=command)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(shutil, "which", lambda _: "node")
    monkeypatch.setattr(subprocess, "run", run)
    copy_app._build(tmp_path)

    assert asked["command"][-3:] == ["build", "--mode", "viewer"]
    assert asked["stdin"] is subprocess.DEVNULL
