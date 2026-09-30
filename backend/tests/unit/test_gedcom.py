"""GEDCOM 5.5.1 export."""

import re
from datetime import datetime
from typing import NamedTuple

import pytest

from ancestree.domain.dates import parse_partial_date
from ancestree.domain.person import PartialDate
from ancestree.exchange.gedcom import WIDTH, chunks, gedcom_date, write_gedcom
from tests.unit.export_family import NOTES, STORY, sample_family

MADE_AT = datetime(2026, 9, 27, 14, 5, 9)
_LINE = re.compile(r"^(0|[1-9]\d?) (?:(@[A-Za-z0-9_]+@) )?([A-Z_][A-Z0-9_]*)(?: (.*))?$")
_POINTER = re.compile(r"^@[A-Za-z0-9_]+@$")


class Line(NamedTuple):
    level: int
    xref: str | None
    tag: str
    value: str | None


class Written(NamedTuple):
    text: str
    records: dict[str, list[Line]]  # by xref; HEAD and TRLR by their tags
    ids: dict[str, str]  # AncesTree ids by first name
    xrefs: dict[str, str]  # GEDCOM xrefs by first name; "" when not in the file


def parse(text: str) -> list[Line]:
    assert text.endswith("\r\n")
    lines = []
    for raw in text.removesuffix("\r\n").split("\r\n"):
        match = _LINE.match(raw)
        assert match, f"not a GEDCOM line: {raw!r}"
        lines.append(Line(int(match[1]), match[2], match[3], match[4]))
    return lines


def records(lines: list[Line]) -> dict[str, list[Line]]:
    found: dict[str, list[Line]] = {}
    current: list[Line] = []
    for line in lines:
        if line.level == 0:
            current = []
            found[line.xref or line.tag] = current
        current.append(line)
    return found


def text_at(record: list[Line], index: int) -> str:
    """A value with its CONT and CONC lines put back together, and @@ read as @."""
    text = (record[index].value or "").replace("@@", "@")
    for line in record[index + 1 :]:
        if line.level <= record[index].level:
            break
        if line.tag == "CONT":
            text += "\n" + (line.value or "").replace("@@", "@")
        elif line.tag == "CONC":
            text += (line.value or "").replace("@@", "@")
    return text


def values(record: list[Line], tag: str, level: int = 1) -> list[str]:
    return [
        text_at(record, i)
        for i, line in enumerate(record)
        if (line.level, line.tag) == (level, tag)
    ]


def under(record: list[Line], tag: str, sub: str) -> list[str | None]:
    """The value of `sub` under each level-1 `tag`, e.g. BIRT's DATE."""
    found = []
    for i, line in enumerate(record):
        if (line.level, line.tag) != (1, tag):
            continue
        block = []
        for later in record[i + 1 :]:
            if later.level <= 1:
                break
            block.append(later)
        found.append(next((item.value for item in block if item.tag == sub), None))
    return found


@pytest.fixture
def written() -> Written:
    family, ids = sample_family()
    text = write_gedcom(family, made_at=MADE_AT, file_name="family.ged")
    found = records(parse(text))
    xrefs = {
        name: next((x for x, record in found.items() if person in values(record, "REFN")), "")
        for name, person in ids.items()
    }
    return Written(text, found, ids, xrefs)


@pytest.mark.parametrize(
    ("typed", "expected"),
    [
        ("12/3/1950", "12 MAR 1950"),
        ("3/1950", "MAR 1950"),
        ("1950", "1950"),
        ("c. 1950", "ABT 1950"),
        ("about 3/1950", "ABT MAR 1950"),
        ("before 1900", "BEF 1900"),
        ("after 1900", "AFT 1900"),
        ("1910-1915", "BET 1910 AND 1915"),
    ],
)
def test_dates_are_written_the_gedcom_way(typed: str, expected: str) -> None:
    date = parse_partial_date(typed)
    assert date is not None
    assert gedcom_date(date) == expected


def test_a_date_known_only_in_words_is_a_phrase() -> None:
    assert gedcom_date(PartialDate(original_text="in the war (1942)")) == "(in the war [1942])"
    assert gedcom_date(PartialDate(original_text="  ")) is None


def test_the_file_is_well_formed_gedcom(written: Written) -> None:
    lines = parse(written.text)

    assert lines[0] == Line(0, None, "HEAD", None)
    assert lines[-1] == Line(0, None, "TRLR", None)
    assert all(len(raw) <= 255 for raw in written.text.split("\r\n"))
    defined = {line.xref for line in lines if line.xref}
    previous = 0
    for line in lines:
        assert line.level <= previous + 1, line
        previous = line.level
        if line.level == 0 and line.tag not in ("HEAD", "TRLR"):
            assert line.xref, line
        value = line.value or ""
        if _POINTER.match(value):
            assert value in defined, f"{line} points nowhere"
        else:
            assert "@" not in value.replace("@@", ""), f"{line}: a lone @ in text"
    head = written.records["HEAD"]
    assert values(head, "CHAR") == ["UTF-8"]
    assert values(head, "VERS", 2)[-1] == "5.5.1"
    assert values(head, "FORM", 2) == ["LINEAGE-LINKED"]
    assert values(head, "DATE") == ["27 SEP 2026"]


def test_people_keep_their_names_dates_places_notes_and_story(written: Written) -> None:
    hassan = written.records[written.xrefs["Hassan"]]

    assert values(hassan, "NAME") == ["Hassan bin Ismail", "حسن بن إسماعيل"]
    assert values(hassan, "NPFX", 2) == ["Haji"]
    assert values(hassan, "NICK", 2) == ["Acan"]
    assert values(hassan, "TYPE", 2)[0] == "aka"
    assert values(hassan, "SEX") == ["M"]
    assert under(hassan, "BIRT", "DATE") == ["12 MAR 1938"]
    assert under(hassan, "BIRT", "PLAC") == ["Kota Bharu, Kelantan, Malaysia"]
    assert under(hassan, "DEAT", "DATE") == ["2011"]
    assert values(hassan, "OCCU") == ["Station master"]
    assert values(hassan, "NOTE") == [NOTES, STORY]
    assert values(hassan, "REFN") == [written.ids["Hassan"]]
    sources = [values(written.records[x], "TITL") for x in values(hassan, "SOUR")]
    assert sources == [["Birth certificate, 1938"], ["Talk with Nor, 2019"]]
    assert under(written.records[written.xrefs["Siti"]], "DEAT", "DATE") == ["(in the war)"]
    assert under(written.records[written.xrefs["Rahman"]], "BIRT", "DATE") == ["BET 1910 AND 1915"]


def test_families_have_their_couple_and_children_eldest_first(written: Written) -> None:
    xrefs = written.xrefs
    [family] = values(written.records[xrefs["Hassan"]], "FAMC")
    record = written.records[family]

    assert values(record, "HUSB") == [xrefs["Ismail"]]
    assert values(record, "WIFE") == [xrefs["Fatimah"]]
    assert values(record, "MARR") == ["Y"]
    # Aminah was added after Hassan, but born before him.
    assert values(record, "CHIL") == [xrefs["Aminah"], xrefs["Hassan"]]
    assert family in values(written.records[xrefs["Ismail"]], "FAMS")


def test_adoption_is_marked_and_a_guardian_is_an_association(written: Written) -> None:
    xrefs = written.xrefs
    nor = written.records[xrefs["Nor"]]
    [family] = values(nor, "FAMC")

    assert values(nor, "PEDI", 2) == ["adopted"]
    assert values(written.records[family], "CHIL") == [xrefs["Yusof"], xrefs["Nor"]]
    assert values(written.records[xrefs["Yusof"]], "PEDI", 2) == ["birth"]
    assert values(nor, "ASSO") == [xrefs["Latif"]]
    assert values(nor, "RELA", 2) == ["Guardian"]


def test_unknown_parents_stay_out_but_their_children_stay_together(written: Written) -> None:
    xrefs = written.xrefs
    [family] = values(written.records[xrefs["Umar"]], "FAMC")

    assert xrefs["Unknown"] == ""  # not a person in the file
    assert values(written.records[family], "HUSB") == []
    assert values(written.records[family], "WIFE") == []
    assert values(written.records[family], "CHIL") == [xrefs["Umar"], xrefs["Hana"]]


def test_a_divorce_is_recorded(written: Written) -> None:
    [family] = values(written.records[written.xrefs["Rahman"]], "FAMS")
    record = written.records[family]

    assert values(record, "MARR") == ["Y"]
    assert values(record, "DIV") == ["Y"]
    assert values(record, "WIFE") == [written.xrefs["Siti"]]


def test_long_text_is_continued_but_never_cut_beside_a_space() -> None:
    text = " ".join(f"word{n}@home" for n in range(200))

    pieces = chunks(text)

    assert "".join(pieces) == text
    assert len(pieces) > 1
    for piece in pieces:
        assert len(piece.replace("@", "@@")) <= WIDTH
        assert not piece.startswith(" ")
        assert not piece.endswith(" ")
