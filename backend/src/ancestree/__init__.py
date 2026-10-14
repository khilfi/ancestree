"""AncesTree: a private family-history app."""

from importlib.metadata import version
from pathlib import Path


def built_version(package: Path) -> str:
    """This build's own version: written beside the package when the engine is built (0.8.1,
    D76), so the record of an earlier version that an update left beside it can never speak
    for it, as on Windows every update since 0.4.0 did; while developing, as installed."""
    try:
        return (package / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return version("ancestree")


__version__ = built_version(Path(__file__).parent)
