"""Automatic backups: which archives they are, and keeping the last 30 of them."""

from datetime import datetime, timedelta
from pathlib import Path

from ancestree.exchange.backup import is_automatic
from ancestree.services.automatic import KEEP, automatic_archives, tidy


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
    assert not is_automatic(elsewhere.name)  # never tidied away, so not marked as one
    assert automatic_archives(tmp_path / "not-there") == []


def test_only_the_last_30_automatic_backups_are_kept_and_every_one_by_hand(
    tmp_path: Path,
) -> None:
    by_hand = [made(tmp_path, f"ancestree-backup-2026-08-{day:02d}T09-00-00.zip") for day in (1, 2)]
    days = [datetime(2026, 8, 1, 10) + timedelta(days=n) for n in range(KEEP + 2)]
    automatic = [
        made(tmp_path, f"ancestree-backup-{day:%Y-%m-%dT%H-%M-%S}-automatic.zip") for day in days
    ]

    gone = tidy(tmp_path)

    assert gone == [automatic[0].name, automatic[1].name]
    assert [path for _, path in automatic_archives(tmp_path)] == automatic[2:]
    assert all(path.exists() for path in by_hand)
    assert tidy(tmp_path) == []
