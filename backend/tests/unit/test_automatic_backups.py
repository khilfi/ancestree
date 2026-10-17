"""Automatic backups: which archives they are. How long every backup is kept, for 3
months, is test_backups_kept.py's."""

from pathlib import Path

from ancestree.exchange.backup import is_automatic
from ancestree.services.automatic import automatic_archives


def made(folder: Path, name: str) -> Path:
    path = folder / name
    path.write_bytes(b"zip")
    return path


def test_automatic_backups_are_told_apart_by_name(tmp_path: Path) -> None:
    by_hand = made(tmp_path, "ancestree-backup-2026-09-01T10-00-00.zip")
    first = made(tmp_path, "ancestree-backup-2026-09-02T10-00-00-automatic.zip")
    second = made(tmp_path, "ancestree-backup-2026-09-02T10-00-00-automatic-2.zip")
    elsewhere = made(tmp_path, "something-else-automatic.zip")

    found = automatic_archives(tmp_path)

    assert [path for _, path in found] == [first, second]
    assert found[0][0].year == 2026
    assert is_automatic(first.name)
    assert not is_automatic(by_hand.name)
    assert not is_automatic(elsewhere.name)  # not one of ours
    assert automatic_archives(tmp_path / "not-there") == []
