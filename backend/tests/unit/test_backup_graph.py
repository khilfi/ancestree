"""A family read from a backup without restoring it: its graph.json alone, checked as
a restore checks it, and seated as the tree seats it; nothing written; a false, damaged or
oversized archive refused."""

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest

from ancestree.exchange import restore
from ancestree.exchange.backup import write_archive
from ancestree.exchange.restore import ArchiveError, read_graph
from ancestree.services.graph import graph_from_archive

HASSAN = "00000000-0000-4000-8000-000000000001"
MARIAM = "00000000-0000-4000-8000-000000000002"
YUSOF = "00000000-0000-4000-8000-000000000003"


def archived() -> dict[str, Any]:
    """A family as a backup's graph.json holds it: each person's and link's own properties."""
    return {
        "schema_version": 1,
        "people": [
            {
                "id": HASSAN,
                "full_name": "Hassan bin Ismail",
                "gender": "male",
                "birth_year": 1938,
                "has_photo": True,
                "photo_version": 2,
                "layout_x": 10.5,
                "layout_y": -3.0,
            },
            {
                "id": MARIAM,
                "full_name": "Mariam binti Salleh",
                "gender": "female",
                "photo_version": 7,
            },
            {"id": YUSOF, "full_name": "Yusof bin Hassan", "gender": "male", "birth_year": 1965},
        ],
        "links": [
            {
                "type": "SPOUSE_OF",
                "source": HASSAN,
                "target": MARIAM,
                "properties": {"id": "00000000-0000-4000-8000-0000000000a1", "status": "married"},
            },
            *(
                {
                    "type": "PARENT_OF",
                    "source": parent,
                    "target": YUSOF,
                    "properties": {"id": link, "kind": "biological"},
                }
                for parent, link in (
                    (HASSAN, "00000000-0000-4000-8000-0000000000a2"),
                    (MARIAM, "00000000-0000-4000-8000-0000000000a3"),
                )
            ),
        ],
        "relationship_kinds": [
            {"key": "biological", "in_layout": True},
            {"key": "guardian", "in_layout": False},
        ],
    }


def files_in(folder: Path) -> set[Path]:
    return {path for path in folder.rglob("*") if path.is_file()}


def test_a_backups_family_is_read_and_seated_without_restoring_anything(tmp_path: Path) -> None:
    made = write_archive(archived(), tmp_path / "data", tmp_path / "backups")
    before = files_in(tmp_path)

    with made.path.open("rb") as file:
        family = read_graph(file, made.path.name)
    graph = graph_from_archive(family)

    assert family == archived()
    assert files_in(tmp_path) == before  # nothing unpacked, nothing kept
    people = {str(person.id): person for person in graph.people}
    assert people[HASSAN].full_name == "Hassan bin Ismail"
    assert (people[HASSAN].x, people[HASSAN].y) == (10.5, -3.0)  # where it was dragged to
    assert people[HASSAN].photo_version == 2
    assert people[MARIAM].photo_version is None  # a version, but no photo
    assert {link.type for link in graph.links} == {"spouse", "parent"}
    seats = {str(person): seat for person, seat in graph.layout.seats.items()}
    assert str(graph.layout.units[0].centre[0]) == HASSAN  # the oldest, at the centre
    assert str(seats[MARIAM].partner_of) == HASSAN
    assert seats[YUSOF].generation == 2


def zipped(entries: dict[str, bytes]) -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    buffer.seek(0)
    return buffer


def test_a_false_or_damaged_archive_is_refused(tmp_path: Path) -> None:
    for false in (io.BytesIO(b"not a zip"), zipped({}), zipped({"graph.json": b"{}"})):
        with pytest.raises(ArchiveError, match=r"isn't an AncesTree backup|can't be read"):
            read_graph(false, "family.zip")

    made = write_archive(archived(), tmp_path / "data", tmp_path / "backups")
    with zipfile.ZipFile(made.path) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    changed = json.loads(entries["graph.json"])
    changed["people"][0]["full_name"] = "Someone else"
    entries["graph.json"] = json.dumps(changed).encode()
    with pytest.raises(ArchiveError, match="doesn't match its checksum"):
        read_graph(zipped(entries), made.path.name)


def test_a_family_that_doesnt_hang_together_is_refused(tmp_path: Path) -> None:
    family = archived()
    family["links"][0]["target"] = "00000000-0000-4000-8000-0000000000ff"  # nobody
    made = write_archive(family, tmp_path / "data", tmp_path / "backups")
    with made.path.open("rb") as file, pytest.raises(ArchiveError, match="hang together"):
        read_graph(file, made.path.name)


def test_an_archive_too_big_to_be_a_familys_is_refused_before_its_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    made = write_archive(archived(), tmp_path / "data", tmp_path / "backups")
    monkeypatch.setattr(restore, "MOST_GRAPH", 100)  # far below this family's graph.json
    with made.path.open("rb") as file, pytest.raises(ArchiveError, match="larger than any"):
        read_graph(file, made.path.name)
