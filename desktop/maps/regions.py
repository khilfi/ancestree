"""The regional packs' areas: malaysia.geojson, for Malaysia with
Singapore and Brunei, and indonesia.geojson, each country's own outline from Natural Earth's
ne_10m_admin_0_countries.geojson, unsimplified, so no island's tiles are left out:

    python regions.py <ne_10m_admin_0_countries.geojson>

Remade only with the borders (platform guide, "Map packs"): the packs' pins depend on them.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REGIONS = {"malaysia": {"MY", "SG", "BN"}, "indonesia": {"ID"}}


def code(properties: dict[str, str]) -> str:
    """The country's ISO code, as the map's borders take it (scripts/map-shapes.mjs)."""
    eh = properties.get("ISO_A2_EH")
    return eh if eh and eh != "-99" else properties["ISO_A2"]


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    features = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["features"]
    for name, codes in REGIONS.items():
        polygons: list[object] = []
        for feature in features:
            if code(feature["properties"]) in codes:
                geometry = feature["geometry"]
                polygons += (
                    [geometry["coordinates"]]
                    if geometry["type"] == "Polygon"
                    else geometry["coordinates"]
                )
        region = {
            "type": "Feature",
            "properties": {},
            "geometry": {"type": "MultiPolygon", "coordinates": polygons},
        }
        (HERE / f"{name}.geojson").write_text(json.dumps(region), encoding="utf-8", newline="\n")
        print(f"{name}.geojson: {len(polygons)} polygons")


if __name__ == "__main__":
    main()
