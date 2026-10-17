"""The system's bin: a file sent there leaves its folder and
can be put back. Linux's Trash is checked anywhere, in a made-up home's; on Windows, a disk with
no Recycle Bin keeps the file. The real bins, Windows' Recycle Bin, the Mac's Bin and Linux's
Trash, only with ANCESTREE_TEST_SYSTEM_BIN=1, as GitHub's Desktop app workflow sets on each of
its machines: never on a computer of the family's (the user's word of 17 Oct 2026)."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

import pytest

from ancestree.storage import system_bin
from ancestree.storage.system_bin import BinError, bin_name, to_bin


@pytest.mark.parametrize(
    ("platform", "name"),
    [("win32", "Recycle Bin"), ("darwin", "Bin"), ("linux", "Trash"), ("freebsd14", "Trash")],
)
def test_each_system_names_its_bin(
    monkeypatch: pytest.MonkeyPatch, platform: str, name: str
) -> None:
    monkeypatch.setattr(sys, "platform", platform)
    assert bin_name() == name


def test_a_file_not_there_is_said(tmp_path: Path) -> None:
    with pytest.raises(BinError, match="isn't there"):
        to_bin(tmp_path / "ancestree-backup-2026-01-01T09-00-00.zip")


def test_the_freedesktop_trash_holds_the_file_and_where_it_was(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """As GNOME's and KDE's file managers keep it, so their Put back finds the way home."""
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    folder = tmp_path / "back ups"
    folder.mkdir()
    first = folder / "ancestree-backup-2026-01-01T09-00-00.zip"
    first.write_bytes(b"first")

    landed = system_bin._freedesktop(first)

    trash = tmp_path / "data" / "Trash"
    assert Path(landed) == trash / "files" / first.name
    assert Path(landed).read_bytes() == b"first"
    assert not first.exists()
    info = (trash / "info" / f"{first.name}.trashinfo").read_text(encoding="utf-8")
    lines = info.splitlines()
    assert lines[0] == "[Trash Info]"
    assert lines[1].startswith("Path=")
    assert "back%20ups" in lines[1]  # as a URL's path
    assert Path(unquote(lines[1].removeprefix("Path="))) == first
    assert lines[2].startswith("DeletionDate=20")

    # Another of the same name doesn't take the first one's place.
    first.write_bytes(b"second")
    again = system_bin._freedesktop(first)
    assert Path(again).name == "ancestree-backup-2026-01-01T09-00-00.2.zip"
    assert Path(landed).read_bytes() == b"first"
    assert (trash / "info" / "ancestree-backup-2026-01-01T09-00-00.2.zip.trashinfo").exists()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows' Recycle Bin")
def test_a_disk_with_no_recycle_bin_keeps_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A USB stick, or a disk whose bin deletes at once: never deleted for good."""
    monkeypatch.setattr(system_bin, "_has_recycle_bin", lambda path: False)
    kept = tmp_path / "ancestree-backup-2026-01-01T09-00-00.zip"
    kept.write_bytes(b"kept")
    with pytest.raises(BinError, match="has no Recycle Bin"):
        to_bin(kept)
    assert kept.read_bytes() == b"kept"


@pytest.mark.skipif(
    os.environ.get("ANCESTREE_TEST_SYSTEM_BIN") != "1",
    reason="sends a file to this computer's own bin: on GitHub's machines only",
)
def test_a_file_goes_to_the_real_bin(tmp_path: Path) -> None:
    stem = f"ancestree-bin-test-{uuid4().hex}"
    sent = tmp_path / f"{stem}.zip"
    sent.write_bytes(b"made by AncesTree's tests")

    landed = to_bin(sent)

    assert not sent.exists()
    if sys.platform == "win32":
        assert landed is None
        listed = subprocess.run(  # noqa: S603 (the system's own PowerShell, our own words)
            [
                Path(os.environ["SYSTEMROOT"], "System32/WindowsPowerShell/v1.0/powershell.exe"),
                "-NoProfile",
                "-Command",
                "(New-Object -ComObject Shell.Application).NameSpace(10).Items() "
                "| ForEach-Object { $_.Name }",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        assert stem in listed
    elif sys.platform == "darwin":
        assert landed is not None
        assert "/.Trash" in landed
        assert landed.endswith(".zip")
    else:
        assert landed is not None
        assert Path(landed).read_bytes() == b"made by AncesTree's tests"
        trash = Path(landed).parent.parent
        assert (trash / "info" / f"{Path(landed).name}.trashinfo").exists()
