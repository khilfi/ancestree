"""Secrets kept on this computer: the Google sign-in and the family's keys.

On Windows they're locked for the Windows user with the system's own protection (DPAPI), so
another user of the computer, or someone who copies the file elsewhere, can't read them. On
the Mac and Linux they're in a file only the user may read; the keychain waits for the real
Mac.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_PROTECTED = b"AncesTree protected 1\n"
_PLAIN = b"AncesTree plain 1\n"
_ENTROPY = b"AncesTree family folder"


class ProtectError(Exception):
    """A secret that can't be read here: another Windows user's, or another computer's."""


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    class _Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _blob_p = ctypes.POINTER(_Blob)
    for _call in (_crypt32.CryptProtectData, _crypt32.CryptUnprotectData):
        _call.argtypes = [
            _blob_p,
            ctypes.c_void_p,
            _blob_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            _blob_p,
        ]
        _call.restype = wintypes.BOOL
    _kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    _kernel32.LocalFree.restype = ctypes.c_void_p
    _NO_PROMPTS = 0x1  # CRYPTPROTECT_UI_FORBIDDEN

    def _through(protecting: bool, data: bytes) -> bytes:
        source_buffer = ctypes.create_string_buffer(data, len(data))
        entropy_buffer = ctypes.create_string_buffer(_ENTROPY, len(_ENTROPY))
        source = _Blob(len(data), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char)))
        entropy = _Blob(len(_ENTROPY), ctypes.cast(entropy_buffer, ctypes.POINTER(ctypes.c_char)))
        result = _Blob()
        call = _crypt32.CryptProtectData if protecting else _crypt32.CryptUnprotectData
        ok = call(
            ctypes.byref(source),
            None,
            ctypes.byref(entropy),
            None,
            None,
            _NO_PROMPTS,
            ctypes.byref(result),
        )
        if not ok:
            error = ctypes.get_last_error()
            raise ProtectError(f"Windows couldn't {'lock' if protecting else 'open'} it ({error})")
        try:
            return ctypes.string_at(result.data, result.size)
        finally:
            _kernel32.LocalFree(ctypes.cast(result.data, ctypes.c_void_p))

    def protect(data: bytes) -> bytes:
        return _PROTECTED + _through(True, data)

    def _unprotect(blob: bytes) -> bytes:
        return _through(False, blob)

else:

    def protect(data: bytes) -> bytes:
        return _PLAIN + data

    def _unprotect(blob: bytes) -> bytes:
        raise ProtectError("locked by Windows, on another computer")


def unprotect(stored: bytes) -> bytes:
    if stored.startswith(_PROTECTED):
        return _unprotect(stored[len(_PROTECTED) :])
    if stored.startswith(_PLAIN):
        return stored[len(_PLAIN) :]
    raise ProtectError("not a secret AncesTree kept")


def write_secret(path: Path, data: bytes) -> None:
    """Write whole, readable by this user alone, and locked where the system can lock it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(protect(data))
    if sys.platform != "win32":
        partial.chmod(0o600)
    os.replace(partial, path)


def read_secret(path: Path) -> bytes | None:
    """The secret at `path`, or None if there's none."""
    try:
        stored = path.read_bytes()
    except FileNotFoundError:
        return None
    return unprotect(stored)
