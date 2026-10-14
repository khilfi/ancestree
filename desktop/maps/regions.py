"""Every pack's area: each country's own outline, and, for a
country split by state, each state's, from Natural Earth's 10m files, unsimplified, so no
island's tiles are left out. The files are Natural Earth's own, pinned by their SHA-256 in
packs.json ("outlines"), from github.com/nvkelso/natural-earth-vector (geojson/):
ne_10m_admin_0_countries.geojson (<admin_0>) and ne_10m_admin_1_states_provinces.geojson
(<admin_1>).

    python regions.py <admin_0> <admin_1> <folder>

writes <key>.geojson into <folder> for every pack packs.json lists but the world. The Map packs
workflow makes them so before it cuts; nothing of them is kept in the repository.

A pack is one of Natural Earth's countries, or one of its states: keyed by its ISO code, in
small letters ("my", "us-ca"), or by Natural Earth's own where it has none ("sol"). Countries
where no one lives (reefs, ice, unclaimed desert) have no pack: the world's shows them.
"""

import gzip
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PINNED = HERE.parents[1] / "backend" / "src" / "ancestree" / "maps" / "packs.json"
GAZETTEER = HERE.parents[1] / "backend" / "src" / "ancestree" / "places" / "gazetteer.tsv.gz"
PEOPLE = 1000  # a country of fewer has no pack of its own


@dataclass
class Area:
    """A country, or a state of one: its title, continent and outline's polygons."""

    key: str
    title: str
    continent: str
    people: int = 0
    polygons: list[Any] = field(default_factory=list)

    def add(self, geometry: dict[str, Any]) -> None:
        coordinates = geometry["coordinates"]
        self.polygons += [coordinates] if geometry["type"] == "Polygon" else coordinates

    def feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "properties": {},
            "geometry": {"type": "MultiPolygon", "coordinates": self.polygons},
        }


def code(properties: dict[str, Any]) -> str:
    """The country's ISO code, as the map's borders take it (scripts/map-shapes.mjs)."""
    eh = properties.get("ISO_A2_EH")
    return str(eh if eh and eh != "-99" else properties["ISO_A2"])


def named() -> dict[str, str]:
    """Each country's name as the app gives it, by its ISO code: the gazetteer's, GeoNames'."""
    with gzip.open(GAZETTEER, "rt", encoding="utf-8") as lines:
        rows = (line.rstrip("\n").split("\t") for line in lines)
        return {row[0]: row[4] for row in rows if row[3] == "N"}


def countries(admin_0: dict[str, Any], names: dict[str, str] | None = None) -> dict[str, Area]:
    """Natural Earth's countries, by key: the parts of one, such as France's overseas, in one;
    placed by its most populous part, and named as the app names it (`names`), or as Natural
    Earth does where it has no ISO code. Those where no one lives left out."""
    names = named() if names is None else names
    found: dict[str, Area] = {}
    most: dict[str, int] = {}
    for feature in admin_0["features"]:
        properties = feature["properties"]
        iso = code(properties)
        key = re.sub(r"[^a-z0-9]", "", (iso if iso != "-99" else properties["ADM0_A3"]).lower())
        people = max(int(properties["POP_EST"] or 0), 0)
        area = found.setdefault(key, Area(key, "", ""))
        area.add(feature["geometry"])
        area.people += people
        if people >= most.get(key, -1):
            most[key] = people
            area.title = names.get(iso) or str(properties["NAME_LONG"])
            area.continent = str(properties["CONTINENT"])
    return {key: area for key, area in found.items() if area.people >= PEOPLE}


def states(admin_1: dict[str, Any], country: Area) -> dict[str, Area]:
    """A country's states, by key ("us-ca"): Natural Earth's own code where a state has no ISO
    one."""
    found: dict[str, Area] = {}
    for feature in admin_1["features"]:
        properties = feature["properties"]
        if str(properties["iso_a2"]).lower() != country.key:
            continue
        key = str(properties["iso_3166_2"] or "").lower()
        if not re.fullmatch(rf"{re.escape(country.key)}-[a-z0-9]+", key):
            # Natural Earth's own ("CAN-1234", "PFA+00?"), as letters and digits alone.
            own = re.sub(r"[^a-z0-9]", "", str(properties["adm1_code"]).lower())
            key = f"{country.key}-{own}"
        title = f"{properties['name_en'] or properties['name']}, {country.title}"
        area = found.setdefault(key, Area(key, title, country.continent))
        area.add(feature["geometry"])
    return found


def read(path: Path, sha256: str | None = None) -> dict[str, Any]:
    """One of Natural Earth's files, checked against its pin if one is given."""
    data = path.read_bytes()
    if sha256 is not None and hashlib.sha256(data).hexdigest() != sha256:
        sys.exit(f"{path.name} isn't the file packs.json pins: fetch Natural Earth's v5.1.2")
    return json.loads(data)  # type: ignore[no-any-return]


def write(folder: Path, area: Area) -> Path:
    """An area's outline, as pmtiles takes it."""
    path = folder / f"{area.key}.geojson"
    path.write_text(json.dumps(area.feature()), encoding="utf-8", newline="\n")
    return path


def areas(admin_0: dict[str, Any], admin_1: dict[str, Any]) -> dict[str, Area]:
    """Every country's area, and every state's, by key."""
    found = countries(admin_0)
    for country in list(found.values()):
        found.update(states(admin_1, country))
    return found


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    pinned = json.loads(PINNED.read_text(encoding="utf-8"))
    outlines = pinned["outlines"]
    every = areas(
        read(Path(sys.argv[1]), outlines["admin_0"]["sha256"]),
        read(Path(sys.argv[2]), outlines["admin_1"]["sha256"]),
    )
    folder = Path(sys.argv[3])
    folder.mkdir(parents=True, exist_ok=True)
    wanted = [pack["key"] for pack in pinned["packs"] if pack.get("region")]
    if missing := [key for key in wanted if key not in every]:
        sys.exit(f"Natural Earth has no area for: {', '.join(missing)}")
    for key in wanted:
        write(folder, every[key])
    print(f"{len(wanted)} areas written to {folder}")


if __name__ == "__main__":
    main()
