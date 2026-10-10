"""Cutting the map's packs: what the Map packs workflow asks of Protomaps' pmtiles program,
and its check against the app's pins, which stops a pack that isn't the one pinned. From
backend/:   uv run pytest ../desktop/maps
"""

# ruff: noqa: S101

import hashlib
import importlib.util
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import pytest

_spec = importlib.util.spec_from_file_location("cut", Path(__file__).with_name("cut.py"))
assert _spec
assert _spec.loader
cut = importlib.util.module_from_spec(_spec)
sys.modules["cut"] = cut
_spec.loader.exec_module(cut)


@pytest.fixture
def pinned(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A copy of packs.json, for the tests to pin into."""
    copy = tmp_path / "packs.json"
    shutil.copyfile(cut.PINNED, copy)
    monkeypatch.setattr(cut, "PINNED", copy)
    return copy


def made_by(commands: list[list[str]]) -> Any:
    """A stand-in for running pmtiles: each pack it's asked for holds the words it was asked."""

    def run(words: list[str], check: bool) -> None:
        commands.append(words)
        Path(words[3]).write_bytes(" ".join(words[4:]).encode())

    return run


def test_each_pack_is_cut_from_the_pinned_build_to_its_zooms_and_area() -> None:
    packs = json.loads(cut.PINNED.read_text(encoding="utf-8"))
    build = packs["build"]
    world, malaysia, indonesia = packs["packs"]
    target = Path("packs") / "x.pmtiles"
    assert cut.command("pmtiles", world, build, target) == [
        "pmtiles",
        "extract",
        f"https://build.protomaps.com/{build}.pmtiles",
        str(target),
        "--minzoom=0",
        "--maxzoom=6",
    ]
    words = cut.command("pmtiles", malaysia, build, target)
    assert words[4:6] == ["--minzoom=7", "--maxzoom=14"]
    assert words[6] == f"--region={cut.HERE / 'malaysia.geojson'}"
    assert cut.command("pmtiles", indonesia, build, target)[5] == "--maxzoom=13"


def test_a_pack_that_isnt_the_one_pinned_is_not_published(
    pinned: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []
    monkeypatch.setattr(cut.subprocess, "run", made_by(commands))
    build = json.loads(pinned.read_text(encoding="utf-8"))["build"]
    wrong = cut.cut("pmtiles", tmp_path / "packs", pin=False)
    assert wrong == [f"{key}-{build}.pmtiles" for key in ("world", "malaysia", "indonesia")]
    assert len(commands) == 3


def test_pinning_writes_each_packs_size_and_sum(
    pinned: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """For a newer build: what's pinned is what was cut, and checking it again passes."""
    monkeypatch.setattr(cut.subprocess, "run", made_by([]))
    assert cut.cut("pmtiles", tmp_path / "packs", pin=True) == []
    packs = json.loads(pinned.read_text(encoding="utf-8"))
    world = (tmp_path / "packs" / f"world-{packs['build']}.pmtiles").read_bytes()
    assert (packs["packs"][0]["size"], packs["packs"][0]["sha256"]) == (
        len(world),
        hashlib.sha256(world).hexdigest(),
    )
    assert pinned.read_bytes().endswith(b"}\n")
    assert b"\r" not in pinned.read_bytes()
    assert cut.cut("pmtiles", tmp_path / "packs", pin=False) == []


def test_each_area_takes_in_its_countries() -> None:
    """Every island's tiles: the areas are the countries' own outlines, unsimplified."""

    def holds(region: str, lon: float, lat: float) -> bool:
        shape = json.loads((cut.HERE / region).read_text(encoding="utf-8"))["geometry"]
        rings = [polygon[0] for polygon in shape["coordinates"]]
        return any(
            min(x for x, _ in ring) <= lon <= max(x for x, _ in ring)
            and min(y for _, y in ring) <= lat <= max(y for _, y in ring)
            for ring in rings
        )

    for lon, lat in (
        (102.24, 6.13),
        (110.35, 1.55),
        (103.85, 1.29),
        (114.94, 4.89),
        (115.24, 5.28),
    ):
        assert holds("malaysia.geojson", lon, lat), (lon, lat)  # Labuan last
    for lon, lat in ((106.85, -6.21), (140.72, -2.53), (100.35, -0.95)):
        assert holds("indonesia.geojson", lon, lat), (lon, lat)
    assert not holds("malaysia.geojson", 106.85, -6.21)
