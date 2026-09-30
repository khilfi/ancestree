"""Life stories on disk: `biography.md` in the person's folder,
and the pictures used in it under `media/`.

The story is plain Markdown, readable in Notepad or Obsidian. Picture names are generated
here, never taken from uploads, and every write is atomic.
"""

import re
import secrets
from datetime import date
from pathlib import Path
from uuid import UUID

from ancestree.storage.files import atomic_write, person_dir

BIOGRAPHY = "biography.md"
MEDIA = "media"
_PICTURE = re.compile(r"^[0-9a-z][0-9a-z-]{0,80}\.webp$")
# A picture as a story shows it: ![caption](media/2026-09-27-4f3a9c.webp)
_SHOWN = re.compile(r"(?<![^\s(\"'])media/([0-9a-z][0-9a-z-]{0,80}\.webp)")


def read_story(data_dir: Path, person_id: UUID | str) -> str | None:
    """The file as it is now, however it was last written; None if there's none."""
    path = person_dir(data_dir, person_id) / BIOGRAPHY
    if not path.is_file():
        return None
    # utf-8-sig: Notepad may have added a byte-order mark.
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def write_story(data_dir: Path, person_id: UUID | str, text: str) -> None:
    """Replace the story; an empty one removes the file."""
    path = person_dir(data_dir, person_id) / BIOGRAPHY
    if text.strip():
        atomic_write(path, text.encode("utf-8"))
    else:
        path.unlink(missing_ok=True)


def store_picture(data_dir: Path, person_id: UUID | str, webp: bytes) -> str:
    """Keep a picture for the story; return its file name, e.g. "2026-09-27-4f3a9c.webp"."""
    media = person_dir(data_dir, person_id) / MEDIA
    while True:
        name = f"{date.today():%Y-%m-%d}-{secrets.token_hex(3)}.webp"
        if not (media / name).exists():
            atomic_write(media / name, webp)
            return name


def picture_file(data_dir: Path, person_id: UUID | str, name: str) -> Path | None:
    """One of the story's pictures, by the name the story uses; None for anything else."""
    if not _PICTURE.match(name):
        return None
    path = person_dir(data_dir, person_id) / MEDIA / name
    return path if path.is_file() else None


def pictures_in(story: str) -> list[str]:
    """The names of the pictures a story shows, in order. Pictures taken out of the story stay
    in media/, but aren't among them."""
    return list(dict.fromkeys(_SHOWN.findall(story)))
