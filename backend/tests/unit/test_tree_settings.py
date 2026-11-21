"""How married-in families are placed, as each computer chose, down to two ways by the
user's answer of 19 Nov 2026, and three again by their word of 21 Nov 2026:
Fans, Discs and Tucked in. Settled fans stays retired: a computer that chose it has its families
placed as fans, and that's stored, so it doesn't change again. A computer that 0.9.0 moved from
Discs to Fans keeps Fans until Discs is chosen again."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ancestree.domain.graph import TreeSettings
from ancestree.storage.settings import read_tree_settings, write_tree_settings


def _stored(data_dir: Path) -> dict[str, object]:
    path = data_dir / "settings" / "app.json"
    tree: dict[str, object] = json.loads(path.read_text("utf-8"))["tree"]
    return tree


def _choose(data_dir: Path, married_in: str) -> None:
    """The settings file as an earlier version wrote it, with this way chosen, and "me"
    beside it, which no read of the tree's settings may lose."""
    folder = data_dir / "settings"
    folder.mkdir(parents=True)
    tree = {"centre": None, "colours": "generation", "married_in": married_in}
    (folder / "app.json").write_bytes(json.dumps({"tree": tree, "me": {"person": None}}).encode())


def test_settled_fans_retired_are_placed_as_fans_and_stored_so(tmp_path: Path) -> None:
    _choose(tmp_path, "settled")

    read = read_tree_settings(tmp_path)

    assert read.married_in == "fans"
    assert read.colours == "generation"  # nothing else changes
    assert _stored(tmp_path)["married_in"] == "fans"
    saved = json.loads((tmp_path / "settings" / "app.json").read_text("utf-8"))
    assert saved["me"] == {"person": None}


@pytest.mark.parametrize("kept", ["fans", "discs", "tucked"])
def test_the_three_ways_are_read_as_they_are(tmp_path: Path, kept: str) -> None:
    _choose(tmp_path, kept)
    before = (tmp_path / "settings" / "app.json").read_bytes()

    assert read_tree_settings(tmp_path).married_in == kept
    assert (tmp_path / "settings" / "app.json").read_bytes() == before  # nothing written


def test_discs_can_be_chosen_again_and_settled_fans_cannot(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        TreeSettings.model_validate({"married_in": "settled"})
    write_tree_settings(tmp_path, TreeSettings.model_validate({"married_in": "discs"}))
    assert read_tree_settings(tmp_path).married_in == "discs"
    assert _stored(tmp_path)["married_in"] == "discs"
    write_tree_settings(tmp_path, TreeSettings(married_in="tucked"))
    assert read_tree_settings(tmp_path).married_in == "tucked"
