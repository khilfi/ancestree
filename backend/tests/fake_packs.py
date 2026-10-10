"""Map packs made up for the tests, written by the pmtiles library as Protomaps cuts them:
vector tiles, gzipped, at the places given."""

import gzip
from pathlib import Path

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer


def write_pack(path: Path, tiles: dict[tuple[int, int, int], bytes]) -> None:
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
                "min_lon_e7": 990000000,
                "min_lat_e7": 0,
                "max_lon_e7": 1200000000,
                "max_lat_e7": 80000000,
                "center_zoom": min(zooms),
                "center_lon_e7": 1020000000,
                "center_lat_e7": 40000000,
            },
            {"vector_layers": []},
        )
