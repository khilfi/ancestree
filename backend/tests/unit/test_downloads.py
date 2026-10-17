"""Downloads that say where they went: the Downloads folder as
each system has it, a name never written over, and Show in folder as each system's file manager
does it, with a stand-in for starting it. Made-up folders only: nothing here opens a window."""

import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any

import pytest

from ancestree.desktop import downloads
from ancestree.desktop.downloads import free_name, plain_name, save


def test_only_names_as_ancestree_gives_them() -> None:
    for name in (
        "ancestree-import-template.csv",
        "ancestree-import-example.csv",
        "ancestree-backup-2026-10-17T09-00-00-automatic.zip",
        "ancestree-keluarga-contoh-2026-10-17.html",
        "ancestree-tree-2026-10-17.png",
        "ancestree-import-1f0c2a.csv",
    ):
        assert plain_name(name), name
    for name in (
        "../ancestree-import-template.csv",
        "folder/ancestree.csv",
        "folder\\ancestree.csv",
        ".hidden.csv",
        "ancestree.exe",
        "ancestree.csv ",
        "",
    ):
        assert not plain_name(name), name


def test_a_name_taken_gets_a_number_as_the_window_gives_it(tmp_path: Path) -> None:
    first = save(tmp_path, "ancestree-import-template.csv", b"first")
    second = save(tmp_path, "ancestree-import-template.csv", b"second")
    third = save(tmp_path, "ancestree-import-template.csv", b"third")
    assert [first.name, second.name, third.name] == [
        "ancestree-import-template.csv",
        "ancestree-import-template (2).csv",
        "ancestree-import-template (3).csv",
    ]
    assert first.read_bytes() == b"first"  # never written over
    assert free_name(tmp_path, "other.csv") == tmp_path / "other.csv"
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(
        [first.name, second.name, third.name]
    )  # nothing half-written left


def test_a_file_is_copied_whole_and_a_folder_made(tmp_path: Path) -> None:
    source = tmp_path / "ancestree-backup-2026-10-17T09-00-00.zip"
    source.write_bytes(b"a made-up archive" * 1000)
    saved = save(tmp_path / "Downloads", source.name, source)
    assert saved == tmp_path / "Downloads" / source.name
    assert saved.read_bytes() == source.read_bytes()
    with pytest.raises(ValueError, match="Not a name"):
        save(tmp_path, "../elsewhere.csv", b"no")


def test_linux_finds_the_desktops_own_downloads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: PurePosixPath("/home/aminah"))
    (tmp_path / "user-dirs.dirs").write_text(
        '# written by xdg-user-dirs-update\nXDG_DESKTOP_DIR="$HOME/Desktop"\n'
        'XDG_DOWNLOAD_DIR="$HOME/Muat turun"\n',
        encoding="utf-8",
    )
    assert downloads._xdg_downloads() == Path("/home/aminah/Muat turun")  # as Linux reads it
    (tmp_path / "user-dirs.dirs").write_text("nothing here\n", encoding="utf-8")
    assert downloads._xdg_downloads() is None
    monkeypatch.setattr(sys, "platform", "linux")
    assert str(downloads.downloads_folder()) == "/home/aminah/Downloads"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows' known folders")
def test_windows_finds_downloads_wherever_its_been_moved() -> None:
    found = downloads._windows_downloads()
    assert found is not None
    assert found.is_absolute()


class Started:
    """subprocess, as Show in folder starts the file manager: what it was asked to run."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, answer: int = 0) -> None:
        self.runs: list[list[str]] = []
        self.answer = answer
        monkeypatch.setattr(subprocess, "Popen", self.popen)
        monkeypatch.setattr(subprocess, "run", self.run)

    def popen(self, command: list[Any], **_: Any) -> None:
        self.runs.append([str(part) for part in command])

    def run(self, command: list[Any], **_: Any) -> subprocess.CompletedProcess[bytes]:
        self.runs.append([str(part) for part in command])
        return subprocess.CompletedProcess(command, self.answer)


@pytest.mark.parametrize(
    ("platform", "first"),
    [("win32", "explorer.exe"), ("darwin", "/usr/bin/open"), ("linux", "gdbus")],
)
def test_show_in_folder_chooses_the_file_in_each_systems_file_manager(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, platform: str, first: str
) -> None:
    started = Started(monkeypatch)
    monkeypatch.setattr(sys, "platform", platform)
    path = tmp_path / "Downloads" / "ancestree-import-template.csv"

    downloads.show(path)

    [command] = started.runs
    assert command[0].endswith(first)
    if platform == "win32":
        assert command[1] == f"/select,{path}"
    elif platform == "darwin":
        assert command[1:] == ["-R", str(path)]
    else:
        assert "org.freedesktop.FileManager1.ShowItems" in command
        assert f"['{path.as_uri()}']" in command


def test_linux_without_a_file_manager_to_ask_opens_the_folder(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    started = Started(monkeypatch, answer=1)
    monkeypatch.setattr(sys, "platform", "linux")
    path = tmp_path / "Downloads" / "ancestree-import-template.csv"
    downloads.show(path)
    assert started.runs[-1] == ["xdg-open", str(path.parent)]
