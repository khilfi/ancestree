"""Map packs made up for the tests, written by the pmtiles library as Protomaps cuts them:
vector tiles, gzipped, at the places given, within bounds that are Malaysia's unless others
are given (west, south, east, north, in degrees)."""

import gzip
from pathlib import Path

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

MALAYSIA = (99.0, 0.0, 120.0, 8.0)


def write_pack(
    path: Path,
    tiles: dict[tuple[int, int, int], bytes],
    bounds: tuple[float, float, float, float] = MALAYSIA,
) -> None:
    west, south, east, north = (round(degrees * 1e7) for degrees in bounds)
    with path.open("wb") as file:
        writer = Writer(file)  # type: ignore[no-untyped-call]
        for (z, x, y), data in sorted(tiles.items(), key=lambda item: zxy_to_tileid(*item[0])):
            writer.write_tile(zxy_to_tileid(z, x, y), gzip.compress(data, mtime=0))  # type: ignore[no-untyped-call]
        zooms = [z for z, _, _ in tiles]
        writer.finalize(  # type: ignore[no-untyped-call]
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": min(zooms),
                "max_zoom": max(zooms),
                "min_lon_e7": west,
                "min_lat_e7": south,
                "max_lon_e7": east,
                "max_lat_e7": north,
                "center_zoom": min(zooms),
                "center_lon_e7": (west + east) // 2,
                "center_lat_e7": (south + north) // 2,
            },
            {"vector_layers": []},
        )
