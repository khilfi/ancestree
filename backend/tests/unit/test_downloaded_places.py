"""The places downloaded with the map: each country's file
and the world's, made from a day's copy of GeoNames, pinned by their lines; and the gazetteer
reading a country's download in place of its own lines, and the world's beside them. The copy
here is made up, in GeoNames' own form; its places are real towns and made-up ones."""

import gzip
import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest

from ancestree.domain.person import Place
from ancestree.places import downloads
from ancestree.places.gazetteer import Gazetteer


def geonames(
    name: str,
    lat: float,
    lon: float,
    code: str,
    country: str = "MY",
    admin: tuple[str, str] = ("03", "0301"),
    people: int = 0,
    others: str = "",
) -> str:
    """A row of GeoNames' allCountries.txt or cities500.txt: its class from its code."""
    kind = "A" if code.startswith("ADM") else "P" if code.startswith("PPL") else "S"
    fields = [
        "1",
        name,
        name,
        others,
        str(lat),
        str(lon),
        kind,
        code,
        country,
        "",
        admin[0],
        admin[1],
        "",
        "",
        str(people),
        "",
        "",
        "Asia/Kuala_Lumpur",
        "2026-10-13",
    ]
    return "\t".join(fields)


PLACES = [
    geonames("Kelantan", 5.3, 102.0, "ADM1", admin=("03", "")),
    geonames("Tumpat", 6.1, 102.15, "ADM2"),
    geonames("Kampung Contoh", 6.0, 102.1, "PPL", people=1200, others="Kg Contoh Lama"),
    geonames("Ladang Contoh", 6.02, 102.12, "EST"),  # an estate: lived at
    geonames("Hospital Contoh", 6.03, 102.13, "HSP"),  # a hospital: born at
    geonames("Sekolah Contoh", 6.04, 102.14, "SCH"),  # a school: neither
    geonames("Kampung Lama", 6.05, 102.15, "PPLQ"),  # abandoned
    geonames("Medan", 3.59, 98.67, "PPLA", country="ID", admin=("26", ""), people=2_000_000),
]
TOWNS = [
    geonames("Kota Bharu", 6.13, 102.24, "PPLA", people=314_964),
    geonames("Hamlet", 6.2, 102.3, "PPL", people=400),  # under 500: not the world's
    geonames("Medan", 3.59, 98.67, "PPLA", country="ID", admin=("26", ""), people=2_000_000),
]
POSTCODES = [
    "MY\t16200\tTumpat\tKelantan\t03\t\t\t\t\t6.1978\t102.1712\t4",
    "ID\t20111\tMedan\tSumatera Utara\t34\t\t\t\t\t3.5833\t98.6667\t4",
]


@pytest.fixture
def copy(tmp_path: Path) -> Path:
    """A day's copy of GeoNames, made up, in its own files."""
    folder = tmp_path / "geonames"
    folder.mkdir()
    for archive, inside, rows in (
        ("allCountries.zip", "allCountries.txt", PLACES),
        ("cities500.zip", "cities500.txt", TOWNS),
        ("postcodes.zip", "allCountries.txt", POSTCODES),
    ):
        with zipfile.ZipFile(folder / archive, "w") as zipped:
            zipped.writestr(inside, "".join(row + "\n" for row in rows))
    (folder / "admin1CodesASCII.txt").write_text(
        "MY.03\tKelantan\tKelantan\t1733049\nID.26\tNorth Sumatra\tNorth Sumatra\t1213642\n",
        encoding="utf-8",
    )
    (folder / "admin2Codes.txt").write_text(
        "MY.03.0301\tTumpat\tTumpat\t1733040\n", encoding="utf-8"
    )
    (folder / "countryInfo.txt").write_text("", encoding="utf-8")
    return folder


def lines(data: bytes) -> list[list[str]]:
    return [line.split("\t") for line in gzip.decompress(data).decode("utf-8").splitlines()]


def test_a_countrys_places_lived_at_and_postcodes_in_the_gazetteers_lines(copy: Path) -> None:
    made = downloads.build(copy)
    assert sorted(made) == ["id", "my", "world"]
    malaysia = lines(made["my"])
    assert [(line[3], line[4]) for line in malaysia] == [
        ("S", "Kelantan"),
        ("D", "Tumpat"),
        ("P", "Kampung Contoh"),
        ("L", "Hospital Contoh"),
        ("L", "Ladang Contoh"),
        ("Z", "16200"),
    ]  # no school, nor the abandoned kampung
    village = malaysia[2]
    assert village == [
        "MY", "Kelantan", "Tumpat", "P", "Kampung Contoh", "6.0000", "102.1000", "1200",
        "Kg Contoh Lama",
    ]  # fmt: skip
    assert malaysia[-1][7:] == ["0", "Tumpat"]  # a postcode, its town as its other name
    assert all(len(line) == 9 for line in malaysia)  # each as the gazetteer reads it


def test_the_worlds_file_has_its_towns_of_500_and_every_postcode(copy: Path) -> None:
    world = lines(downloads.build(copy)["world"])
    assert [(line[0], line[3], line[4]) for line in world] == [
        ("ID", "P", "Medan"),
        ("ID", "Z", "20111"),
        ("MY", "P", "Kota Bharu"),
        ("MY", "Z", "16200"),
    ]  # the hamlet of 400 left out


def test_the_same_copy_always_makes_the_same_lines(copy: Path) -> None:
    first, again = downloads.build(copy), downloads.build(copy)
    assert {key: gzip.decompress(data) for key, data in first.items()} == {
        key: gzip.decompress(data) for key, data in again.items()
    }
    assert downloads.file_name("my", "20261014") == "places-my-20261014.tsv.gz"


def test_place_files_are_checked_against_their_pins_by_their_lines(
    copy: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pinned once from the copy; then made again and checked, as the workflow does; and a copy
    that isn't the one pinned, or a file that isn't as pinned, stops it."""
    pinned = tmp_path / "packs.json"
    sums = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in copy.iterdir()}
    places: dict[str, Any] = {"snapshot": "20261014", "sources": {"files": sums}, "files": {}}
    pinned.write_text(json.dumps({"places": places}), encoding="utf-8")
    monkeypatch.setattr(downloads, "PINNED", pinned)
    out = tmp_path / "out"

    monkeypatch.setattr("sys.argv", ["downloads", str(copy), str(out), "--pin"])
    downloads.main()
    pins = json.loads(pinned.read_text(encoding="utf-8"))["places"]["files"]
    assert sorted(pins) == ["id", "my", "world"]
    made = (out / "places-my-20261014.tsv.gz").read_bytes()
    assert pins["my"] == {
        "size": len(made),
        "lines": hashlib.sha256(gzip.decompress(made)).hexdigest(),
    }
    monkeypatch.setattr("sys.argv", ["downloads", str(copy), str(out)])
    downloads.main()  # made again, the same lines: nothing said

    pins["my"]["lines"] = "0" * 64
    pinned.write_text(json.dumps({"places": {**places, "files": pins}}), encoding="utf-8")
    with pytest.raises(SystemExit, match="places-my-20261014"):
        downloads.main()
    (copy / "countryInfo.txt").write_text("changed", encoding="utf-8")
    with pytest.raises(SystemExit, match="isn't GeoNames' copy"):
        downloads.main()


# The gazetteer, with places downloaded: the app's own lines are a made-up few.
OWN = [
    "MY\t\t\tN\tMalaysia\t3.1\t101.7\t30000000\t",
    "SG\t\t\tN\tSingapore\t1.29\t103.85\t5600000\t",
    "MY\tKelantan\t\tS\tKelantan\t5.3\t102.0\t0\t",
    "MY\tKelantan\tTumpat\tP\tKampung Contoh\t6.0\t102.1\t1200\tKg Contoh Lama",
    "SG\t\t\tP\tSingapore\t1.29\t103.85\t5600000\t",
]


def test_a_countrys_download_is_read_in_place_of_the_apps_own_lines(copy: Path) -> None:
    made = downloads.build(copy)
    asked: list[str] = []

    def more(key: str) -> list[str] | None:
        asked.append(key)
        return gzip.decompress(made[key]).decode("utf-8").splitlines(True) if key == "my" else None

    places = Gazetteer(OWN, more)
    estate = places.locate(Place(town="Ladang Contoh", state="Kelantan", country="Malaysia"), {})
    assert estate is not None
    assert (estate.found, estate.name, estate.district) == ("town", "Ladang Contoh", "Tumpat")
    postcode = places.locate(Place(town="16200", country="Malaysia"), {})
    assert postcode is not None
    assert (postcode.lat, postcode.lon) == (6.1978, 102.1712)
    # On the map, only towns are named: no estate, hospital or postcode.
    assert [town.name for town in places.towns("MY", 0)] == ["Kampung Contoh"]
    assert "my" in asked


def test_the_worlds_towns_are_read_beside_the_apps_own_lines_once(copy: Path) -> None:
    """Where a country has no download of its own, the world's file adds its towns of 500 and
    its postcodes to the app's own lines; a town in both is one town."""
    made = downloads.build(copy)
    world = gzip.decompress(made["world"]).decode("utf-8").splitlines(True)
    world.append("SG\t\t\tP\tSingapore\t1.29\t103.85\t5600000\t\n")  # as the app's own has it
    world.append("SG\t\t\tP\tJurong\t1.33\t103.72\t500\t\n")
    places = Gazetteer(OWN, lambda key: world if key == "world" else None)
    jurong = places.locate(Place(town="Jurong", country="Singapore"), {})
    assert jurong is not None
    assert jurong.found == "town"
    assert [town.name for town in places.towns("SG", 0)] == ["Singapore", "Jurong"]
    malaysia = [town.name for town in places.towns("MY", 0)]
    assert malaysia == ["Kota Bharu", "Kampung Contoh"]  # the world's and the app's own


# Suggestions as an address is typed, from a country's download.


def downloaded(copy: Path) -> Gazetteer:
    made = downloads.build(copy)

    def more(key: str) -> list[str] | None:
        return gzip.decompress(made[key]).decode("utf-8").splitlines(True) if key == "my" else None

    return Gazetteer(OWN, more)


def test_an_address_typed_is_filled_in_from_its_postcode_and_town(copy: Path) -> None:
    """The postcode first, with its town, then the towns the line names: each with its
    district, state and country, and where it is, as exactly as is known."""
    places = downloaded(copy)
    [first, *rest] = places.suggest("MY", "No. 12, Jalan Melati 3, 16200 Tumpat, Kelantan")
    assert (first.town, first.postcode, first.state, first.country, first.exact) == (
        "Tumpat",
        "16200",
        "Kelantan",
        "Malaysia",
        "postcode",
    )
    assert (first.lat, first.lon) == (6.1978, 102.1712)
    assert all(suggestion.postcode == "" for suggestion in rest)
    alone = places.suggest("MY", "16200")  # a postcode alone
    assert [(s.town, s.postcode) for s in alone] == [("Tumpat", "16200")]
    village = places.suggest("MY", "Lot 5, Kampung Contoh")
    assert [(s.town, s.district, s.exact) for s in village] == [
        ("Kampung Contoh", "Tumpat", "town")
    ]
    estate = places.suggest("MY", "Ladang Contoh")
    assert [s.town for s in estate] == ["Ladang Contoh"]  # a place lived at, too


def test_a_town_named_by_more_of_the_line_comes_before_a_bigger_one() -> None:
    """ "Bharu" alone is another name of Johor Bahru, the bigger: a line that says Kota Bharu
    means Kota Bharu."""
    places = Gazetteer([
        OWN[0],
        "MY\tJohor\tJohor Bahru\tP\tJohor Bahru\t1.47\t103.76\t858118\tBharu",
        "MY\tKelantan\tKota Bharu\tP\tKota Bharu\t6.12\t102.24\t568900\tBharu",
    ])  # fmt: skip
    found = places.suggest("MY", "Jalan Sultan, Kota Bharu")
    assert [s.town for s in found] == ["Kota Bharu", "Johor Bahru"]
    assert [s.town for s in places.suggest("MY", "Bharu")] == ["Johor Bahru", "Kota Bharu"]


def test_a_postcode_takes_its_towns_district_and_its_state_comes_first() -> None:
    """GeoNames gives Malaysia's postcodes no district: its town's is said. With a postcode in
    the line, a place in its state comes before one elsewhere that more of the line names; and
    the town a postcode is suggested with isn't suggested again."""
    places = Gazetteer([
        OWN[0],
        "MY\tSelangor\tHulu Langat\tP\tKajang\t2.99\t101.79\t342657\t",
        "MY\tSelangor\tHulu Langat\tP\tSemenyih\t2.95\t101.84\t50000\t",
        "MY\tJohor\tSegamat\tP\tTaman Bunga Raya\t2.5\t102.8\t0\t",
        "MY\tSelangor\t\tZ\t43000\t2.98\t101.78\t0\tKajang",
    ])  # fmt: skip
    found = places.suggest("MY", "No. 12, Jalan Melati 3, Taman Bunga Raya, 43000 Kajang")
    assert [(s.town, s.district, s.postcode) for s in found] == [
        ("Kajang", "Hulu Langat", "43000"),
        ("Taman Bunga Raya", "Segamat", ""),
    ]
    near = places.suggest("MY", "Taman Bunga Raya, Semenyih 43000")
    assert [s.town for s in near] == ["Kajang", "Semenyih", "Taman Bunga Raya"]
    # With no postcode, the town an address ends with comes first.
    plain = places.suggest("MY", "No. 12, Jalan Melati 3, Taman Bunga Raya, Kajang")
    assert [s.town for s in plain] == ["Kajang", "Taman Bunga Raya"]


def test_nothing_is_suggested_from_nothing_known() -> None:
    places = Gazetteer(OWN)
    assert places.suggest("MY", "16200") == []  # no postcodes without the download
    assert [s.town for s in places.suggest("MY", "Kampung Contoh")] == ["Kampung Contoh"]
    assert places.suggest("XX", "anything") == []
    assert places.suggest("MY", "") == []
