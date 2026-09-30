"""Life stories on disk: the Sources section, the file, pictures."""

from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from hypothesis import given
from hypothesis import strategies as st
from PIL import Image

from ancestree.media.photos import DISPLAY_SIZE, process_picture
from ancestree.services.biography import join_sources, split_sources, version_of
from ancestree.storage import biography as storage


def test_sources_are_the_list_under_the_last_heading() -> None:
    markdown = (
        "He was born in Kota Bharu.\n\n## Sources\n\n- Birth certificate\n- Interview, 2019\n"
    )

    assert split_sources(markdown) == (
        "He was born in Kota Bharu.",
        ["Birth certificate", "Interview, 2019"],
    )


def test_sources_written_elsewhere_are_understood() -> None:
    # Obsidian users may number them, use a smaller heading, or star the items.
    assert split_sources("Story.\n\n### sources\n1. One\n2) Two\n* Three")[1] == [
        "One",
        "Two",
        "Three",
    ]


def test_anything_but_a_list_after_sources_stays_in_the_story() -> None:
    markdown = "Story.\n\n## Sources\n\nMost of this came from Nenek.\n\n- A letter"

    assert split_sources(markdown) == (markdown, [])


def test_the_file_is_the_story_then_the_sources() -> None:
    assert join_sources("Story.\n", ["Birth certificate", "  ", "Two\nlines"]) == (
        "Story.\n\n## Sources\n\n- Birth certificate\n- Two lines\n"
    )
    assert join_sources("", ["Only a source"]) == "## Sources\n\n- Only a source\n"
    assert join_sources("  ", []) == ""


paragraph = st.text(
    alphabet=st.characters(categories=["L", "N"], include_characters=" ,.'"),
    min_size=1,
    max_size=60,
).filter(lambda text: text.strip())
source = st.text(
    alphabet=st.characters(categories=["L", "N"], include_characters=" ,.()'"),
    min_size=1,
    max_size=40,
).filter(lambda text: text.strip())


@given(st.lists(paragraph, max_size=5), st.lists(source, max_size=5))
def test_writing_and_reading_back_gives_the_same_story_and_sources(
    paragraphs: list[str], sources: list[str]
) -> None:
    story = "\n\n".join(p.strip() for p in paragraphs)

    read_back = split_sources(join_sources(story, sources))

    assert read_back == (story.strip(), [" ".join(s.split()) for s in sources])


def test_the_version_follows_the_content() -> None:
    assert version_of(None) == "none"
    assert version_of("a") == version_of("a")
    assert version_of("a") != version_of("b")


def test_the_file_reads_back_whatever_wrote_it(tmp_path: Path) -> None:
    person = uuid4()
    folder = tmp_path / "people" / str(person)
    folder.mkdir(parents=True)
    # Notepad: a byte-order mark and Windows line endings.
    (folder / storage.BIOGRAPHY).write_bytes("﻿Line one\r\nLine two\r\n".encode())

    assert storage.read_story(tmp_path, person) == "Line one\nLine two\n"
    storage.write_story(tmp_path, person, "New story\n")
    assert (folder / storage.BIOGRAPHY).read_bytes() == b"New story\n"
    storage.write_story(tmp_path, person, "  \n")
    assert storage.read_story(tmp_path, person) is None


def test_pictures_get_their_own_names_and_nothing_else_is_served(tmp_path: Path) -> None:
    person = uuid4()
    name = storage.store_picture(tmp_path, person, b"webp")

    assert storage.picture_file(tmp_path, person, name) is not None
    for bad in ("../person.json", "..\\x.webp", "a/b.webp", "x.png", ".hidden.webp", name.upper()):
        assert storage.picture_file(tmp_path, person, bad) is None


@pytest.mark.parametrize("size", [(4000, 3000), (300, 200)])
def test_story_pictures_are_upright_webp_no_bigger_than_needed(size: tuple[int, int]) -> None:
    buffer = BytesIO()
    Image.new("RGB", size, (200, 120, 90)).save(buffer, "JPEG")

    picture = Image.open(BytesIO(process_picture(buffer.getvalue())))

    assert picture.format == "WEBP"
    assert max(picture.size) == min(max(size), DISPLAY_SIZE)
    assert "exif" not in picture.info
