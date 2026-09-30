"""Neo4j and the Java that runs it: fetched once, checked, unpacked, and kept tidy."""

from __future__ import annotations

import hashlib
import platform
import shutil
import sys
import tarfile
import time
import urllib.request
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

NEO4J_VERSION = "2026.08.1"
JAVA_RELEASE = "25.0.4+7"

# What's being fetched, bytes so far, and bytes in all when the server says.
Progress = Callable[[str, int, int | None], None]


@dataclass(frozen=True)
class Download:
    url: str
    sha256: str

    @property
    def name(self) -> str:
        return self.url.rsplit("/", 1)[-1]


NEO4J = {
    "windows": Download(
        f"https://dist.neo4j.org/neo4j-community-{NEO4J_VERSION}-windows.zip",
        "40f8a7f085d27b9429c329a6648830c1f3ddac8dd5a41857e3602b17e3a4a64b",
    ),
    "unix": Download(
        f"https://dist.neo4j.org/neo4j-community-{NEO4J_VERSION}-unix.tar.gz",
        "6e4bb155a4bd02a8a7a7e83a56aca70df1cd5d90ff4dd94b540f20f49f000084",
    ),
}
_JAVA_FROM = "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4%2B7/"
JAVA = {
    ("windows", "x64"): Download(
        _JAVA_FROM + "OpenJDK25U-jre_x64_windows_hotspot_25.0.4_7.zip",
        "5b0d58f043f762fa3ee6cc12b6774b59b245cafdcb357e45ce61f822aa9a56cb",
    ),
    ("mac", "aarch64"): Download(
        _JAVA_FROM + "OpenJDK25U-jre_aarch64_mac_hotspot_25.0.4_7.tar.gz",
        "bc5c721d4475b328e50cc0fbbe3319773db374716836e7caa8fb4398c1f90eba",
    ),
    ("linux", "x64"): Download(
        _JAVA_FROM + "OpenJDK25U-jre_x64_linux_hotspot_25.0.4_7.tar.gz",
        "aed3915f8facc0c80733ab2448bb0df4b494a36a2c5759e9a6e1eb979720f2b3",
    ),
}


class FetchError(Exception):
    """Neo4j or its Java couldn't be fetched or used."""


def this_system() -> tuple[str, str]:
    """("windows", "x64"), ("mac", "aarch64"), ("linux", "x64") and so on."""
    name = {"win32": "windows", "darwin": "mac"}.get(sys.platform, "linux")
    machine = platform.machine().lower()
    return name, {"amd64": "x64", "x86_64": "x64", "arm64": "aarch64"}.get(machine, machine)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(download: Download, into: Path, progress: Progress) -> Path:
    """Download once, keeping the file only if it matches its fingerprint."""
    if not download.url.startswith("https://"):
        raise FetchError(f"{download.name} isn't fetched over https")
    into.mkdir(parents=True, exist_ok=True)
    target = into / download.name
    if target.is_file() and sha256(target) == download.sha256:
        return target
    partial = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    request = urllib.request.Request(download.url, headers={"User-Agent": "AncesTree"})  # noqa: S310 - https only
    with (
        urllib.request.urlopen(request, timeout=60) as response,  # noqa: S310 - https only
        partial.open("wb") as out,
    ):
        total = int(response.headers.get("Content-Length") or 0) or None
        done = 0
        told = 0.0
        while chunk := response.read(1 << 20):
            out.write(chunk)
            digest.update(chunk)
            done += len(chunk)
            if time.monotonic() - told > 0.25:  # a few times a second is enough to show
                progress(download.name, done, total)
                told = time.monotonic()
    progress(download.name, done, total)
    if digest.hexdigest() != download.sha256:
        partial.unlink(missing_ok=True)
        raise FetchError(f"{download.name} didn't match its fingerprint, so it wasn't used")
    partial.replace(target)
    return target


def unpack(archive: Path, into: Path) -> Path:
    """Unpack beside `into`, then move it into place, so a half-unpacked folder never counts."""
    work = into.with_name(into.name + ".unpacking")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zipped:
            for member in zipped.namelist():
                if not (work / member).resolve().is_relative_to(work.resolve()):
                    raise FetchError(f"{archive.name} reaches outside its folder")
            zipped.extractall(work)  # noqa: S202 - every path checked above
    else:
        with tarfile.open(archive) as tarred:
            tarred.extractall(work, filter="data")  # nothing outside `work`, no devices
    tops = list(work.iterdir())
    if len(tops) != 1 or not tops[0].is_dir():
        raise FetchError(f"{archive.name} doesn't hold one folder")
    shutil.rmtree(into, ignore_errors=True)
    into.parent.mkdir(parents=True, exist_ok=True)
    tops[0].replace(into)
    shutil.rmtree(work, ignore_errors=True)
    return into


class Runtime:
    """Neo4j and Java in `root`, one folder each, named for their versions."""

    def __init__(self, root: Path, system: tuple[str, str] | None = None) -> None:
        self.root = root
        self.system = system or this_system()
        self.neo4j_home = root / f"neo4j-community-{NEO4J_VERSION}"
        self.java = root / f"jdk-{JAVA_RELEASE}-jre"

    @property
    def java_home(self) -> Path:
        return self.java / "Contents" / "Home" if self.system[0] == "mac" else self.java

    @property
    def java_program(self) -> Path:
        return self.java_home / "bin" / ("java.exe" if self.system[0] == "windows" else "java")

    def ready(self) -> bool:
        return (self.neo4j_home / "lib").is_dir() and self.java_program.is_file()

    def install(self, progress: Progress) -> bool:
        """Fetch and unpack whatever isn't here yet. True if anything was fetched."""
        downloads = self.root / "downloads"
        fetched = False
        if not (self.neo4j_home / "lib").is_dir():
            neo4j = NEO4J["windows" if self.system[0] == "windows" else "unix"]
            unpack(fetch(neo4j, downloads, progress), self.neo4j_home)
            fetched = True
        if not self.java_program.is_file():
            java = JAVA.get(self.system)
            if java is None:
                raise FetchError(f"No Java is set up for {self.system[0]} on {self.system[1]}")
            unpack(fetch(java, downloads, progress), self.java)
            fetched = True
        shutil.rmtree(downloads, ignore_errors=True)  # only what's unpacked is kept
        return fetched

    def tidy(self) -> list[str]:
        """Remove other versions, left from before an update; the names of those removed."""
        keep = {self.neo4j_home.name, self.java.name}
        removed = []
        for folder in self.root.iterdir() if self.root.is_dir() else []:
            if folder.is_dir() and folder.name not in keep:
                shutil.rmtree(folder, ignore_errors=True)
                removed.append(folder.name)
        return sorted(removed)
