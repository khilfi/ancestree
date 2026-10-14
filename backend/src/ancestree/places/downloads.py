"""The places downloaded with the map: for each country, a file
of its every town, village and kampung, its states' and districts' middles, the places people
say they lived or were born at (estates, camps, hospitals, missions, farms), and its postcodes;
and for the world, its towns of 500 people or more and every postcode, which comes with the
world's map pack. Each in the gazetteer's own lines, from one day's copy of GeoNames (CC BY),
which packs.json pins, so the same copy always makes the same lines:

    uv run python -m ancestree.places.downloads <the copy's folder> <a folder for the files>

checks each file it makes against its pin in packs.json, as the Map packs workflow does before
it publishes them; with `--pin` after, it writes each one's pin there instead. A pin is the
SHA-256 of the file's lines, unpacked, and the packed file's size near enough: one zlib packs
the same lines into other bytes than another, as Windows' Python and Linux's do. The
copy's folder holds, from download.geonames.org: export/dump/'s allCountries.zip, cities500.zip,
admin1CodesASCII.txt, admin2Codes.txt and countryInfo.txt, and export/zip/'s allCountries.zip
as postcodes.zip.

Lines are those of gazetteer.tsv.gz (places/build.py), with two kinds more: L a place someone
may have lived or been born at that isn't a town, as an estate or a hospital, found by name but
never named on the map; and Z a postcode, its town's name as its other spelling.
"""

import gzip
import hashlib
import io
import json
import sys
import tempfile
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from ancestree.places.build import ABANDONED, IN_DETAIL, MIDDLES, SPELLINGS, _others, _rows
from ancestree.places.names import state_named

PINNED = Path(__file__).parents[1] / "maps" / "packs.json"
# The places people say they lived or were born at that aren't towns, by GeoNames' codes:
# estates and plantations, camps, hospitals and clinics, missions, farms and ranches.
LIVED_AT = {
    *("EST", "ESTB", "ESTC", "ESTO", "ESTR", "ESTSG", "ESTSL", "ESTT", "ESTX"),
    *("CMP", "CMPL", "CMPLA", "CMPMN", "CMPO", "CMPRF"),
    *("HSP", "HSPC", "HSPD", "HSPL"),
    *("MSSN", "FRM", "FRMS", "RNCH", "AGRC"),
}
ABROAD_SPELLINGS = 2  # other spellings each place keeps, but where the app has them in detail
WORLD_TOWNS = 500  # people: the world's file's towns
ORDER = {"S": 0, "D": 1, "P": 2, "L": 3, "Z": 4}


class Places:
    """One file's lines, each kept once, as the gazetteer reads them."""

    def __init__(self, admin1: dict[str, str], admin2: dict[str, str]) -> None:
        self.admin1, self.admin2 = admin1, admin2
        self.lines: dict[tuple[str, ...], tuple[str, ...]] = {}

    def state(self, country: str, code: str) -> str:
        name = self.admin1.get(f"{country}.{code}", "")
        return (state_named(name) or name) if country == "MY" else name

    def district(self, country: str, row: list[str]) -> str:
        """As places/build.py says it: Malaysia's without "Daerah"."""
        name = self.admin2.get(f"{country}.{row[10]}.{row[11]}", "") if row[11] else ""
        return name.removeprefix("Daerah ") if country == "MY" else name

    def keep(self, country: str, kind: str, row: list[str], others: list[str], state: str) -> None:
        district = self.district(country, row) if kind in ("P", "L") else ""
        where = f"{float(row[4]):.4f}", f"{float(row[5]):.4f}"
        line = (country, state, district, kind, row[1], *where, str(int(row[14] or 0)))
        self.lines.setdefault(
            (country, kind, state, district, row[1], *where), (*line, "|".join(others))
        )

    def place(self, row: list[str], most: int) -> None:
        """A row of GeoNames' places: a town, a state's or district's middle, or a place lived
        at; anything else passed over."""
        country, code = row[8], row[7]
        state = self.state(country, row[10])
        if row[6] == "P" and code not in ABANDONED:
            self.keep(country, "P", row, _others(row[1], row[2], row[3], most), state)
        elif row[6] == "A" and code in MIDDLES:
            kind = MIDDLES[code]
            name = (state_named(row[1]) or row[1]) if kind == "S" and country == "MY" else ""
            self.keep(country, kind, row, _others(row[1], row[2], row[3], 4), name or state)
        elif code in LIVED_AT:
            self.keep(country, "L", row, _others(row[1], row[2], row[3], min(most, 2)), state)

    def postcode(self, row: list[str]) -> None:
        """A row of GeoNames' postcodes: country, code, town, then the state's and district's
        names and codes, and where it is."""
        if not row[9] or not row[10]:
            return
        country = row[0]
        state = (state_named(row[3]) or row[3]) if country == "MY" else row[3]
        where = f"{float(row[9]):.4f}", f"{float(row[10]):.4f}"
        line = (country, state, row[5], "Z", row[1], *where, "0", row[2])
        self.lines.setdefault((country, "Z", row[1], row[2], *where), line)

    def packed(self) -> bytes:
        """The lines, in the gazetteer's order, gzipped as places/build.py packs: the same lines
        always the same bytes."""
        lines = sorted(
            self.lines.values(), key=lambda line: (line[0], ORDER[line[3]], line[1], line[4])
        )
        buffer = io.BytesIO()
        with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as packed:
            packed.write("".join("\t".join(line) + "\n" for line in lines).encode("utf-8"))
        return buffer.getvalue()


def _lines(archive: Path, name: str) -> Iterator[list[str]]:
    """A GeoNames file's rows, read from its zip as they come: allCountries holds millions."""
    with zipfile.ZipFile(archive) as opened, opened.open(name) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8"):
            if line.strip() and not line.startswith("#"):
                yield line.rstrip("\n").split("\t")


def build(copy: Path) -> dict[str, bytes]:
    """Every country's file, by its key ("my"), and the world's ("world")."""
    admin1 = {row[0]: row[2] for row in _rows((copy / "admin1CodesASCII.txt").read_text("utf-8"))}
    admin2 = {row[0]: row[1] for row in _rows((copy / "admin2Codes.txt").read_text("utf-8"))}
    made: dict[str, bytes] = {}
    with tempfile.TemporaryDirectory(prefix="ancestree-places-") as scratch:
        # Each country's rows apart first, as they come: then each country alone in memory.
        parts: dict[str, Any] = {}
        try:
            for row in _lines(copy / "allCountries.zip", "allCountries.txt"):
                if len(row) < 15 or not row[8]:
                    continue
                if not (row[6] in ("P", "A") or row[7] in LIVED_AT):
                    continue
                part = parts.get(row[8])
                if part is None:
                    part = parts[row[8]] = open(  # noqa: SIM115 - one for each country, held
                        Path(scratch) / f"{row[8]}.places", "w", encoding="utf-8", newline="\n"
                    )
                part.write("\t".join(row) + "\n")
            for row in _lines(copy / "postcodes.zip", "allCountries.txt"):
                part = parts.get(row[0])
                if part is None:
                    part = parts[row[0]] = open(  # noqa: SIM115 - one for each country, held
                        Path(scratch) / f"{row[0]}.places", "w", encoding="utf-8", newline="\n"
                    )
                part.write("Z\t" + "\t".join(row) + "\n")
        finally:
            for part in parts.values():
                part.close()
        for country in sorted(parts):
            places = Places(admin1, admin2)
            most = SPELLINGS.get(country, 8) if country in IN_DETAIL else ABROAD_SPELLINGS
            with (Path(scratch) / f"{country}.places").open(encoding="utf-8") as rows:
                for line in rows:
                    row = line.rstrip("\n").split("\t")
                    if row[0] == "Z":
                        places.postcode(row[1:])
                    else:
                        places.place(row, most)
            if places.lines:
                made[country.lower()] = places.packed()

    world = Places(admin1, admin2)
    for row in _lines(copy / "cities500.zip", "cities500.txt"):
        if row[7] in ABANDONED or int(row[14] or 0) < WORLD_TOWNS:
            continue
        others = _others(row[1], row[2], row[3], 5) if int(row[14] or 0) >= 100_000 else []
        world.keep(
            row[8], "P", row, _others(row[1], row[2], "", 1) + others, world.state(row[8], row[10])
        )
    for row in _lines(copy / "postcodes.zip", "allCountries.txt"):
        world.postcode(row)
    made["world"] = world.packed()
    return made


def file_name(key: str, snapshot: str) -> str:
    """A place file's name in the release: "places-my-20261014.tsv.gz"."""
    return f"places-{key}-{snapshot}.tsv.gz"


def main() -> None:
    words = sys.argv[1:]
    if len(words) not in (2, 3) or words[2:] not in ([], ["--pin"]):
        sys.exit(__doc__)
    copy, folder, pin = Path(words[0]), Path(words[1]), words[2:] == ["--pin"]
    pinned = json.loads(PINNED.read_text(encoding="utf-8"))
    places = pinned["places"]
    for name, sha256 in places["sources"]["files"].items():
        with (copy / name).open("rb") as file:
            if hashlib.file_digest(file, "sha256").hexdigest() != sha256:
                sys.exit(f"{name} isn't GeoNames' copy packs.json pins")
    folder.mkdir(parents=True, exist_ok=True)
    made: dict[str, dict[str, Any]] = {}
    wrong: list[str] = []
    for key, data in build(copy).items():
        name = file_name(key, places["snapshot"])
        (folder / name).write_bytes(data)
        made[key] = {"size": len(data), "lines": hashlib.sha256(gzip.decompress(data)).hexdigest()}
        if made[key]["lines"] != places["files"].get(key, {}).get("lines"):
            wrong.append(name)
    total = sum(int(each["size"]) for each in made.values())
    print(f"{len(made)} place files, {total / 1e6:,.0f} MB")
    wrong += sorted(file_name(key, places["snapshot"]) for key in places["files"].keys() - made)
    if pin:
        places["files"] = made
        PINNED.write_bytes((json.dumps(pinned, indent=2, ensure_ascii=False) + "\n").encode())
    elif wrong:
        sys.exit(f"Not the place files the app pins, so not published: {', '.join(wrong)}")


if __name__ == "__main__":
    main()
