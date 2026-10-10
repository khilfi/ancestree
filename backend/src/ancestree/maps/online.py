"""The map's online extra: OpenFreeMap's tiles of OpenStreetMap,
where the map's packs end, such as a city abroad close up, or Indonesia past its pack's deepest
zoom. Off unless chosen in Settings → Map.

The engine fetches each tile for the window, and only one that no pack on this computer has, so
the pages still reach nothing outside this computer, and OpenFreeMap is never asked about a place
a pack shows. What its server learns is which parts of the world are looked at beyond the packs,
from this computer's internet address: no account, no key, and nothing of the family."""

from __future__ import annotations

import gzip
import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from http.client import HTTPException

INDEX = "https://tiles.openfreemap.org/planet"  # says where this week's tiles are
SERVER = "https://tiles.openfreemap.org/"  # tiles are fetched from here, and nowhere else
FROM_ZOOM = 7  # below it, the world's pack has every tile
DEEPEST = 14  # OpenFreeMap's deepest zoom: past it, the map draws its tiles larger
MOST_BYTES = 4 << 20  # a tile's, at most: a few hundred KB at the busiest
AGAIN = 6 * 3600.0  # seconds: OpenFreeMap makes new tiles each week, and its index says where


class OnlineError(Exception):
    """OpenFreeMap couldn't be reached, or didn't answer as it does."""


class OpenFreeMap:
    """OpenFreeMap's tiles, fetched one at a time as the window asks. Its index is read first,
    and again every few hours, for where this week's are."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._tiles: str | None = None  # ".../planet/20261004_113936_pt/{z}/{x}/{y}.pbf"
        self._read_at = 0.0

    def _get(self, url: str) -> tuple[bytes, str | None]:
        """The body as it came, and how it's packed. Tried twice, as a connection can break."""
        headers = {"User-Agent": "AncesTree", "Accept-Encoding": "gzip"}
        request = urllib.request.Request(url, headers=headers)  # noqa: S310 - https only
        for attempt in range(2):
            try:
                with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
                    body: bytes = response.read(MOST_BYTES + 1)
                    packed: str | None = response.headers.get("Content-Encoding")
            except urllib.error.HTTPError as error:
                raise OnlineError(f"OpenFreeMap answered {error.code} ({error.reason})") from error
            except (OSError, HTTPException) as error:  # no internet, or cut off
                if attempt == 1:
                    why = "no internet, or the connection broke"
                    raise OnlineError(f"OpenFreeMap couldn't be reached: {why}") from error
                continue
            if len(body) > MOST_BYTES:
                raise OnlineError("OpenFreeMap sent more than a tile")
            return body, packed
        raise OnlineError("OpenFreeMap couldn't be reached")

    def _where(self) -> str:
        """Where this week's tiles are, as OpenFreeMap's index says: on its own server only."""
        with self._lock:
            if self._tiles is None or self._clock() - self._read_at > AGAIN:
                body, packed = self._get(INDEX)
                try:
                    index = json.loads(gzip.decompress(body) if packed == "gzip" else body)
                    tiles = index["tiles"][0]
                except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
                    why = "OpenFreeMap's index didn't say where its tiles are"
                    raise OnlineError(why) from error
                if not (
                    isinstance(tiles, str)
                    and tiles.startswith(SERVER)
                    and tiles.endswith("/{z}/{x}/{y}.pbf")
                ):
                    raise OnlineError("OpenFreeMap's index named somewhere else for its tiles")
                self._tiles, self._read_at = tiles, self._clock()
            return self._tiles

    def tile(self, z: int, x: int, y: int) -> tuple[bytes, bool] | None:
        """A tile as OpenFreeMap has it, and whether it's gzipped: None where it has nothing."""
        where = self._where()
        url = where.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
        try:
            body, packed = self._get(url)
        except OnlineError:
            with self._lock:
                self._tiles = None  # its index is read again next time, in case the week turned
            raise
        if packed not in (None, "gzip"):
            raise OnlineError(f"OpenFreeMap sent a tile packed as {packed}")
        return (body, packed == "gzip") if body else None
