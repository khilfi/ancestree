"""Cut the map's packs from Protomaps' build that
packs.json names, with Protomaps' own `pmtiles` program, and check each against the size and
SHA-256 the app pins. The Map packs workflow does, a group at a time, before it publishes them.

The packs go in groups, one for the world and each continent's in parts of at most 8 GB, so
that each fits on one of GitHub's machines:

    python cut.py --groups

says them, as the workflow takes them. Then, for one group, with the areas regions.py made:

    python cut.py <the pmtiles program> <the areas' folder> <a folder for the packs> <group>

cuts its packs and checks each, byte for byte, against its pin; with `--pin <file>` after, it
writes each one's size and SHA-256 to that file instead, as the pinning run does for a newer
build. Last,

    python cut.py --merge <file> …

writes those into packs.json (platform guide, "Map packs").
"""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PINNED = HERE.parents[1] / "backend" / "src" / "ancestree" / "maps" / "packs.json"
SOURCE = "https://build.protomaps.com/{build}.pmtiles"
GROUP = 8_000_000_000  # bytes of packs at most in a group: one machine's room, and some


def command(program: str, pack: dict[str, Any], build: str, target: Path, areas: Path) -> list[str]:
    """The `pmtiles extract` that cuts one pack: its zooms, and its area unless it's the
    world's."""
    words = [
        program,
        "extract",
        SOURCE.format(build=build),
        str(target),
        f"--minzoom={pack['minzoom']}",
        f"--maxzoom={pack['maxzoom']}",
    ]
    if pack["region"]:
        words.append(f"--region={areas / str(pack['region'])}")
    return words


def slug(continent: str) -> str:
    """A continent as a group's name begins: "Seven seas (open ocean)" is "seven-seas"."""
    return "-".join(re.sub(r"\(.*?\)", "", continent).lower().split())


def groups(pinned: dict[str, Any]) -> dict[str, list[str]]:
    """Each group's packs, by key: the world's alone, then each continent's, in the list's
    order, a new part whenever the next would take it over GROUP."""
    continent = {country["key"]: country["continent"] for country in pinned["countries"]}
    found: dict[str, list[str]] = {}
    sizes: dict[str, int] = {}
    parts: dict[str, int] = {}
    for pack in pinned["packs"]:
        if pack["first"]:
            found["world"] = [pack["key"]]
            continue
        name = slug(continent[pack["country"]])
        part = parts.setdefault(name, 1)
        group = f"{name}-{part}"
        if found.get(group) and sizes[group] + pack["size"] > GROUP:
            parts[name] = part = part + 1
            group = f"{name}-{part}"
        found.setdefault(group, []).append(pack["key"])
        sizes[group] = sizes.get(group, 0) + pack["size"]
    return found


def cut(program: str, areas: Path, folder: Path, group: str, pins: Path | None) -> list[str]:
    """Cut a group's packs into `folder`; the packs that aren't as pinned, unless pinning, when
    each one's size and SHA-256 go to `pins`."""
    pinned = json.loads(PINNED.read_text(encoding="utf-8"))
    build = pinned["build"]
    wanted = set(groups(pinned)[group])
    folder.mkdir(parents=True, exist_ok=True)
    wrong, made = [], {}
    for pack in pinned["packs"]:
        if pack["key"] not in wanted:
            continue
        target = folder / f"{pack['key']}-{build}.pmtiles"
        subprocess.run(command(program, pack, build, target, areas), check=True)  # noqa: S603
        with target.open("rb") as file:
            size, sha256 = target.stat().st_size, hashlib.file_digest(file, "sha256").hexdigest()
        print(f"{target.name}: {size:,} bytes, {sha256}", flush=True)
        made[pack["key"]] = {"size": size, "sha256": sha256}
        if (size, sha256) != (pack["size"], pack["sha256"]):
            wrong.append(target.name)
    if pins is not None:
        pins.write_bytes((json.dumps({"build": build, "packs": made}, indent=1) + "\n").encode())
        return []
    return wrong


def merge(files: list[Path]) -> int:
    """Each pack's size and SHA-256, from the pinning run's files, into packs.json: how many."""
    pinned = json.loads(PINNED.read_text(encoding="utf-8"))
    made: dict[str, Any] = {}
    for file in files:
        pins = json.loads(file.read_text(encoding="utf-8"))
        if pins["build"] != pinned["build"]:
            sys.exit(f"{file.name} was cut from build {pins['build']}, not {pinned['build']}")
        made.update(pins["packs"])
    for pack in pinned["packs"]:
        if pack["key"] in made:
            pack.update(made[pack["key"]])
    PINNED.write_bytes((json.dumps(pinned, indent=2, ensure_ascii=False) + "\n").encode())
    return len(made)


def main() -> None:
    words = sys.argv[1:]
    if words == ["--groups"]:
        print(json.dumps(list(groups(json.loads(PINNED.read_text(encoding="utf-8"))))))
    elif words[:1] == ["--merge"] and len(words) > 1:
        print(f"{merge([Path(word) for word in words[1:]])} packs pinned in {PINNED}")
    elif len(words) == 4 or (len(words) == 6 and words[4] == "--pin"):
        pins = Path(words[5]) if len(words) == 6 else None
        if wrong := cut(words[0], Path(words[1]), Path(words[2]), words[3], pins):
            sys.exit(f"Not the packs the app pins, so not published: {', '.join(wrong)}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
