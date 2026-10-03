"""Backups locked with a password (0.4.0), for copies kept in a second place: a USB stick, or a
folder a cloud service keeps, where anyone who gets the file could otherwise read the family.

A locked backup is the backup archive, whole, encrypted with AES-256-GCM in pieces of 1 MB, so
a big archive never has to sit in memory:

    AncesTree locked backup 1\\n
    {"kdf": "pbkdf2-sha256", "rounds": 600000, "salt": "...", "nonce": "...", "piece": 1048576,
     "check": "..."}\\n
    piece 0, piece 1, ... each its bytes and their 16-byte tag

Each piece's nonce is the header's 8 random bytes and the piece's number; its tag also covers
the header, the number, and whether it's the last, so pieces can't be reordered, swapped with
another backup's, or cut short unnoticed. The key comes from the password with PBKDF2-SHA-256,
600,000 rounds, as a locked view-only copy's does. The computer that makes the copies keeps the
key (locked as the family folder's keys are), never the password. The header's check, made from
the key, tells a wrong password from a damaged file; it tells a guess no more than trying the
first piece would.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import struct
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"AncesTree locked backup 1\n"
SUFFIX = ".locked"
ROUNDS = 600_000
PIECE = 1 << 20
TAG = 16
# What a file may ask of a computer opening it: enough rounds to be safe, and never a day's work.
FEWEST_ROUNDS, MOST_ROUNDS = 100_000, 5_000_000
MOST_HEADER = 1024


class LockedError(Exception):
    """A locked backup that can't be opened: the wrong password, or a damaged file."""


@dataclass(frozen=True)
class Key:
    """A key made from a password, with what made it: kept by the computer that locks."""

    key: bytes
    salt: bytes
    rounds: int = ROUNDS

    @classmethod
    def from_password(cls, password: str, salt: bytes | None = None, rounds: int = ROUNDS) -> Key:
        salt = salt if salt is not None else os.urandom(16)
        made = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds, dklen=32)
        return cls(made, salt, rounds)

    def saved(self) -> bytes:
        return json.dumps(
            {"key": _b64(self.key), "salt": _b64(self.salt), "rounds": self.rounds}
        ).encode()

    @classmethod
    def load(cls, saved: bytes) -> Key:
        found = json.loads(saved)
        return cls(_unb64(found["key"]), _unb64(found["salt"]), int(found["rounds"]))


def _check(key: bytes) -> str:
    """What the key makes of a fixed text: the same key, the same check."""
    return _b64(hmac.digest(key, b"AncesTree locked backup check", "sha256")[:16])


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"), validate=True)


def _aad(header: bytes, number: int, last: bool) -> bytes:
    return header + struct.pack(">I?", number, last)


def _nonce(start: bytes, number: int) -> bytes:
    return start + struct.pack(">I", number)


def _pieces(source: BinaryIO, size: int) -> Iterator[tuple[bytes, bool]]:
    """The source in pieces, each told whether it's the last; an empty source is one empty
    piece."""
    piece = source.read(size)
    while True:
        following = source.read(size)
        yield piece, not following
        if not following:
            return
        piece = following


def lock(source: Path, target: Path, key: Key) -> Path:
    """`source`, locked, written whole to `target` (under a temporary name, then renamed)."""
    nonce = os.urandom(8)
    header = json.dumps(
        {
            "kdf": "pbkdf2-sha256",
            "rounds": key.rounds,
            "salt": _b64(key.salt),
            "nonce": _b64(nonce),
            "piece": PIECE,
            "check": _check(key.key),
        },
        separators=(",", ":"),
    ).encode()
    cipher = AESGCM(key.key)
    partial = target.with_name(target.name + ".partial")
    try:
        with source.open("rb") as plain, partial.open("wb") as out:
            out.write(MAGIC + header + b"\n")
            for number, (piece, last) in enumerate(_pieces(plain, PIECE)):
                out.write(cipher.encrypt(_nonce(nonce, number), piece, _aad(header, number, last)))
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
    return target


def _header(locked: BinaryIO) -> tuple[bytes, dict[str, object]]:
    if locked.read(len(MAGIC)) != MAGIC:
        raise LockedError("That isn't a locked AncesTree backup.")
    header = locked.readline(MOST_HEADER)
    if not header.endswith(b"\n"):
        raise LockedError("That locked backup is damaged: its first lines can't be read.")
    try:
        found = json.loads(header)
        rounds, piece = int(found["rounds"]), int(found["piece"])
        _unb64(found["salt"]), _unb64(found["nonce"])
    except (ValueError, KeyError, TypeError) as error:
        raise LockedError(
            "That locked backup is damaged: its first lines can't be read."
        ) from error
    if not FEWEST_ROUNDS <= rounds <= MOST_ROUNDS or not 1 <= piece <= 16 * PIECE:
        raise LockedError("That locked backup asks for more than AncesTree will do to open it.")
    return header.rstrip(b"\n"), found


def key_for(locked_path: Path, password: str) -> Key:
    """The key a password makes for a locked backup, with the backup's own salt and rounds."""
    with locked_path.open("rb") as locked:
        _, found = _header(locked)
    return Key.from_password(password, _unb64(str(found["salt"])), int(str(found["rounds"])))


def unlock(source: Path, target: Path, key: Key) -> Path:
    """A locked backup opened, written whole to `target`; nothing is written unless every
    piece checks out."""
    partial = target.with_name(target.name + ".partial")
    try:
        with source.open("rb") as locked, partial.open("wb") as out:
            header, found = _header(locked)
            if not hmac.compare_digest(str(found.get("check", "")), _check(key.key)):
                raise LockedError(
                    "That password doesn't open this backup. Check it, and try again."
                )
            cipher = AESGCM(key.key)
            nonce, size = _unb64(str(found["nonce"])), int(str(found["piece"])) + TAG
            for number, (piece, last) in enumerate(_pieces(locked, size)):
                try:
                    out.write(
                        cipher.decrypt(_nonce(nonce, number), piece, _aad(header, number, last))
                    )
                except InvalidTag as error:
                    raise LockedError(
                        "That locked backup is damaged: part of it doesn't check out."
                    ) from error
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
    return target
