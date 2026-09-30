"""Makes the map's gazetteer: gazetteer.tsv.gz beside this file, from
GeoNames (CC BY: the map and Settings → About credit it). Run it only when the places should
change:

    uv run python -m ancestree.places.build <folder>

where <folder> holds, from https://download.geonames.org/export/dump/: MY.zip, SG.zip,
BN.zip, cities15000.zip, admin1CodesASCII.txt and countryInfo.txt.

It keeps every populated place in Malaysia, Singapore and Brunei, kampungs included, with the
other spellings people use, and each state's and district's middle; every town of 15,000
people or more elsewhere; and each country, at its capital. Nothing in it comes from
the family, and the same files always make the same gazetteer.

Each line: country code, state, kind, name, latitude, longitude, population, other names
(separated by "|"). Kinds: N a country, S a state's middle, D a district's middle, P a place.
"""

import gzip
import io
import sys
import unicodedata
import zipfile
from pathlib import Path

from ancestree.places.names import place_key, state_named

OUT = Path(__file__).with_name("gazetteer.tsv.gz")
IN_DETAIL = ("MY", "SG", "BN")  # every place, with the other spellings
ABANDONED = {"PPLH", "PPLQ", "PPLW"}  # historical, abandoned or destroyed places
MIDDLES = {"ADM1": "S", "ADM2": "D", "ADM3": "D"}
_LATIN = set("abcdefghijklmnopqrstuvwxyz0123456789 '.,()&/-")


def _latin(name: str) -> bool:
    plain = unicodedata.normalize("NFKD", name)
    plain = "".join(c for c in plain if not unicodedata.combining(c)).lower()
    return bool(plain) and set(plain) <= _LATIN


def _others(name: str, ascii_name: str, alternates: str, most: int) -> list[str]:
    """Other spellings in the Latin alphabet, each different once reduced for comparing:
    no codes such as airports' ("KUL")."""
    seen = {place_key(name)}
    found = []
    for other in [ascii_name, *alternates.split(",")]:
        other = other.strip()
        if len(other) < 3 or (other.isupper() and len(other) <= 4) or not _latin(other):
            continue
        key = place_key(other)
        if key and key not in seen:
            seen.add(key)
            found.append(other)
        if len(found) == most:
            break
    return found


def _rows(text: str) -> list[list[str]]:
    return [line.split("\t") for line in text.splitlines() if line and not line.startswith("#")]


def build(folder: Path) -> bytes:
    admin1 = {row[0]: row[2] for row in _rows((folder / "admin1CodesASCII.txt").read_text("utf-8"))}

    def state_of(country: str, code: str) -> str:
        name = admin1.get(f"{country}.{code}", "")
        return (state_named(name) or name) if country == "MY" else name

    out: dict[tuple[str, ...], tuple[str, ...]] = {}  # by what identifies it, to write once

    def keep(country: str, state: str, kind: str, row: list[str], others: list[str]) -> None:
        name = row[1]
        where = f"{float(row[4]):.4f}", f"{float(row[5]):.4f}"
        line = (country, state, kind, name, *where, str(int(row[14] or 0)), "|".join(others))
        out.setdefault((country, kind, state, name, *where), line)

    capitals: dict[str, list[str]] = {}
    biggest: dict[str, list[str]] = {}

    def note(country: str, row: list[str]) -> None:
        if row[7] == "PPLC":
            capitals.setdefault(country, row)
        if int(row[14] or 0) > int((biggest.get(country) or ["0"] * 15)[14] or 0):
            biggest[country] = row

    for country in IN_DETAIL:
        with zipfile.ZipFile(folder / f"{country}.zip") as archive:
            text = archive.read(f"{country}.txt").decode("utf-8")
        for row in _rows(text):
            state = state_of(country, row[10])
            if row[6] == "P" and row[7] not in ABANDONED:
                keep(country, state, "P", row, _others(row[1], row[2], row[3], 8))
                note(country, row)
            elif row[6] == "A" and row[7] in MIDDLES:
                kind = MIDDLES[row[7]]
                name = (state_named(row[1]) or row[1]) if kind == "S" and country == "MY" else ""
                keep(country, name or state, kind, row, _others(row[1], row[2], row[3], 4))

    with zipfile.ZipFile(folder / "cities15000.zip") as archive:
        text = archive.read("cities15000.txt").decode("utf-8")
    for row in _rows(text):
        country = row[8]
        if country in IN_DETAIL or row[7] in ABANDONED:
            continue
        # Other spellings only for the bigger cities ("Makkah" for Mecca), to keep it small.
        others = _others(row[1], row[2], row[3], 5) if int(row[14] or 0) >= 100_000 else []
        keep(country, state_of(country, row[10]), "P", row, _others(row[1], row[2], "", 1) + others)
        note(country, row)

    for row in _rows((folder / "countryInfo.txt").read_text("utf-8")):
        country, name = row[0], row[4]
        capital = capitals.get(country) or biggest.get(country)
        if capital is None:
            continue
        point = [*capital[:4], capital[4], capital[5], *capital[6:14], row[7] or "0"]
        point[1] = name
        keep(country, "", "N", point, [])

    order = {"N": 0, "S": 1, "D": 2, "P": 3}
    lines = sorted(out.values(), key=lambda line: (line[0], order[line[2]], line[1], line[3]))
    text = "".join("\t".join(line) + "\n" for line in lines)
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as packed:
        packed.write(text.encode("utf-8"))
    return buffer.getvalue()


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: uv run python -m ancestree.places.build <folder with the GeoNames files>")
    data = build(Path(sys.argv[1]))
    OUT.write_bytes(data)
    lines = gzip.decompress(data).decode("utf-8").count("\n")
    print(f"{OUT.name}: {lines:,} places, {len(data) / 1024:,.0f} KB")


if __name__ == "__main__":
    main()
