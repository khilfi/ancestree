"""Measures every country's pack before anything is cut, with
Protomaps' own `pmtiles extract --dry-run`, which reads only the build's directories: a few MB
a country, and nothing is kept.

    python measure.py <the pmtiles program> <admin_0> <admin_1> <a folder for the areas>

with Natural Earth's files, as regions.py says.

Each country at zoom 14, the deepest; if that's over the limit, at 13; if that's over too, it's
split by state, each measured the same way. It writes measured.json beside this file:
each country's size at each zoom it was measured at, and the zoom chosen, or its states. Then

    python measure.py --list

writes packs.json's countries and packs from it: each country whole, or its states, cut to the
zoom chosen, sized as measured until the pinning run pins them (cut.py). The world's pack stays
as it is.
"""

import json
import re
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import regions  # noqa: E402

MEASURED = HERE / "measured.json"
SOURCE = "https://build.protomaps.com/{build}.pmtiles"
LIMIT = 1_500_000_000  # about 1.5 GB a pack, well under GitHub's 2 GiB a file
ZOOMS = (14, 13)  # the deepest first
MINZOOM = 7  # the world's pack has the zooms before
UNITS = {"B": 1, "kB": 1000, "MB": 1000**2, "GB": 1000**3, "TB": 1000**4}
SIZE = re.compile(r"archive size of ([\d.]+) ([kMGT]?B)")


def size(said: str) -> int:
    """The pack's size, from what a dry run says ("… for an archive size of 1.3 GB")."""
    found = SIZE.search(said)
    if found is None:
        raise ValueError(f"no size in: {said[-300:]}")
    return round(float(found.group(1)) * UNITS[found.group(2)])


def dry_run(program: str, build: str, region: Path, maxzoom: int) -> int:
    """How big an area's pack would be, cut to `maxzoom`."""
    words = [
        program,
        "extract",
        SOURCE.format(build=build),
        str(region.with_suffix(".pmtiles")),
        f"--region={region}",
        f"--minzoom={MINZOOM}",
        f"--maxzoom={maxzoom}",
        "--dry-run",
    ]
    done = subprocess.run(words, capture_output=True, text=True, check=True)  # noqa: S603
    return size(done.stdout + done.stderr)


def zoom(sizes: dict[int, int]) -> int | None:
    """The deepest zoom whose pack is within the limit; None if none is."""
    return next((z for z in ZOOMS if z in sizes and sizes[z] <= LIMIT), None)


def measure(measure_one: Any, area: regions.Area) -> dict[str, Any]:
    """An area's sizes, from the deepest zoom up until one is within the limit."""
    sizes: dict[int, int] = {}
    for z in ZOOMS:
        sizes[z] = measure_one(area, z)
        if sizes[z] <= LIMIT:
            break
    return {
        "key": area.key,
        "title": area.title,
        "continent": area.continent,
        "sizes": {str(z): n for z, n in sizes.items()},
        "zoom": zoom(sizes),
    }


def measure_all(measure_one: Any, every: dict[str, regions.Area], admin_1: Any) -> list[Any]:
    """Every country, and the states of each too big whole, four at a time."""
    countries = sorted(every.values(), key=lambda area: area.key)
    with ThreadPoolExecutor(4) as pool:
        found = list(pool.map(lambda area: measure(measure_one, area), countries))
        for country, measured in zip(countries, found, strict=True):
            if measured["zoom"] is None:
                parts = sorted(regions.states(admin_1, country).values(), key=lambda a: a.key)
                measured["states"] = list(pool.map(lambda area: measure(measure_one, area), parts))
                print(f"{country.title}: split into {len(parts)} states", flush=True)
    return found


def listing(measured: dict[str, Any]) -> tuple[list[Any], list[Any]]:
    """The countries, and their packs: a country whole, or each of its states, by key."""
    countries: list[Any] = []
    packs: list[Any] = []
    for country in sorted(measured["countries"], key=lambda c: c["key"]):
        countries.append({key: country[key] for key in ("key", "title", "continent")})
        for part in country.get("states") or [country]:
            packs.append(
                {
                    "key": part["key"],
                    "title": part["title"].removesuffix(f", {country['title']}"),
                    "country": country["key"],
                    "minzoom": MINZOOM,
                    "maxzoom": part["zoom"],
                    "region": f"{part['key']}.geojson",
                    "first": False,
                    "size": part["sizes"][str(part["zoom"])],  # as measured, until pinned
                    "sha256": "",
                }
            )
    return countries, packs


def write_listing() -> None:
    """packs.json's countries and packs, from measured.json: the world's pack as it was."""
    pinned = json.loads(regions.PINNED.read_text(encoding="utf-8"))
    measured = json.loads(MEASURED.read_text(encoding="utf-8"))
    if measured["build"] != pinned["build"]:
        sys.exit(f"measured.json is of build {measured['build']}: measure {pinned['build']}")
    countries, packs = listing(measured)
    pinned["countries"] = countries
    pinned["packs"] = [pack for pack in pinned["packs"] if pack["first"]] + packs
    regions.PINNED.write_bytes((json.dumps(pinned, indent=2, ensure_ascii=False) + "\n").encode())
    print(f"{len(countries)} countries, {len(packs)} packs listed in {regions.PINNED}")


def main() -> None:
    if sys.argv[1:] == ["--list"]:
        write_listing()
        return
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    program, folder = sys.argv[1], Path(sys.argv[4])
    folder.mkdir(parents=True, exist_ok=True)
    build = json.loads(regions.PINNED.read_text(encoding="utf-8"))["build"]
    admin_0, admin_1 = regions.read(Path(sys.argv[2])), regions.read(Path(sys.argv[3]))
    # Each size kept as it's measured, so a run stopped carries on where it was.
    kept = folder / f"sizes-{build}.json"
    sizes: dict[str, int] = json.loads(kept.read_text(encoding="utf-8")) if kept.is_file() else {}
    lock = threading.Lock()

    def measure_one(area: regions.Area, maxzoom: int) -> int:
        if (made := sizes.get(f"{area.key}@{maxzoom}")) is None:
            made = dry_run(program, build, regions.write(folder, area), maxzoom)
            with lock:
                sizes[f"{area.key}@{maxzoom}"] = made
                kept.write_text(json.dumps(sizes), encoding="utf-8")
        print(f"{area.title}, zoom {maxzoom}: {made / 1e6:,.0f} MB", flush=True)
        return made

    found = measure_all(measure_one, regions.countries(admin_0), admin_1)
    record = {"build": build, "limit": LIMIT, "minzoom": MINZOOM, "countries": found}
    MEASURED.write_bytes((json.dumps(record, indent=1, ensure_ascii=False) + "\n").encode())
    print(f"{len(found)} countries measured: {MEASURED}")


if __name__ == "__main__":
    main()
