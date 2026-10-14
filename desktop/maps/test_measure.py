"""Every country's area, and measuring its pack before anything is cut: Natural Earth's
countries and states as packs, and the zoom each is cut to, from what Protomaps' pmtiles says.
Made-up shapes stand in for Natural Earth's. From backend/:   uv run pytest ../desktop/maps
"""

# ruff: noqa: S101

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
for name in ("regions", "measure"):
    _spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    assert _spec
    assert _spec.loader
    module = importlib.util.module_from_spec(_spec)
    sys.modules[name] = module
    _spec.loader.exec_module(module)
regions = sys.modules["regions"]
measure = sys.modules["measure"]

SQUARE = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]


def country(name: str, iso: str, people: int, a3: str = "", continent: str = "Asia") -> Any:
    return {
        "properties": {
            "NAME": name,
            "NAME_EN": name,
            "NAME_LONG": f"{name}, in full",
            "ISO_A2_EH": iso,
            "ISO_A2": iso,
            "ADM0_A3": a3 or iso,
            "POP_EST": people,
            "CONTINENT": continent,
        },
        "geometry": {"type": "Polygon", "coordinates": SQUARE},
    }


def state(name: str, iso_a2: str, iso: str | None, adm1: str) -> Any:
    return {
        "properties": {
            "name": name,
            "name_en": name,
            "iso_a2": iso_a2,
            "iso_3166_2": iso,
            "adm1_code": adm1,
        },
        "geometry": {"type": "MultiPolygon", "coordinates": [SQUARE, SQUARE]},
    }


ADMIN_0 = {
    "features": [
        country("France", "FR", 67_000_000, continent="Europe"),
        country("Clipperton I.", "FR", 0, continent="North America"),  # part of France
        country("Somaliland", "-99", 5_000_000, a3="SOL", continent="Africa"),
        country("Bir Tawil", "-99", 0, a3="BRT", continent="Africa"),  # no one lives there
        country("United States of America", "US", 330_000_000, continent="North America"),
    ]
}
ADMIN_1 = {
    "features": [
        state("California", "US", "US-CA", "USA-3521"),
        state("Texas", "US", "US-TX", "USA-3536"),
        state("Somewhere", "US", "US-X01~", "USA-9999"),  # no ISO code of its own
        state("Elsewhere", "US", None, "PFA+00?"),  # nor this, and its own isn't a file's name
        state("Île-de-France", "FR", "FR-IDF", "FRA-1"),
    ]
}

# As the gazetteer names them.
NAMES = {"FR": "France", "US": "United States"}


def test_countries_are_named_as_the_app_names_them() -> None:
    names = regions.named()
    assert (names["CN"], names["KR"], names["US"], names["MY"]) == (
        "China",
        "South Korea",
        "United States",
        "Malaysia",
    )


def test_each_country_is_one_area_keyed_by_its_code() -> None:
    found = regions.countries(ADMIN_0, NAMES)
    assert sorted(found) == ["fr", "sol", "us"]  # Bir Tawil, where no one lives, has none
    france = found["fr"]
    assert (france.title, france.continent) == ("France", "Europe")  # by its most populous part
    assert len(france.polygons) == 2  # its overseas too
    assert found["sol"].title == "Somaliland, in full"  # Natural Earth's: it has no ISO code
    assert france.feature()["geometry"]["type"] == "MultiPolygon"


def test_a_countrys_states_are_keyed_by_their_codes() -> None:
    usa = regions.countries(ADMIN_0, NAMES)["us"]
    found = regions.states(ADMIN_1, usa)
    assert sorted(found) == ["us-ca", "us-pfa00", "us-tx", "us-usa9999"]  # Natural Earth's, plain
    assert found["us-ca"].title == "California, United States"
    assert found["us-ca"].continent == "North America"
    assert len(found["us-tx"].polygons) == 2


def test_a_natural_earth_file_that_isnt_the_one_pinned_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "admin_0.geojson"
    path.write_text('{"features": []}', encoding="utf-8")
    assert regions.read(path) == {"features": []}
    with pytest.raises(SystemExit):
        regions.read(path, "0" * 64)


@pytest.mark.parametrize(
    ("said", "size"),
    [
        ("Extract transferred 3.8 MB (overfetch 0.05) for an archive size of 3.8 MB", 3_800_000),
        ("… for an archive size of 1.3 GB", 1_300_000_000),
        ("… for an archive size of 640 MB", 640_000_000),
        ("… for an archive size of 12 kB", 12_000),
    ],
)
def test_the_size_a_dry_run_says(said: str, size: int) -> None:
    assert measure.size(said) == size


def test_a_dry_run_that_says_no_size_is_an_error() -> None:
    with pytest.raises(ValueError, match="no size"):
        measure.size("fetching 7 dirs")


def test_each_area_goes_as_deep_as_the_limit_allows() -> None:
    big = {14: 2_400_000_000, 13: 1_200_000_000}
    asked: list[int] = []

    def sizes(area: Any, z: int) -> int:
        asked.append(z)
        return big[z] if area.key == "fr" else 800_000_000

    every = regions.countries(ADMIN_0, NAMES)
    assert measure.measure(sizes, every["sol"])["zoom"] == 14
    assert asked == [14]  # within the limit at once: no other zoom asked
    france = measure.measure(sizes, every["fr"])
    assert (france["zoom"], france["sizes"]) == (13, {"14": 2_400_000_000, "13": 1_200_000_000})


def test_a_country_too_big_even_at_13_is_split_by_state() -> None:
    def sizes(area: Any, z: int) -> int:
        return 9_000_000_000 if area.key == "us" else 500_000_000

    found = {
        m["key"]: m for m in measure.measure_all(sizes, regions.countries(ADMIN_0, NAMES), ADMIN_1)
    }
    assert found["us"]["zoom"] is None
    assert [s["key"] for s in found["us"]["states"]] == ["us-ca", "us-pfa00", "us-tx", "us-usa9999"]
    assert all(s["zoom"] == 14 for s in found["us"]["states"])
    assert "states" not in found["fr"]
