"""Backups locked with a password (0.4.0), for copies kept in a second place."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from ancestree.exchange import locked
from ancestree.exchange.locked import MAGIC, PIECE, Key, LockedError, key_for, lock, unlock

# Few rounds, so the tests are quick; the file says how many, and opening it uses those.
FEW = 100_000


def made(tmp_path: Path, size: int) -> Path:
    path = tmp_path / "ancestree-backup-2026-10-03T10-00-00.zip"
    path.write_bytes(os.urandom(size))
    return path


@pytest.mark.parametrize("size", [0, 10, PIECE, PIECE + 1, 3 * PIECE - 5])
def test_a_locked_backup_opens_with_its_password_as_it_was(tmp_path: Path, size: int) -> None:
    backup = made(tmp_path, size)
    key = Key.from_password("a made-up password", rounds=FEW)
    locked_copy = lock(backup, tmp_path / "copy.locked", key)
    assert locked_copy.read_bytes().startswith(MAGIC)
    assert backup.read_bytes()[:64] not in locked_copy.read_bytes() or size == 0

    opened = unlock(
        locked_copy, tmp_path / "opened.zip", key_for(locked_copy, "a made-up password")
    )
    assert opened.read_bytes() == backup.read_bytes()


def test_the_key_kept_opens_it_without_the_password(tmp_path: Path) -> None:
    key = Key.from_password("a made-up password", rounds=FEW)
    kept = Key.load(key.saved())  # as the computer keeps it
    locked_copy = lock(made(tmp_path, 5000), tmp_path / "copy.locked", key)
    unlock(locked_copy, tmp_path / "opened.zip", kept)


def test_the_wrong_password_opens_nothing(tmp_path: Path) -> None:
    key = Key.from_password("a made-up password", rounds=FEW)
    locked_copy = lock(made(tmp_path, 5000), tmp_path / "copy.locked", key)
    with pytest.raises(LockedError, match="doesn't open this backup"):
        unlock(locked_copy, tmp_path / "opened.zip", key_for(locked_copy, "not the password"))
    assert not (tmp_path / "opened.zip").exists()  # nothing written


def test_a_locked_backup_cut_short_or_changed_is_refused(tmp_path: Path) -> None:
    key = Key.from_password("a made-up password", rounds=FEW)
    locked_copy = lock(made(tmp_path, 2 * PIECE + 100), tmp_path / "copy.locked", key)
    whole = locked_copy.read_bytes()
    header = len(MAGIC) + whole[len(MAGIC) :].index(b"\n") + 1
    piece = PIECE + locked.TAG
    for damaged in (
        whole[: header + piece],  # cut at a piece's end: the last left wasn't the last
        whole[: header + piece + 10],  # cut inside a piece
        whole[:header]
        + whole[header + piece : header + 2 * piece]
        + whole[header : header + piece]
        + whole[header + 2 * piece :],  # two pieces swapped
        whole[:-1] + bytes([whole[-1] ^ 1]),  # a bit changed
    ):
        locked_copy.write_bytes(damaged)
        with pytest.raises(LockedError, match="damaged"):
            unlock(locked_copy, tmp_path / "opened.zip", key)


def test_a_file_asking_too_much_or_not_locked_is_refused(tmp_path: Path) -> None:
    greedy = tmp_path / "greedy.locked"
    header = {"kdf": "pbkdf2-sha256", "rounds": 10**9, "salt": "AA==", "nonce": "AA==", "piece": 1}
    greedy.write_bytes(MAGIC + json.dumps(header).encode() + b"\n")
    with pytest.raises(LockedError, match="asks for more"):
        key_for(greedy, "anything")
    plain = made(tmp_path, 100)
    with pytest.raises(LockedError, match="isn't a locked"):
        key_for(plain, "anything")
