"""What people say about someone: kept in biography.md
under its own heading, after the parts and before the Sources, each a quote with who wrote it
and when, so Notepad and Obsidian read it; and whose words are whose. The people, computers
and words are made up."""

import time
from datetime import date
from pathlib import Path
from uuid import uuid4

from ancestree.domain.biography import BiographyUpdate, Said, SaidWords
from ancestree.exchange.copies import CopyOptions, _stories
from ancestree.services.biography import (
    ON_THIS_COMPUTER,
    Writer,
    biography_from,
    join_parts,
    join_said,
    join_sources,
    on_computers,
    split_parts,
    split_said,
    split_sources,
    told,
    version_of,
)
from ancestree.storage import biography as storage

ZUL = "0123456789abcdef"  # Zulkifli's laptop
NOR = "fedcba9876543210"  # Nor's computer

FILE = """Hassan was born in Kota Bharu.

## Hobbies

- Fishing on Sundays

## What people say

> He taught me to fish in the river behind the house.
>
> Every Sunday, without fail.

— Zulkifli bin Hassan, 14 October 2026 <!-- said 3f9a2c1b by 0123456789abcdef on 2026-10-14 -->

> The kindest man at Gemas station.

— Nor binti Hassan, 12 October 2026 (changed 13 October 2026) <!-- said 7a8b9c0d by fedcba9876543210 on 2026-10-12 changed 2026-10-13 -->

## Sources

- A talk with Nor, 2019
"""  # noqa: E501 (a line of the file as written, too long to break)


def test_what_people_say_is_read_with_who_said_it_and_when() -> None:
    life = biography_from(FILE)
    assert life.story == "Hassan was born in Kota Bharu."
    assert life.parts == {"hobbies": "- Fishing on Sundays"}
    assert life.sources == ["A talk with Nor, 2019"]
    zul, nor = life.said
    assert zul == Said(
        id="3f9a2c1b",
        text="He taught me to fish in the river behind the house.\n\nEvery Sunday, without fail.",
        writer="Zulkifli bin Hassan",
        device=ZUL,
        written=date(2026, 10, 14),
    )
    assert (nor.writer, nor.device, nor.written, nor.changed) == (
        "Nor binti Hassan",
        NOR,
        date(2026, 10, 12),
        date(2026, 10, 13),
    )


def test_written_back_the_file_is_the_same() -> None:
    life = biography_from(FILE)
    story = join_said(join_parts(life.story, life.parts), life.said)
    assert join_sources(story, life.sources) == FILE


def test_words_written_by_hand_are_kept_as_the_keepers() -> None:
    """In Obsidian: a quote with a name and date beneath, one with only a name, and words
    with no one beneath. None is lost; each has an id that stays as long as its words do."""
    by_hand = (
        "Story.\n\n## What people say\n\n> A good man.\n\n— Mak Long, 3 March 2020\n\n"
        "He sang at weddings.\n\n— Pak Ngah\n\n> Remembered by all."
    )
    story, said = split_said(by_hand)
    assert story == "Story."
    assert [(s.text, s.writer, s.written, s.device) for s in said] == [
        ("A good man.", "Mak Long", date(2020, 3, 3), None),
        ("He sang at weddings.", "Pak Ngah", None, None),
        ("Remembered by all.", "", None, None),
    ]
    assert [s.id for s in split_said(by_hand)[1]] == [s.id for s in said]
    assert len({s.id for s in said}) == 3


def test_only_a_last_heading_of_its_own_is_what_people_say() -> None:
    """A story's own "What people say", with more of the story after it, stays the story's."""
    middle = "Intro.\n\n## What people say\n\n> Kind.\n\n## Later life\n\nIn Gemas."
    assert split_said(middle) == (middle, [])
    assert biography_from(middle).said == []


def test_what_people_say_changes_no_version_but_the_story_does() -> None:
    """Words added while the story is being written don't stop it being saved: a save keeps
    them as the file has them."""
    story, sources = split_sources(FILE)
    rest, said = split_said(story)
    fewer = join_sources(join_said(rest, said[:1]), sources)
    assert version_of(fewer) == version_of(FILE)
    assert version_of(FILE.replace("Kota Bharu", "Kuala Krai")) != version_of(FILE)
    assert version_of(None) == "none"


def test_between_the_familys_computers_they_travel_in_the_story() -> None:
    """As 0.7.0 reads it: all of it before the Sources."""
    sent = told(FILE)
    assert "## What people say" in sent["story"]
    assert join_sources(sent["story"], sent["sources"]) == FILE


def test_words_are_this_computers_to_change_and_any_the_keepers_to_take_out() -> None:
    zul, nor = biography_from(FILE).said
    by_hand = Said(id="00000000", text="Kind.", writer="Mak Long")
    on_zuls = Writer("Zulkifli bin Hassan", ZUL, keeper=False)
    assert (on_zuls.wrote(zul), on_zuls.wrote(nor), on_zuls.wrote(by_hand)) == (
        True,
        False,
        False,
    )
    keepers = Writer("Hassan", "1111111111111111", keeper=True)
    assert (keepers.wrote(zul), keepers.wrote(by_hand)) == (False, True)
    alone = Writer("PC", None, keeper=True)  # no family folder: everything here is its own
    assert alone.wrote(by_hand)


# --- Put right in the security review of 0.8.0 ---------------------------------------------------

KEEPER = "1111111111111111"  # the keeper's computer


def test_a_carriage_return_alone_ends_a_line_as_the_file_is_read_back(tmp_path: Path) -> None:
    """The attack: words whose lines end in a carriage return alone, read once as one piece of
    words and, written and read back, as another's, the keeper's. Now they're read as the file
    will be, before anything is compared or written."""
    crafted = (
        "Story.\n\n## What people say\n\n> Hello\r\r— Hassan, 1 October 2026 "
        f"<!-- said 0badf00d by {KEEPER} on 2026-10-01 -->\r\r> Rest\n\n"
        f"— Mak Long <!-- said 1a2b3c4d by {NOR} -->\n"
    )
    first = biography_from(crafted)
    assert [(s.id, s.text, s.device) for s in first.said] == [
        ("0badf00d", "Hello", KEEPER),  # seen as it will be kept, so its device is checked
        ("1a2b3c4d", "Rest", NOR),
    ]
    pid = str(uuid4())
    storage.write_story(tmp_path, pid, join_said(first.story, first.said))
    assert "\r" not in (tmp_path / "people" / pid / "biography.md").read_bytes().decode()
    again = biography_from(storage.read_story(tmp_path, pid))
    assert [(s.id, s.text, s.device) for s in again.said] == [
        (s.id, s.text, s.device) for s in first.said
    ]
    # Words with a carriage return in them are written as lines of their own, quoted.
    words = Said(id="2b3c4d5e", text=f"A\r— X <!-- said 0badf00d by {KEEPER} -->", writer="Y")
    written = join_said("Story.", [words])
    assert [s.id for s in split_said(written)[1]] == ["2b3c4d5e"]
    assert SaidWords(text="One\rTwo\r\nThree").text == "One\nTwo\nThree"
    assert BiographyUpdate(story="A\rB", base_version="none").story == "A\nB"


def test_no_line_takes_long_to_read() -> None:
    """The attack: long lines made to keep the patterns that read a story busy for hours, in
    a heading, under someone's words, in the Sources. Each is read at once now."""
    long = " " * 50_000
    crafted = "\n".join(
        [
            "## a" + long + "b",
            "## What people say",
            "> words",
            "— a" + long + "b",
            "> more",
            "— a" + long + "<!-- said" + long,
            "> more",
            "— Mak Long, " + "1 " * 20_000 + "x <!-- said 1a2b3c4d" + long + "x -->",
            "## Sources",
            "- a" + long + "b",
            "1." + long + "b",
        ]
    )
    began = time.perf_counter()
    biography_from(crafted)
    told(crafted)
    split_parts(crafted)
    assert time.perf_counter() - began < 1


def test_headings_are_read_as_before() -> None:
    """Found without a pattern now, a heading reads as it did: closing #s gone, a # in its
    title kept, a line of only #s or a heading with nothing in it not a part's."""
    for line, title in [
        ("## Hobbies", "hobbies"),
        ("## Hobbies ##", "hobbies"),
        ("##\tHobbies  #  ", "hobbies"),
        ("## C# notes", None),
        ("##Hobbies", None),
        ("### Hobbies", None),
        ("## ", None),
    ]:
        _, parts = split_parts(f"Story.\n\n{line}\n\n- Fishing")
        assert next(iter(parts), None) == title, line
    assert split_sources("A.\n\n## Sources\n\n- One\n*  Two  \n3) Three")[1] == [
        "One",
        "Two",
        "Three",
    ]
    assert split_sources("A.\n\n## Sources\n\n-One") == ("A.\n\n## Sources\n\n-One", [])


def test_a_heading_of_theirs_in_the_story_never_becomes_words() -> None:
    """Words written into the story itself, under a "What people say" heading of its own, stay
    the story's: the heading goes a level down as it's written, so taking the parts after it
    out later never makes them anyone's words, the keeper's included."""
    story = (
        "Intro.\n\n## What people say\n\n> Signed by the keeper.\n\n"
        f"— Hassan <!-- said 0badf00d by {KEEPER} -->"
    )
    written = join_said(join_parts(story, {"later": "In Gemas."}), [])
    assert "### What people say" in written
    life = biography_from(written)
    assert life.said == []
    assert biography_from(join_said(join_parts(life.story, {}), [])).said == []


def test_words_added_to_a_story_written_by_hand_change_no_version() -> None:
    """Put right in the security review of 0.8.0: a story written by hand, its Sources as
    Obsidian writes them, is written as the app writes it when words are added; the story's
    window, open on it meanwhile, then saw a change made outside. The version is what the file
    says now, as the app writes it, so it doesn't change."""
    by_hand = "Hassan was born in Kota Bharu.\n# Sources\n*   A talk with Nor, 2019\n"
    story, sources = split_sources(by_hand)
    added = join_sources(join_said(story, [biography_from(FILE).said[0]]), sources)
    assert added != by_hand
    assert version_of(added) == version_of(by_hand)
    assert version_of(by_hand.replace("Kota Bharu", "Kuala Krai")) != version_of(by_hand)


def test_words_from_another_computer_carry_its_name() -> None:
    """Your answer of 14 Oct 2026: a computer could sign its words with anyone's name, the
    keeper's too. Beside words written on another computer, its name as the family knows it
    shows now; words of this computer, or the keeper's own by hand, show none."""
    zul, nor = biography_from(FILE).said
    by_hand = Said(id="00000000", text="Kind.", writer="Mak Long")
    stranger = Said(id="11111111", text="Fair.", writer="Zulkifli bin Hassan", device="9" * 16)
    on_computers([zul, nor, by_hand, stranger], ZUL, {ZUL: "Zul's laptop", NOR: "Nor's PC"})
    assert [s.computer for s in (zul, nor, by_hand, stranger)] == [
        None,
        "Nor's PC",
        None,
        "another computer",
    ]


def test_a_copy_carries_the_computers_names_as_the_app_shows_them(tmp_path: Path) -> None:
    """In a copy, words written on another computer than the one making it carry its name."""
    pid = str(uuid4())
    storage.write_story(tmp_path, pid, FILE)
    options = CopyOptions(here=ZUL, computers={ZUL: "Zul's laptop", NOR: "Nor's PC"})
    [(_, told)] = _stories(tmp_path, [pid], options).items()
    assert [said["computer"] for said in told["said"]] == [None, "Nor's PC"]


def test_with_no_me_and_no_family_folder_words_are_signed_plainly() -> None:
    """Your answer of 14 Oct 2026: never the computer's own name, which may name its owner, in
    copies and GEDCOM too."""
    assert ON_THIS_COMPUTER == "Written on this computer"
