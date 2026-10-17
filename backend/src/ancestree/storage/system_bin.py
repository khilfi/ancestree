"""The system's bin: Windows' Recycle Bin, the Mac's Bin,
Linux's Trash. A file sent there can be put back from it, as one deleted by hand can.

Python has nothing for it, so each system's own way is used: Windows' shell, the Mac's file
manager, and on Linux the freedesktop.org Trash, which its desktops share. Nothing is ever
deleted for good here: a file that can't go to the bin, on a disk that has none (a USB stick on
Windows, say) or one whose bin is set to delete at once, stays where it is, and BinError says
why.
"""

import ctypes
import os
import stat
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote


class BinError(OSError):
    """The file couldn't go to the system's bin, and is where it was. It says why, in a few
    words, as Settings shows it after "couldn't go to the Recycle Bin, so they stay:"."""


def bin_name() -> str:
    """The bin, as this system names it."""
    return {"win32": "Recycle Bin", "darwin": "Bin"}.get(sys.platform, "Trash")


def to_bin(path: Path) -> str | None:
    """Send `path`, a file, to the system's bin; where it went there, when the system says."""
    path = Path(os.path.abspath(path))
    if not path.is_file():
        raise BinError(f"{path.name} isn't there")
    if sys.platform == "win32":
        _windows(path)  # the Recycle Bin keeps it under a name of its own
        return None
    if sys.platform == "darwin":
        return _mac(path)
    return _freedesktop(path)


# Windows: the shell's own delete, allowed to undo, asking nothing and showing nothing.
_FO_DELETE = 3
_FOF_SILENT = 0x0004
_FOF_NOCONFIRMATION = 0x0010
_FOF_ALLOWUNDO = 0x0040
_FOF_NOERRORUI = 0x0400
_DRIVE_FIXED = 3  # only a computer's own disks have a Recycle Bin, not USB sticks or the network
_BIN_SETTINGS = r"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume"
_NO_BIN_POLICY = r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"


def _windows(path: Path) -> None:
    from ctypes import wintypes

    if not _has_recycle_bin(path):
        raise BinError(f"{path.anchor} has no Recycle Bin, or it's set to delete at once")

    class FileOperation(ctypes.Structure):  # SHFILEOPSTRUCTW
        _fields_ = (
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        )

    shell = ctypes.WinDLL("shell32")  # type: ignore[attr-defined,unused-ignore]
    shell.SHFileOperationW.argtypes = (ctypes.POINTER(FileOperation),)
    shell.SHFileOperationW.restype = ctypes.c_int
    operation = FileOperation(
        wFunc=_FO_DELETE,
        pFrom=f"{path}\0",  # a list of names, ending with an empty one
        fFlags=_FOF_ALLOWUNDO | _FOF_NOCONFIRMATION | _FOF_NOERRORUI | _FOF_SILENT,
    )
    failed = shell.SHFileOperationW(ctypes.byref(operation))
    if failed or operation.fAnyOperationsAborted or path.exists():
        raise BinError(f"Windows said no (error {failed:#x})")


def _has_recycle_bin(path: Path) -> bool:
    """Whether a file deleted there goes to the Recycle Bin: a disk of the computer's own,
    with its bin neither turned off for every disk nor set to delete at once."""
    import winreg

    kernel = ctypes.WinDLL("kernel32")  # type: ignore[attr-defined,unused-ignore]
    kernel.GetDriveTypeW.argtypes = (ctypes.c_wchar_p,)
    kernel.GetVolumeNameForVolumeMountPointW.argtypes = (
        ctypes.c_wchar_p,
        ctypes.c_wchar_p,
        ctypes.c_uint,
    )
    if kernel.GetDriveTypeW(path.anchor) != _DRIVE_FIXED:
        return False
    if _setting(winreg.HKEY_CURRENT_USER, _NO_BIN_POLICY, "NoRecycleFiles"):
        return False
    volume = ctypes.create_unicode_buffer(64)
    if kernel.GetVolumeNameForVolumeMountPointW(path.anchor, volume, len(volume)):
        guid = volume.value.rstrip("\\").rsplit("\\", 1)[-1].removeprefix("Volume")
        return not _setting(winreg.HKEY_CURRENT_USER, rf"{_BIN_SETTINGS}\{guid}", "NukeOnDelete")
    return True


def _setting(root: int, key: str, name: str) -> int:
    import winreg

    try:
        with winreg.OpenKey(root, key) as opened:
            value, _ = winreg.QueryValueEx(opened, name)
            return int(value)
    except OSError, ValueError, TypeError:
        return 0


# The Mac: NSFileManager's trashItemAtURL, through the Objective-C runtime.
_OBJC = "/usr/lib/libobjc.A.dylib"
_FOUNDATION = "/System/Library/Frameworks/Foundation.framework/Foundation"


def _mac(path: Path) -> str | None:
    objc = ctypes.CDLL(_OBJC)
    ctypes.CDLL(_FOUNDATION)  # loaded, so its classes are there
    objc.objc_getClass.restype = ctypes.c_void_p
    objc.objc_getClass.argtypes = (ctypes.c_char_p,)
    objc.sel_registerName.restype = ctypes.c_void_p
    objc.sel_registerName.argtypes = (ctypes.c_char_p,)
    objc.objc_autoreleasePoolPush.restype = ctypes.c_void_p
    objc.objc_autoreleasePoolPop.argtypes = (ctypes.c_void_p,)
    sending = ctypes.cast(objc.objc_msgSend, ctypes.c_void_p).value or 0

    def send(answer: Any, receiver: Any, selector: str, *args: tuple[Any, Any]) -> Any:
        """[receiver selector...], with each argument's C type given, as arm64 needs."""
        kind = ctypes.CFUNCTYPE(answer, ctypes.c_void_p, ctypes.c_void_p, *(t for t, _ in args))
        return kind(sending)(
            receiver, objc.sel_registerName(selector.encode()), *(v for _, v in args)
        )

    def text_of(string: Any) -> str:
        said: bytes | None = send(ctypes.c_char_p, string, "UTF8String")
        return (said or b"").decode()

    pool = objc.objc_autoreleasePoolPush()
    try:
        text = send(
            ctypes.c_void_p,
            objc.objc_getClass(b"NSString"),
            "stringWithUTF8String:",
            (ctypes.c_char_p, os.fsencode(path)),
        )
        url = send(
            ctypes.c_void_p,
            objc.objc_getClass(b"NSURL"),
            "fileURLWithPath:",
            (ctypes.c_void_p, text),
        )
        manager = send(ctypes.c_void_p, objc.objc_getClass(b"NSFileManager"), "defaultManager")
        landed, error = ctypes.c_void_p(), ctypes.c_void_p()
        done = send(
            ctypes.c_bool,
            manager,
            "trashItemAtURL:resultingItemURL:error:",
            (ctypes.c_void_p, url),
            (ctypes.POINTER(ctypes.c_void_p), ctypes.byref(landed)),
            (ctypes.POINTER(ctypes.c_void_p), ctypes.byref(error)),
        )
        if not done:
            why = text_of(send(ctypes.c_void_p, error, "localizedDescription")) if error else ""
            raise BinError(why.rstrip(".") or "the Mac said no")
        if not landed.value:
            return None
        return text_of(send(ctypes.c_void_p, landed, "path")) or None
    finally:
        objc.objc_autoreleasePoolPop(pool)


# Linux and the like: the freedesktop.org Trash, as GNOME's and KDE's file managers keep it.
def _freedesktop(path: Path) -> str:
    trash, shown = _trash_for(path)
    files, info = trash / "files", trash / "info"
    files.mkdir(parents=True, exist_ok=True, mode=0o700)
    info.mkdir(parents=True, exist_ok=True, mode=0o700)
    said = (
        "[Trash Info]\n"
        f"Path={quote(str(shown), safe='/')}\n"
        f"DeletionDate={datetime.now():%Y-%m-%dT%H:%M:%S}\n"
    )
    for number in range(1, 1000):  # a name not taken yet, held by its info file
        name = path.name if number == 1 else f"{path.stem}.{number}{path.suffix}"
        try:
            held = os.open(info / f"{name}.trashinfo", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            continue
        with os.fdopen(held, "w", encoding="utf-8") as written:
            written.write(said)
        try:
            if (files / name).exists():
                raise FileExistsError(files / name)
            os.rename(path, files / name)
        except OSError as error:
            (info / f"{name}.trashinfo").unlink(missing_ok=True)
            if isinstance(error, FileExistsError):
                continue
            raise BinError(error.strerror or str(error)) from error
        return str(files / name)
    raise BinError(f"the Trash has too many called {path.name}")


def _trash_for(path: Path) -> tuple[Path, Path]:
    """The Trash a file on this disk goes to, and its path as the Trash's note says it: your
    own, in your home folder's disk; otherwise the disk's own, at its top."""
    data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    home_trash = data / "Trash"
    device = path.stat().st_dev
    known = home_trash
    while not known.exists() and known != known.parent:
        known = known.parent
    if known.stat().st_dev == device:
        return home_trash, path
    top = path.parent
    while top != top.parent and top.parent.stat().st_dev == device:
        top = top.parent
    uid = os.getuid()  # type: ignore[attr-defined,unused-ignore]
    shared = top / ".Trash"
    try:
        held = shared.lstat()
        if stat.S_ISDIR(held.st_mode) and held.st_mode & stat.S_ISVTX:
            return shared / str(uid), path.relative_to(top)
    except OSError:
        pass
    own = top / f".Trash-{uid}"
    try:
        own.mkdir(mode=0o700, exist_ok=True)
    except OSError as error:
        raise BinError(f"{top} has no Trash") from error
    return own, path.relative_to(top)
