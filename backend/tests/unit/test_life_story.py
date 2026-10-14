"""The life story's parts: each under its own heading in
biography.md, after the story and before the Sources; a story written before, or in Obsidian,
read as it was; and the whole of it travelling between the family's computers as every version
reads it. The people and their words are made up."""

from ancestree.services.biography import (
    biography_from,
    join_parts,
    join_sources,
    split_parts,
    split_sources,
    told,
)

STORY = "Hassan was born in Kota Bharu.\n\n## His work\n\nStation master at Gemas."
FILE = """Hassan was born in Kota Bharu.

## His work

Station master at Gemas.

## Notable accomplishments

- Built the surau at Kampung Laut
- Forty years with the railway

## Early life

A childhood by the river.

![The house, 1945](media/2026-10-14-4f3a9c.webp)

## Sayings and quotes

- Sabar itu separuh daripada iman — to his children, often
- Jangan lupa asal usul

## A message to the next generations

Look after one another.

## Sources

- Birth certificate, 1938
"""


def test_the_parts_are_read_from_their_headings_after_the_story() -> None:
    life = biography_from(FILE)
    assert life.story == STORY  # its own heading stays the story's
    assert life.parts == {
        "accomplishments": "- Built the surau at Kampung Laut\n- Forty years with the railway",
        "early": "A childhood by the river.\n\n![The house, 1945](media/2026-10-14-4f3a9c.webp)",
        "sayings": "- Sabar itu separuh daripada iman — to his children, often\n"
        "- Jangan lupa asal usul",
        "message": "Look after one another.",
    }
    assert life.sources == ["Birth certificate, 1938"]


def test_written_back_the_file_is_the_same() -> None:
    life = biography_from(FILE)
    assert join_sources(join_parts(life.story, life.parts), life.sources) == FILE


def test_the_parts_go_in_their_order_and_an_empty_one_goes() -> None:
    text = join_parts("Their story.", {"talents": "- Whistling", "early": "", "hobbies": "- Kites"})
    assert text == "Their story.\n\n## Hobbies\n\n- Kites\n\n## Hidden talents\n\n- Whistling"
    assert join_parts("", {}) == ""


def test_a_heading_inside_a_part_goes_a_level_down_so_the_parts_read_back() -> None:
    """Written as a part's own heading, "## Kampung days" would end the parts when the file is
    read again, and Early life would be read as the story's."""
    early = "By the river.\n\n## Kampung days\n\nKites.\n\n### Teachers"
    text = join_parts("Their story.", {"early": early, "hobbies": "- Kites"})
    lower = "By the river.\n\n### Kampung days\n\nKites.\n\n### Teachers"
    assert split_parts(text) == ("Their story.", {"early": lower, "hobbies": "- Kites"})


def test_a_story_written_before_is_read_whole() -> None:
    """A part's heading in the middle, with the story's own after it, stays in the story; a
    heading after the parts ends them; so does a part's second heading."""
    middle = "Intro.\n\n## Early life\n\nAs a boy.\n\n## The war years\n\nHard times."
    assert split_parts(middle) == (middle, {})
    again = "## Hobbies\n\n- Kites\n\n## Hobbies\n\n- Fishing"
    assert split_parts(again) == ("## Hobbies\n\n- Kites", {"hobbies": "- Fishing"})
    plain = "Born in 1938. Married in 1960."
    assert split_parts(plain) == (plain, {})


def test_headings_are_read_as_written_elsewhere() -> None:
    """Obsidian's or Notepad's way: other capitals, closing hashes, a part left empty."""
    story, parts = split_parts("Story.\n\n## early LIFE ##\n\nBy the river.\n\n## Hobbies\n")
    assert (story, parts) == ("Story.", {"early": "By the river."})


def test_between_the_familys_computers_the_story_travels_whole() -> None:
    """A relative's computer sends all of it before the Sources, parts and all, as 0.7.0 and
    every version reads it; the keeper's writes it back as it was."""
    sent = told(FILE)
    assert sent["story"] == split_sources(FILE)[0]
    assert "## Notable accomplishments" in sent["story"]
    assert join_sources(sent["story"], sent["sources"]) == FILE
    assert sent["version"] == biography_from(FILE).version
