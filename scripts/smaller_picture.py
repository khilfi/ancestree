"""A picture for the guide, made smaller: 256 colours, as the guide's pictures are, saved as an
optimised PNG, with Pillow (a dependency of the backend's already). The guide's walk
(frontend/journeys/guide/) runs it for each picture it takes, from backend/:

    uv run python ../scripts/smaller_picture.py <taken.png> <public/guide/name.png>
"""

import sys
from pathlib import Path

from PIL import Image


def smaller(taken: Path, into: Path) -> tuple[int, int]:
    """`taken` made smaller into `into`: its size in pixels, the same as before."""
    with Image.open(taken) as opened:
        picture = opened.convert("RGB")
    # Median cut keeps the few colours of the app's text and lines exact; dithering stands in
    # for the colours between them, in photos and the map's land and sea.
    fewer = picture.quantize(
        colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG
    )
    into.parent.mkdir(parents=True, exist_ok=True)
    fewer.save(into, optimize=True)
    return picture.size


def main(arguments: list[str]) -> int:
    if len(arguments) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    taken, into = Path(arguments[0]), Path(arguments[1])
    width, height = smaller(taken, into)
    print(f"{width}x{height}, {taken.stat().st_size:,} bytes taken, {into.stat().st_size:,} kept")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
