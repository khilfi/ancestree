"""The map's packs: OpenStreetMap's tiles, cut by Protomaps'
`pmtiles extract` from one of its builds, a pack for the world and one for each region. They're
kept in this repository's releases, made there by the Map packs workflow, and fetched once,
each kept only if it matches the SHA-256 pinned in packs.json, as Neo4j is. The world comes on
first opening the map; each region when chosen in Settings → Map. The engine serves their tiles
to the window, so the map asks nothing of the internet as it's used.

The packs live in the app's own folder, shared by every family on the computer: never in a
family's folder, nor so in its backups."""

from __future__ import annotations

import hashlib
import json
import mmap
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache
from http.client import HTTPException
from importlib.resources import files
from pathlib import Path
from typing import Any

from pmtiles.tile import (
    Compression,
    Entry,
    deserialize_directory,
    deserialize_header,
    find_tile,
    zxy_to_tileid,
)

from ancestree.domain.map import PackKey
from ancestree.maps.online import OpenFreeMap

_PINNED: dict[str, Any] = json.loads(
    (files("ancestree.maps") / "packs.json").read_text(encoding="utf-8")
)
BUILD: str = _PINNED["build"]  # Protomaps' build of OpenStreetMap the packs are cut from


@dataclass(frozen=True)
class Pack:
    key: PackKey
    title: str
    minzoom: int
    maxzoom: int
    region: str | None  # the area it's cut to, in desktop/maps/; None: the whole world
    first: bool  # fetched on first opening the map; the others when chosen
    size: int  # bytes
    sha256: str

    @property
    def name(self) -> str:
        return f"{self.key}-{BUILD}.pmtiles"

    @property
    def url(self) -> str:
        return str(_PINNED["release"]).format(build=BUILD) + self.name


PACKS: dict[str, Pack] = {each["key"]: Pack(**each) for each in _PINNED["packs"]}
CHOSEN = "chosen.json"  # beside the packs: whether the map's online extra is on

# Bytes so far, and bytes in all.
Progress = Callable[[int, int], None]


class PackError(Exception):
    """A pack couldn't be fetched, or didn't match its fingerprint, so it wasn't kept."""


def _sha256(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def _fetch_rest(pack: Pack, part: Path, progress: Progress) -> None:
    """Fetch what `part` doesn't have yet, carrying on where an earlier try stopped."""
    have = part.stat().st_size if part.is_file() else 0
    headers = {"User-Agent": "AncesTree"}
    if have:
        headers["Range"] = f"bytes={have}-"
    request = urllib.request.Request(pack.url, headers=headers)  # noqa: S310 - https only
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - https only
        if response.status != 206:
            have = 0  # the whole file again: the server didn't carry on
        with part.open("ab" if have else "wb") as out:
            done, told = have, 0.0
            while chunk := response.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if time.monotonic() - told > 0.25:  # a few times a second is enough to show
                    progress(done, pack.size)
                    told = time.monotonic()
    progress(part.stat().st_size, pack.size)


def fetch(
    pack: Pack,
    folder: Path,
    progress: Progress,
    tries: int = 4,
    pause: Callable[[float], None] = time.sleep,
) -> Path:
    """Fetch a pack, kept only if it matches its fingerprint. A connection that breaks is tried
    again, carrying on where it stopped; a pack that doesn't match is fetched afresh once, then
    refused."""
    if not pack.url.startswith("https://"):
        raise PackError(f"{pack.title} isn't fetched over https")
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / pack.name
    part = target.with_name(target.name + ".part")
    afresh = False
    for attempt in range(tries):
        try:
            _fetch_rest(pack, part, progress)
        except urllib.error.HTTPError as error:
            if error.code == 416:  # longer than the pack: start again
                part.unlink(missing_ok=True)
            # Only what can pass is tried again: GitHub busy, or a request that took too long.
            lasting = 400 <= error.code < 500 and error.code not in (408, 416, 429)
            if lasting or attempt == tries - 1:
                why = f"the server answered {error.code} ({error.reason})"
                raise PackError(f"{pack.title} couldn't be fetched: {why}") from error
            pause(5 * 2**attempt)
            continue
        except (OSError, HTTPException) as error:  # no internet, or cut off
            if attempt == tries - 1:
                why = "no internet, or the connection broke"
                raise PackError(f"{pack.title} couldn't be fetched: {why}") from error
            pause(5 * 2**attempt)
            continue
        if part.stat().st_size == pack.size and _sha256(part) == pack.sha256:
            part.replace(target)  # only a whole, checked pack ever gets its name
            return target
        part.unlink(missing_ok=True)
        if afresh:
            raise PackError(f"{pack.title} didn't match its fingerprint, so it wasn't kept")
        afresh = True
    raise PackError(f"{pack.title} couldn't be fetched")


class TileReader:
    """A pack's tiles. Its directories are read once and kept: a map's view takes dozens of
    tiles, and each would otherwise unpack them again."""

    def __init__(self, path: Path) -> None:
        self._file = path.open("rb")
        self._map = mmap.mmap(self._file.fileno(), 0, access=mmap.ACCESS_READ)
        self.header = deserialize_header(self._map[0:127])
        if self.header["internal_compression"] != Compression.GZIP:
            self.close()
            raise PackError(f"{path.name} isn't packed as a map pack is")
        self._directory = lru_cache(maxsize=512)(self._read_directory)

    def _read_directory(self, offset: int, length: int) -> list[Entry]:
        return deserialize_directory(self._map[offset : offset + length])

    @property
    def gzipped(self) -> bool:
        return bool(self.header["tile_compression"] == Compression.GZIP)

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        """The tile's bytes as the pack holds them, or None where the pack has none."""
        wanted = zxy_to_tileid(z, x, y)
        offset, length = self.header["root_offset"], self.header["root_length"]
        for _ in range(4):  # the root, and at most three levels of leaves
            found = find_tile(self._directory(offset, length), wanted)
            if found is None:
                return None
            if found.run_length:
                start = self.header["tile_data_offset"] + found.offset
                return self._map[start : start + found.length]
            offset = self.header["leaf_directory_offset"] + found.offset
            length = found.length
        return None

    def close(self) -> None:
        self._map.close()
        self._file.close()


@dataclass
class Fetching:
    """A pack on its way, or why it last failed."""

    done: int = 0
    total: int = 0
    running: bool = True
    error: str | None = None
    stop: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


class PackStore:
    """The packs on this computer, in `folder`: each fetched in the background when asked, one
    fetch for a pack at a time, and its tiles read from there. And the map's online extra:
    whether it's on, kept beside them, as it's the computer's choice, not a family's; and
    OpenFreeMap, for the tiles no pack here has."""

    def __init__(self, folder: Path, fetcher: Callable[..., Path] = fetch) -> None:
        self.folder = folder
        self._fetch = fetcher
        self.fetching: dict[str, Fetching] = {}
        self._readers: dict[str, TileReader] = {}
        self._lock = threading.Lock()
        self.online = self._chosen().get("online") is True
        self.openfreemap = OpenFreeMap()

    def _chosen(self) -> dict[str, Any]:
        try:
            chosen = json.loads((self.folder / CHOSEN).read_text(encoding="utf-8"))
        except OSError, ValueError:
            return {}
        return chosen if isinstance(chosen, dict) else {}

    def choose_online(self, on: bool) -> None:
        """Turn the map's online extra on or off: OpenFreeMap's tiles, where the packs end."""
        self.folder.mkdir(parents=True, exist_ok=True)
        (self.folder / CHOSEN).write_bytes(json.dumps({"online": on}).encode())
        self.online = on

    def path(self, pack: Pack) -> Path:
        return self.folder / pack.name

    def installed(self, pack: Pack) -> bool:
        return self.path(pack).is_file()

    def start(self, pack: Pack) -> bool:
        """Fetch a pack in the background, unless it's here or on its way. True if started."""
        with self._lock:
            now = self.fetching.get(pack.key)
            if self.installed(pack) or (now is not None and now.running):
                return False
            state = self.fetching[pack.key] = Fetching(total=pack.size)
            state.thread = threading.Thread(
                target=self._run, args=(pack, state), name=f"pack-{pack.key}", daemon=True
            )
        state.thread.start()
        return True

    def _run(self, pack: Pack, state: Fetching) -> None:
        def progress(done: int, total: int) -> None:
            if state.stop.is_set():
                raise PackError(f"{pack.title}: stopped")
            state.done, state.total = done, total

        try:
            self._fetch(pack, self.folder, progress)
        except PackError as error:
            state.error = str(error)
        except Exception as error:  # said, never left to end the thread unseen
            state.error = f"{pack.title} couldn't be fetched: {error}"
        finally:
            state.running = False

    def reader(self, pack: Pack) -> TileReader | None:
        """The pack's tiles, or None if it isn't on this computer."""
        with self._lock:
            reader = self._readers.get(pack.key)
            if reader is None and self.installed(pack):
                reader = self._readers[pack.key] = TileReader(self.path(pack))
            return reader

    def covered(self, z: int, x: int, y: int) -> bool:
        """Whether a pack on this computer has this tile: OpenFreeMap is then never asked."""
        for pack in PACKS.values():
            if pack.minzoom <= z <= pack.maxzoom:
                reader = self.reader(pack)
                if reader is not None and reader.tile(z, x, y) is not None:
                    return True
        return False

    def remove(self, pack: Pack) -> None:
        """Take a pack off this computer, and what was fetched of it, stopping it first if it's
        on its way."""
        with self._lock:
            state = self.fetching.get(pack.key)
            if state is not None and state.running and state.thread is not None:
                state.stop.set()
                state.thread.join(timeout=30)  # it stops at its next few bytes
                if state.thread.is_alive():
                    raise PackError(f"{pack.title} is still stopping: try again in a minute")
            reader = self._readers.pop(pack.key, None)
            if reader is not None:
                reader.close()  # Windows keeps a file that's open
            self.path(pack).unlink(missing_ok=True)
            self.path(pack).with_name(pack.name + ".part").unlink(missing_ok=True)
            self.fetching.pop(pack.key, None)

    def tidy(self) -> list[str]:
        """Packs of other builds, left from before an update: removed, and their names said."""
        keep = {name for pack in PACKS.values() for name in (pack.name, pack.name + ".part")}
        removed = []
        for file in sorted(self.folder.glob("*.pmtiles*")) if self.folder.is_dir() else []:
            if file.name not in keep:
                file.unlink(missing_ok=True)
                removed.append(file.name)
        return removed
