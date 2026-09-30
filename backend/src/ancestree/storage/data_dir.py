"""The data folder: photos, stories and documents."""

from pathlib import Path

SUBFOLDERS = ("people", "settings", "trash", "exports")


def ensure_data_dir(root: Path) -> None:
    for name in SUBFOLDERS:
        (root / name).mkdir(parents=True, exist_ok=True)
