import base64
import zlib
from pathlib import Path
from urllib.parse import quote

import pytest

from ancestree.domain.person import Gender, Place
from ancestree.importing.names import (
    gender_from_name,
    match_key,
    split_nickname,
    tidy_capitals,
    with_apostrophes,
)
from ancestree.importing.sources import SourceError, read_csv, read_drawio
from tests.import_fixtures import CHART, CSV


def test_capitals_are_added_only_to_words_typed_in_lower_case() -> None:
    assert tidy_capitals("Danial bin aiman") == "Danial bin Aiman"
    assert tidy_capitals("Nora BINTI zakaria") == "Nora BINTI Zakaria"
    assert tidy_capitals("yasmin") == "Yasmin"


def test_names_match_whatever_the_case_spacing_apostrophes_or_nickname() -> None:
    assert match_key("Rosli  bin Kamal (Tok Li)") == match_key("ROSLI BIN KAMAL")
    assert match_key("Ja`far*") == match_key("ja'far")


def test_bin_binti_and_titles_tell_the_gender() -> None:
    assert gender_from_name("Aiman Bin Rosli") is Gender.MALE
    assert gender_from_name("Nora binti Zakaria") is Gender.FEMALE
    assert gender_from_name("Hajah Aminah") is Gender.FEMALE
    assert gender_from_name("Salmah") is None


def test_nicknames_in_brackets_and_backticks_as_apostrophes() -> None:
    assert split_nickname("Haris (Pak Long)") == ("Haris", "Pak Long")
    assert with_apostrophes("Ja`far") == "Ja'far"


def test_the_spreadsheet_gives_people_their_parents_places_and_whether_living() -> None:
    source = read_csv(CSV)

    by_name = {person.name: person for person in source.people}
    rosli = by_name["Rosli Bin Kamal"]
    assert (rosli.key, rosli.nickname, rosli.gender, rosli.birth_text, rosli.living) == (
        "csv:4",
        "Li",
        Gender.MALE,
        "1/1/1950",
        False,
    )
    assert rosli.birth_place == Place(town="Ipoh", state="Perak")
    assert by_name["Hashim Bin Ali"].gender is Gender.MALE  # "male" in lower case
    assert by_name["Nora binti zakaria"].residence is None
    claims = {(claim.child, claim.name, claim.role) for claim in source.parent_claims}
    assert ("csv:4", "Wati Binti Omar", "father") in claims
    assert any("'age' and 'status'" in notice for notice in source.notices)


def test_the_chart_gives_marriages_with_their_children_left_to_right() -> None:
    source = read_drawio(CHART)

    names = {person.key: person.name for person in source.people}
    families = {
        tuple(names[s] for s in marriage.spouses): [names[c] for c in marriage.children]
        for marriage in source.marriages
    }
    assert families[("Kamal Bin Daud", "Kalsom Binti Yusof")] == [
        "Rosli Bin Kamal",
        "Salmah",
        "Ja`far*",
    ]
    assert families[("Rosli Bin Kamal", "Suraya Binti Hashim")] == [
        "Balqis Binti Rosli",
        "Aiman Bin Rosli",
    ]
    assert families[("Salmah", None)] == ["Umar", "Hana", None]  # blank boxes
    assert families[("Hashim Bin Ali",)] == ["Suraya Binti Hashim"]
    assert families[("Idris Bin Musa", "Balqis Binti Rosli")] == []
    assert families[("Ahmad", "Ahmad")] == ["Siti", "Nur"]  # drawn inside a group
    rosli = next(person for person in source.people if person.name == "Rosli Bin Kamal")
    assert rosli.nickname == "Tok Li"
    notices = " ".join(source.notices)
    assert "between 'Umar' and 'Hana' doesn't go through a Kahwin circle" in notices
    assert "'Draft: check with Mak' isn't joined to any Kahwin circle" in notices


def test_a_compressed_chart_page_is_unpacked(tmp_path: Path) -> None:
    model = (
        '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
        '<mxCell id="a" value="Adam" vertex="1" parent="1"><mxGeometry x="0" y="0"/></mxCell>'
        '<mxCell id="k" value="Kahwin" vertex="1" parent="1"><mxGeometry x="0" y="90"/></mxCell>'
        '<mxCell id="c" value="Cain" vertex="1" parent="1"><mxGeometry x="0" y="200"/></mxCell>'
        '<mxCell id="e1" edge="1" parent="1" source="a" target="k"/>'
        '<mxCell id="e2" edge="1" parent="1" source="k" target="c"/>'
        "</root></mxGraphModel>"
    )
    packer = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = packer.compress(quote(model, safe="").encode()) + packer.flush()
    chart = tmp_path / "packed.drawio"
    chart.write_text(
        f'<mxfile><diagram id="p" name="Page-1">{base64.b64encode(packed).decode()}</diagram>'
        "</mxfile>",
        encoding="utf-8",
    )

    [marriage] = read_drawio(chart).marriages

    assert (marriage.spouses, marriage.children) == (("drawio:a",), ("drawio:c",))


def test_a_file_that_is_not_a_chart_is_explained(tmp_path: Path) -> None:
    broken = tmp_path / "broken.drawio"
    broken.write_text("<mxfile><diagram>", encoding="utf-8")

    with pytest.raises(SourceError, match=r"Couldn't read broken\.drawio"):
        read_drawio(broken)
