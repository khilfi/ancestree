"""Cut the map's packs from Protomaps' build that packs.json names,
with Protomaps' own `pmtiles` program, and check each against the size and SHA-256 the app pins.
The Map packs workflow does, before it publishes them; so can you, to see they'd be the same:

    python cut.py <the pmtiles program> <a folder for the packs> [--pin]

For a newer build, set "build" in packs.json, then cut with --pin, which writes each pack's
size and SHA-256 there instead of checking them (platform guide, "Map packs").
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PINNED = HERE.parents[1] / "backend" / "src" / "ancestree" / "maps" / "packs.json"
SOURCE = "https://build.protomaps.com/{build}.pmtiles"


def command(program: str, pack: dict[str, object], build: str, target: Path) -> list[str]:
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
        words.append(f"--region={HERE / str(pack['region'])}")
    return words


def cut(program: str, folder: Path, pin: bool) -> list[str]:
    """Cut every pack into `folder`; the packs that aren't as pinned, unless pinning."""
    pinned = json.loads(PINNED.read_text(encoding="utf-8"))
    build = pinned["build"]
    folder.mkdir(parents=True, exist_ok=True)
    wrong = []
    for pack in pinned["packs"]:
        target = folder / f"{pack['key']}-{build}.pmtiles"
        subprocess.run(command(program, pack, build, target), check=True)  # noqa: S603
        with target.open("rb") as file:
            made = (target.stat().st_size, hashlib.file_digest(file, "sha256").hexdigest())
        print(f"{target.name}: {made[0]:,} bytes, {made[1]}")
        if pin:
            pack["size"], pack["sha256"] = made
        elif made != (pack["size"], pack["sha256"]):
            wrong.append(target.name)
    if pin:
        PINNED.write_bytes((json.dumps(pinned, indent=2) + "\n").encode())
    return wrong


def main() -> None:
    if len(sys.argv) not in (3, 4) or sys.argv[3:] not in ([], ["--pin"]):
        sys.exit(__doc__)
    if wrong := cut(sys.argv[1], Path(sys.argv[2]), pin=sys.argv[3:] == ["--pin"]):
        sys.exit(f"Not the packs the app pins, so not published: {', '.join(wrong)}")


if __name__ == "__main__":
    main()
