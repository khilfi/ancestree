"""App settings in DATA_DIR/settings/app.json: readable by hand, and part of every backup."""

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ancestree.domain.graph import MeSettings, TreeSettings
from ancestree.domain.kinship import KinshipSettings
from ancestree.domain.map import MapPins
from ancestree.storage.files import write_json


def _path(data_dir: Path) -> Path:
    return data_dir / "settings" / "app.json"


def _read_all(data_dir: Path) -> dict[str, Any]:
    path = _path(data_dir)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def read_tree_settings(data_dir: Path) -> TreeSettings:
    try:
        return TreeSettings.model_validate(_read_all(data_dir).get("tree") or {})
    except ValidationError:
        return TreeSettings()  # edited by hand into something unusable: the defaults


def write_tree_settings(data_dir: Path, settings: TreeSettings) -> None:
    """Only the tree's section changes; anything else in the file is kept."""
    write_json(_path(data_dir), _read_all(data_dir) | {"tree": settings.model_dump(mode="json")})


def read_me(data_dir: Path) -> MeSettings:
    try:
        return MeSettings.model_validate(_read_all(data_dir).get("me") or {})
    except ValidationError:
        return MeSettings()


def write_me(data_dir: Path, settings: MeSettings) -> None:
    """Only the "me" section changes; anything else in the file is kept."""
    write_json(_path(data_dir), _read_all(data_dir) | {"me": settings.model_dump(mode="json")})


def read_kinship_settings(data_dir: Path) -> KinshipSettings:
    try:
        return KinshipSettings.model_validate(_read_all(data_dir).get("kinship") or {})
    except ValidationError:
        return KinshipSettings()


def write_kinship_settings(data_dir: Path, settings: KinshipSettings) -> None:
    """Only the kinship section changes; anything else in the file is kept."""
    section = {"kinship": settings.model_dump(mode="json")}
    write_json(_path(data_dir), _read_all(data_dir) | section)


def read_pins(data_dir: Path) -> MapPins:
    """The places put on the map by hand."""
    try:
        return MapPins.model_validate(_read_all(data_dir).get("places") or {})
    except ValidationError:
        return MapPins()


def write_pins(data_dir: Path, pins: MapPins) -> None:
    """Only the places section changes; anything else in the file is kept."""
    write_json(_path(data_dir), _read_all(data_dir) | {"places": pins.model_dump(mode="json")})
