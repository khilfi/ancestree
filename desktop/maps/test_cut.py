"""Cutting the map's packs: what the Map packs workflow asks of Protomaps' pmtiles
program, a group at a time, and its check against the app's pins, which stops a pack that isn't
the one pinned; and the pinning run's sizes and sums, merged into packs.json. From backend/:
    uv run pytest ../desktop/maps
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


def packs() -> dict[str, Any]:
    return json.loads(cut.PINNED.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_each_pack_is_cut_from_the_pinned_build_to_its_zooms_and_area() -> None:
    listed = packs()
    build = listed["build"]
    by_key = {pack["key"]: pack for pack in listed["packs"]}
    target, areas = Path("packs") / "x.pmtiles", Path("areas")
    assert cut.command("pmtiles", by_key["world"], build, target, areas) == [
        "pmtiles",
        "extract",
        f"https://build.protomaps.com/{build}.pmtiles",
        str(target),
        "--minzoom=0",
        "--maxzoom=6",
    ]
    words = cut.command("pmtiles", by_key["my"], build, target, areas)
    assert words[4:] == ["--minzoom=7", "--maxzoom=14", f"--region={areas / 'my.geojson'}"]
    assert cut.command("pmtiles", by_key["de"], build, target, areas)[5] == "--maxzoom=13"


def test_every_country_is_listed_and_every_pack_in_one_group() -> None:
    """The world first; every country in the list has its packs, whole or by state; and each
    pack is in one group, none of them over what a machine holds."""
    listed = packs()
    assert listed["packs"][0]["key"] == "world"
    countries = {country["key"] for country in listed["countries"]}
    assert {pack["country"] for pack in listed["packs"][1:]} == countries
    assert {"my", "id", "sg", "bn", "us-tx", "ru-mow"} <= {pack["key"] for pack in listed["packs"]}
    grouped = cut.groups(listed)
    keys = [key for group in grouped.values() for key in group]
    assert sorted(keys) == sorted(pack["key"] for pack in listed["packs"])
    size = {pack["key"]: pack["size"] for pack in listed["packs"]}
    assert all(sum(size[key] for key in group) <= cut.GROUP for group in grouped.values())
    assert grouped["world"] == ["world"]
    assert "seven-seas-1" in grouped


def test_a_pack_that_isnt_the_one_pinned_is_not_published(
    pinned: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []
    monkeypatch.setattr(cut.subprocess, "run", made_by(commands))
    build = packs()["build"]
    wrong = cut.cut("pmtiles", tmp_path / "areas", tmp_path / "packs", "oceania-1", None)
    group = cut.groups(packs())["oceania-1"]
    assert wrong == [f"{key}-{build}.pmtiles" for key in group]
    assert len(commands) == len(group)


def test_pinning_writes_each_packs_size_and_sum_which_then_check(
    pinned: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """For a newer build: the pinning run's sizes and sums merged into packs.json, then cutting
    again checks against them, and passes."""
    monkeypatch.setattr(cut.subprocess, "run", made_by([]))
    areas, folder = tmp_path / "areas", tmp_path / "packs"
    pins = tmp_path / "pins-oceania-1.json"
    assert cut.cut("pmtiles", areas, folder, "oceania-1", pins) == []
    assert cut.merge([pins]) == len(cut.groups(packs())["oceania-1"])
    listed = packs()
    first = cut.groups(listed)["oceania-1"][0]
    made = (folder / f"{first}-{listed['build']}.pmtiles").read_bytes()
    [pack] = [pack for pack in listed["packs"] if pack["key"] == first]
    assert (pack["size"], pack["sha256"]) == (len(made), hashlib.sha256(made).hexdigest())
    assert pinned.read_bytes().endswith(b"}\n")
    assert b"\r" not in pinned.read_bytes()
    assert cut.cut("pmtiles", areas, folder, "oceania-1", None) == []


def test_pins_from_another_build_are_refused(pinned: Path, tmp_path: Path) -> None:
    pins = tmp_path / "pins.json"
    pins.write_text(json.dumps({"build": "19990101", "packs": {}}), encoding="utf-8")
    with pytest.raises(SystemExit, match="19990101"):
        cut.merge([pins])


def test_a_continents_name_as_its_groups_begin() -> None:
    assert cut.slug("Seven seas (open ocean)") == "seven-seas"
    assert cut.slug("North America") == "north-america"
