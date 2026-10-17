"""Downloads that say where they went.

In the desktop app the engine saves each download itself, into the computer's Downloads folder,
so the page can say where it went, "Saved to Downloads: ancestree-import-template.csv", and Show
in folder opens the folder with it chosen. A name already there gets " (2)", " (3)", as the
desktop window's own downloads do, so nothing is ever written over. In a browser no folder is
set, and the browser saves them, as ever (the user's answer of 17 Oct 2026).
"""

import ctypes
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

# A name as AncesTree gives its files: no folders, nothing hidden, nothing a system refuses.
_NAME = re.compile(r"[\w][\w .()-]{0,150}\.(csv|zip|html|ged|png|svg)")


def downloads_folder() -> Path:
    """The computer's Downloads folder: on Windows wherever it's been moved to, on Linux the
    desktop's own (XDG_DOWNLOAD_DIR), as the desktop window's downloads find it."""
    found = None
    if sys.platform == "win32":
        found = _windows_downloads()
    elif sys.platform != "darwin":
        found = _xdg_downloads()
    return found or Path.home() / "Downloads"


def _windows_downloads() -> Path | None:
    from ctypes import wintypes

    class Guid(ctypes.Structure):
        _fields_ = (
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", ctypes.c_ubyte * 8),
        )

    # FOLDERID_Downloads, {374DE290-123F-4565-9164-39C4925E467B}
    downloads = Guid(
        0x374DE290,
        0x123F,
        0x4565,
        (ctypes.c_ubyte * 8)(0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B),
    )
    shell = ctypes.WinDLL("shell32")  # type: ignore[attr-defined,unused-ignore]
    com = ctypes.WinDLL("ole32")  # type: ignore[attr-defined,unused-ignore]
    found = ctypes.c_wchar_p()
    if shell.SHGetKnownFolderPath(ctypes.byref(downloads), 0, None, ctypes.byref(found)) != 0:
        return None
    try:
        return Path(found.value) if found.value else None
    finally:
        com.CoTaskMemFree(found)


def _xdg_downloads() -> Path | None:
    config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    try:
        lines = (config / "user-dirs.dirs").read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        if line.startswith("XDG_DOWNLOAD_DIR="):
            value = line.partition("=")[2].strip().strip('"')
            value = value.replace("$HOME", Path.home().as_posix())
            return Path(value) if value.startswith("/") else None
    return None


def plain_name(name: str) -> bool:
    """Whether `name` is a file's name as AncesTree gives them, and nothing more."""
    return _NAME.fullmatch(name) is not None and name.strip() == name


def free_name(folder: Path, name: str) -> Path:
    """`name` in `folder`, or "name (2).csv" and on, if that's taken."""
    candidate, number = folder / name, 2
    stem, suffix = Path(name).stem, Path(name).suffix
    while candidate.exists():
        candidate = folder / f"{stem} ({number}){suffix}"
        number += 1
    return candidate


def save(folder: Path, name: str, data: bytes | Path) -> Path:
    """`data`, or a copy of the file at that path, saved in `folder` as `name`, or a name not
    taken yet; written whole or not at all."""
    if not plain_name(name):
        raise ValueError(f"Not a name AncesTree gives a file: {name!r}")
    folder.mkdir(parents=True, exist_ok=True)
    partial = folder / f".ancestree-{uuid4().hex}.partial"
    try:
        if isinstance(data, Path):
            shutil.copyfile(data, partial)
        else:
            partial.write_bytes(data)
        path = free_name(folder, name)
        os.replace(partial, path)  # nothing took the name between: none of ours did
        return path
    finally:
        partial.unlink(missing_ok=True)


def show(path: Path) -> None:
    """The file manager, open at `path`'s folder with it chosen: Explorer, the Finder, or the
    desktop's own on Linux, else the folder alone."""
    if sys.platform == "win32":
        explorer = Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "explorer.exe"
        subprocess.Popen([explorer, f"/select,{path}"])  # noqa: S603 (Windows' own, our path)
        return
    if sys.platform == "darwin":
        subprocess.Popen(["/usr/bin/open", "-R", str(path)])  # noqa: S603 (the Mac's own)
        return
    try:
        chosen = subprocess.run(  # noqa: S603 (the desktop's own file manager, asked by D-Bus)
            [  # noqa: S607 (wherever the system keeps gdbus)
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.freedesktop.FileManager1",
                "--object-path",
                "/org/freedesktop/FileManager1",
                "--method",
                "org.freedesktop.FileManager1.ShowItems",
                f"['{path.as_uri()}']",
                "",
            ],
            capture_output=True,
            timeout=10,
            check=False,
        )
        if chosen.returncode == 0:
            return
    except OSError, subprocess.TimeoutExpired:
        pass
    subprocess.Popen(["xdg-open", str(path.parent)])  # noqa: S603, S607 (the desktop's own)
