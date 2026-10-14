"""The map's packs: OpenStreetMap's tiles,
cut by Protomaps' `pmtiles extract` from one of its builds, a pack for the world and one for
each country, or each state of a country too big for one. They're kept in this repository's
releases, made there by the Map packs workflow, and fetched once, each kept only if it matches
the SHA-256 pinned in packs.json, as Neo4j is. The world comes on first opening the map; a
country, or a state of one, when chosen in Settings → Map. The engine serves their tiles to the
window, so the map asks nothing of the internet as it's used: all the packs cut to one depth
as one source, from whichever has the tile.

The packs live in the app's own folder, shared by every family on the computer: never in a
family's folder, nor so in its backups."""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import mmap
import threading
import time
import urllib.error
import urllib.request
import zlib
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

from ancestree.domain.map import Lookup, PackKey
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
    region: str | None  # the area it's cut to, made by desktop/maps/; None: the whole world
    first: bool  # fetched on first opening the map; the others when chosen
    size: int  # bytes
    sha256: str  # none until the pinning run has cut it (desktop/maps/cut.py)
    country: str = ""  # its country's key; none for the world's

    @property
    def name(self) -> str:
        return f"{self.key}-{BUILD}.pmtiles"

    @property
    def url(self) -> str:
        return str(_PINNED["release"]).format(build=BUILD) + self.name

    @property
    def pinned(self) -> bool:
        return bool(self.sha256)

    def matches(self, path: Path) -> bool:
        """Whether a file fetched is this pack, byte for byte."""
        return path.stat().st_size == self.size and _sha256(path) == self.sha256

    @property
    def most(self) -> int:
        """Bytes it may come in, at most: just as pinned."""
        return self.size


@dataclass(frozen=True)
class Country:
    """A country on the list: its packs, its own or each of its states'."""

    key: str
    title: str
    continent: str
    packs: tuple[str, ...]


PACKS: dict[str, Pack] = {each["key"]: Pack(**each) for each in _PINNED["packs"]}
COUNTRIES: dict[str, Country] = {
    each["key"]: Country(
        **each, packs=tuple(key for key, pack in PACKS.items() if pack.country == each["key"])
    )
    for each in _PINNED["countries"]
}
PLACES: dict[str, Any] = _PINNED["places"]  # GeoNames' copy the place files are made from


@dataclass(frozen=True)
class PlaceFile:
    """A country's places, or the world's, as places/downloads.py makes them: fetched
    with its packs, and read by the gazetteer."""

    country: str  # its country's key, or "world"
    title: str  # "Malaysia's places"
    size: int  # bytes, near enough: as packed where it was pinned
    lines: str  # the SHA-256 of its lines, unpacked: one zlib packs them otherwise than another

    @property
    def key(self) -> str:
        return f"places-{self.country}"  # as it's kept on its way

    @property
    def pinned(self) -> bool:
        return bool(self.lines)

    def matches(self, path: Path) -> bool:
        """Whether a file fetched holds these lines, whatever zlib packed them. Lines unpacked
        to many times what they're packed in, as no list of places is, aren't read on (0.8.0)."""
        digest, read = hashlib.sha256(), 0
        try:
            with gzip.open(path, "rb") as lines:
                while chunk := lines.read(1 << 20):
                    digest.update(chunk)
                    read += len(chunk)
                    if read > UNPACKED * self.most:
                        return False
        except OSError, EOFError, zlib.error:
            return False
        return digest.hexdigest() == self.lines

    @property
    def most(self) -> int:
        """Bytes it may come in, at most: as pinned, with room for zlib's packing otherwise."""
        return 2 * self.size + (1 << 20)

    @property
    def name(self) -> str:
        return f"places-{self.country}-{PLACES['snapshot']}.tsv.gz"

    @property
    def url(self) -> str:
        return str(_PINNED["release"]).format(build=BUILD) + self.name


PLACE_FILES: dict[str, PlaceFile] = {
    key: PlaceFile(
        key,
        "The world's towns and postcodes" if key == "world" else f"{COUNTRIES[key].title}'s places",
        **pin,
    )
    for key, pin in PLACES["files"].items()
    if key == "world" or key in COUNTRIES
}
HERE_FOR = 1.0  # seconds the packs on this computer are taken as known, between looks
# Beside the packs: whether the map's online extra is on, and whether an address may be
# looked up online.
CHOSEN = "chosen.json"

# Bytes so far, and bytes in all.
Progress = Callable[[int, int], None]


class PackError(Exception):
    """A pack couldn't be fetched, or didn't match its fingerprint, so it wasn't kept."""


UNPACKED = 20  # times what a place file comes in, its lines unpacked, at most


def _sha256(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def _fetch_rest(pack: Pack | PlaceFile, part: Path, progress: Progress) -> None:
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
                if done > pack.most:
                    break  # larger than it is: it won't match, so no more is fetched (0.8.0)
                if time.monotonic() - told > 0.25:  # a few times a second is enough to show
                    progress(done, pack.size)
                    told = time.monotonic()
    progress(part.stat().st_size, pack.size)


def fetch(
    pack: Pack | PlaceFile,
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
    if not pack.pinned:
        raise PackError(f"{pack.title} isn't out yet, so it can't be fetched")
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
        if pack.matches(part):
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
        # The map keeps a handle of its own: the file itself is closed at once, so each pack
        # read holds one open file, not two, of the few a Mac lets a program have (0.8.0).
        with path.open("rb") as file:
            self._map = mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ)
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

    def may_have(self, z: int, x: int, y: int) -> bool:
        """Whether the tile is within the pack's bounds, so it may be here: the others never
        are, and no pack need be searched for them."""
        west, east = x / 2**z * 360 - 180, (x + 1) / 2**z * 360 - 180
        north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2**z))))
        south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / 2**z))))
        h = self.header
        return (
            west <= h["max_lon_e7"] / 1e7
            and east >= h["min_lon_e7"] / 1e7
            and south <= h["max_lat_e7"] / 1e7
            and north >= h["min_lat_e7"] / 1e7
        )

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
        chosen = self._chosen()
        self.online = chosen.get("online") is True
        # Looking an address up online: asked each time unless chosen otherwise.
        lookup = chosen.get("lookup")
        self.lookup: Lookup = lookup if lookup in ("ask", "always", "never") else "ask"
        self.openfreemap = OpenFreeMap()
        # The packs' files here, looked at once a second at most: a view of the map asks for
        # dozens of tiles, and each would otherwise look for hundreds of packs.
        self._names: frozenset[str] = frozenset()
        self._looked = -HERE_FOR
        # Told when a place file comes or goes, with its country's key, or "world", and
        # whether it's here now: the gazetteer reads them afresh, and the addresses there are
        # placed more exactly.
        self.places_changed: Callable[[str, bool], None] = lambda country, here: None
        # How many of the family's addresses were placed more exactly as each country's places
        # came, by its key, since the app started: Settings → Map says so.
        self.placed: dict[str, int] = {}

    def _chosen(self) -> dict[str, Any]:
        try:
            chosen = json.loads((self.folder / CHOSEN).read_text(encoding="utf-8"))
        except OSError, ValueError:
            return {}
        return chosen if isinstance(chosen, dict) else {}

    def _keep_chosen(self) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        chosen = {"online": self.online, "lookup": self.lookup}
        (self.folder / CHOSEN).write_bytes(json.dumps(chosen).encode())

    def choose_online(self, on: bool) -> None:
        """Turn the map's online extra on or off: OpenFreeMap's tiles, where the packs end."""
        self.online = on
        self._keep_chosen()

    def choose_lookup(self, lookup: Lookup) -> None:
        """Whether an address may be looked up online: asked each time, without asking,
        or never."""
        self.lookup = lookup
        self._keep_chosen()

    def path(self, pack: Pack | PlaceFile) -> Path:
        return self.folder / pack.name

    def installed(self, pack: Pack | PlaceFile) -> bool:
        if time.monotonic() - self._looked >= HERE_FOR:
            found = self.folder.iterdir() if self.folder.is_dir() else []
            self._names = frozenset(file.name for file in found)
            self._looked = time.monotonic()
        return pack.name in self._names

    def places_of(self, pack: Pack) -> PlaceFile | None:
        """The places that come with a pack: its country's, or the world's."""
        return PLACE_FILES.get("world" if pack.first else pack.country)

    def places_path(self, country: str) -> Path | None:
        """A country's place file, or the world's, if it's on this computer: for the gazetteer."""
        places = PLACE_FILES.get(country)
        return self.path(places) if places is not None and self.installed(places) else None

    def _changed(self) -> None:
        """A pack came or went: look again at the next question."""
        self._looked = -HERE_FOR

    def start(self, pack: Pack | PlaceFile) -> bool:
        """Fetch a pack in the background, unless it's here or on its way, and its places with
        it if they aren't here. True if the pack was started."""
        if isinstance(pack, Pack) and (places := self.places_of(pack)) is not None:
            self.start(places)
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

    def _run(self, pack: Pack | PlaceFile, state: Fetching) -> None:
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
            self._changed()
            state.running = False
            if isinstance(pack, PlaceFile):
                self.places_changed(pack.country, state.error is None)

    def reader(self, pack: Pack) -> TileReader | None:
        """The pack's tiles, or None if it isn't on this computer."""
        with self._lock:
            reader = self._readers.get(pack.key)
            if reader is None and self.installed(pack):
                reader = self._readers[pack.key] = TileReader(self.path(pack))
            return reader

    def tile(self, z: int, x: int, y: int, depth: int | None = None) -> tuple[bytes, bool] | None:
        """A tile from whichever pack on this computer has it, of those cut to `depth` if one is
        given, and whether it's gzipped; None if none has. Packs of one build hold the same
        tile wherever they meet, so any one will do."""
        for pack in PACKS.values():
            if (depth is not None and pack.maxzoom != depth) or not (
                pack.minzoom <= z <= pack.maxzoom
            ):
                continue
            reader = self.reader(pack)
            if reader is not None and reader.may_have(z, x, y):
                found = reader.tile(z, x, y)
                if found is not None:
                    return found, reader.gzipped
        return None

    def covered(self, z: int, x: int, y: int) -> bool:
        """Whether a pack on this computer has this tile: OpenFreeMap is then never asked."""
        return self.tile(z, x, y) is not None

    def start_country(self, country: Country) -> None:
        """Fetch each of a country's packs, its own or its states', but those here already."""
        for key in country.packs:
            self.start(PACKS[key])

    def remove_country(self, country: Country) -> None:
        """Take each of a country's packs off this computer."""
        for key in country.packs:
            self.remove(PACKS[key])

    def remove(self, pack: Pack) -> None:
        """Take a pack off this computer, and what was fetched of it, stopping it first if it's
        on its way; and its places, once none of their country's packs is left."""
        self._remove(pack)
        places = self.places_of(pack)
        if places is None:
            return
        same = [other for other in PACKS.values() if self.places_of(other) == places]
        going = {key for key, state in self.fetching.items() if state.running}
        if not any(self.installed(other) or other.key in going for other in same):
            self._remove(places)
            self.places_changed(places.country, False)

    def _remove(self, pack: Pack | PlaceFile) -> None:
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
            self._changed()

    def tidy(self) -> list[str]:
        """Packs of other builds, and places of another GeoNames copy, left from before an
        update: removed, and their names said."""
        every: list[Pack | PlaceFile] = [*PACKS.values(), *PLACE_FILES.values()]
        keep = {name for pack in every for name in (pack.name, pack.name + ".part")}
        found = [
            *self.folder.glob("*.pmtiles*"),
            *self.folder.glob("places-*.tsv.gz*"),
        ] if self.folder.is_dir() else []  # fmt: skip
        removed = []
        for file in sorted(found):
            if file.name not in keep:
                file.unlink(missing_ok=True)
                removed.append(file.name)
        self._changed()
        return removed
