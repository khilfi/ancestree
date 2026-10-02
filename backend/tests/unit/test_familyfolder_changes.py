"""A relative's changes as the family folder carries them: kept on top of what the keeper
publishes, counted, and sent as the whole family. Names are the fictional family's."""

from __future__ import annotations

import base64
import gzip
import json
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from ancestree.familyfolder import changes
from ancestree.familyfolder.changes import (
    UnpackError,
    family_to_send,
    own_changes,
    pack,
    rebased,
    records,
    unpack,
)

HASSAN = "00000000-0000-4000-8000-000000000001"
SITI = "00000000-0000-4000-8000-000000000002"
ALI = "00000000-0000-4000-8000-000000000003"
LINK = "00000000-0000-4000-8000-0000000000a1"


def person(pid: str, name: str, **more: Any) -> dict[str, Any]:
    return {"id": pid, "full_name": name, "gender": "male", **more}


def link(source: str, target: str, lid: str = LINK) -> dict[str, Any]:
    return {
        "type": "PARENT_OF",
        "source": source,
        "target": target,
        "properties": {"id": lid, "kind": "biological"},
    }


def family(*entries: tuple[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {"about": {"name": "Keluarga Contoh"}, "schema": {"version": 9}, **dict(entries)}


RECEIVED = family(
    (f"person/{HASSAN}", person(HASSAN, "Hassan bin Ismail", birth_year=1950)),
    (f"person/{SITI}", person(SITI, "Siti binti Hassan", gender="female")),
    (f"link/{LINK}", link(HASSAN, SITI)),
)


def test_the_keepers_changes_come_in_beneath_this_computers_own() -> None:
    mine = json.loads(json.dumps(RECEIVED))
    mine[f"person/{HASSAN}"]["nickname"] = "Pak Hassan"  # changed here
    now = json.loads(json.dumps(RECEIVED))
    now[f"person/{HASSAN}"]["birth_year"] = 1951  # changed by the keeper, of the same person
    now[f"person/{SITI}"]["nickname"] = "Kak Ti"
    family_here = rebased(RECEIVED, mine, now)
    assert family_here[f"person/{HASSAN}"] == person(
        HASSAN, "Hassan bin Ismail", birth_year=1951, nickname="Pak Hassan"
    )
    assert family_here[f"person/{SITI}"]["nickname"] == "Kak Ti"


def test_someone_added_here_stays_and_someone_the_keeper_took_out_goes() -> None:
    mine = json.loads(json.dumps(RECEIVED))
    mine[f"person/{ALI}"] = person(ALI, "Ali bin Hassan")
    mine["link/l2"] = link(HASSAN, ALI, "l2")
    mine[f"person/{SITI}"]["nickname"] = "Ti"  # changed here
    mine[f"file/people/{SITI}/biography.md"] = {"size": 1, "sha256": "x", "blob": "b"}
    now = {key: value for key, value in RECEIVED.items() if SITI not in key}  # Siti taken out
    family_here = rebased(RECEIVED, mine, now)
    assert f"person/{ALI}" in family_here
    assert "link/l2" in family_here
    assert f"person/{SITI}" not in family_here  # what was changed of her goes with her
    assert f"link/{LINK}" not in family_here
    assert f"file/people/{SITI}/biography.md" not in family_here


def test_once_answered_only_what_came_after_stays_and_where_people_sit_too() -> None:
    sent = json.loads(json.dumps(RECEIVED))
    sent[f"person/{HASSAN}"]["nickname"] = "Pak Hassan"  # sent, and not taken
    sent[f"person/{HASSAN}"]["layout_x"] = 120.0  # moved here before sending
    mine = json.loads(json.dumps(sent))
    mine[f"person/{SITI}"]["occupation"] = "Teacher"  # changed after sending
    family_here = rebased(sent, mine, RECEIVED, arranged_on=RECEIVED)
    assert "nickname" not in family_here[f"person/{HASSAN}"]
    assert family_here[f"person/{HASSAN}"]["layout_x"] == 120.0
    assert family_here[f"person/{SITI}"]["occupation"] == "Teacher"


def test_only_what_the_keeper_would_take_counts_as_changed() -> None:
    here = json.loads(json.dumps(RECEIVED))
    here[f"person/{HASSAN}"] |= {"layout_x": 10.0, "layout_y": 20.0, "updated_at": "2026-10-02"}
    here[f"file/people/{HASSAN}/person.json"] = {"size": 2, "sha256": "y", "blob": "c"}
    here["setting/places"] = {"pins": [1]}
    assert own_changes(RECEIVED, here) == {}
    here[f"person/{SITI}"]["nickname"] = "Ti"
    del here[f"link/{LINK}"]
    assert own_changes(RECEIVED, here) == {
        f"link/{LINK}": None,
        f"person/{SITI}": here[f"person/{SITI}"],
    }


def test_the_family_as_a_copy_to_edit_carries_it() -> None:
    spouse = {
        "type": "SPOUSE_OF",
        "source": HASSAN,
        "target": SITI,
        "properties": {"id": "l3", "status": "married"},
    }
    people, links = records(RECEIVED | {"link/l3": spouse})
    assert people[HASSAN]["full_name"] == "Hassan bin Ismail"
    assert people[HASSAN]["birth_year"] == 1950
    assert links[LINK] == {
        "id": LINK,
        "type": "parent",
        "source": HASSAN,
        "target": SITI,
        "kind": "biological",
        "status": None,
        "order": None,
    }
    assert links["l3"]["type"] == "spouse"
    assert links["l3"]["status"] == "married"


def test_what_is_sent_unpacks_with_a_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict[str, Any] = {"family": {"people": [], "links": []}, "stories": {}}
    assert unpack(pack(sent)) == sent
    with pytest.raises(UnpackError):
        unpack("not base64!")
    with pytest.raises(UnpackError):
        unpack(base64.b64encode(gzip.compress(b"[1, 2]")).decode())
    monkeypatch.setattr(changes, "MOST_SENT", 100)
    with pytest.raises(UnpackError):
        unpack(pack({"long": "x" * 1000}))


def _png(colour: str) -> bytes:
    data = BytesIO()
    Image.new("RGB", (40, 30), colour).save(data, format="PNG")
    return data.getvalue()


def test_only_a_changed_storys_pictures_and_a_changed_photo_are_sent(tmp_path: Path) -> None:
    for pid, words in ((HASSAN, "Hassan's story"), (SITI, "Siti's story")):
        folder = tmp_path / "people" / pid
        (folder / "media").mkdir(parents=True)
        (folder / "biography.md").write_text(
            f"# {words}\n\n![A day out](media/day-out.webp)\n", encoding="utf-8"
        )
        (folder / "media" / "day-out.webp").write_bytes(b"RIFF a made-up picture")
    profile = tmp_path / "people" / SITI / "profile"
    profile.mkdir()
    (profile / "original.png").write_bytes(_png("green"))
    (profile / "crop.json").write_text(
        json.dumps({"x": 0, "y": 0, "width": 100, "height": 100}), encoding="utf-8"
    )

    def story(pid: str, sha: str) -> dict[str, Any]:
        return {"size": 1, "sha256": sha, "blob": sha}

    received = RECEIVED | {
        f"file/people/{HASSAN}/biography.md": story(HASSAN, "a"),
        f"file/people/{SITI}/biography.md": story(SITI, "b"),
        f"file/people/{SITI}/profile/original.png": story(SITI, "c"),
    }
    here = json.loads(json.dumps(received))
    here[f"file/people/{SITI}/biography.md"] = story(SITI, "b2")  # her story changed here
    here[f"file/people/{SITI}/profile/original.png"] = story(SITI, "c2")  # and her photo
    here[f"person/{SITI}"] |= {"has_photo": True, "photo_version": 2}
    sent = family_to_send(here, received, tmp_path)

    assert {person["id"] for person in sent["family"]["people"]} == {HASSAN, SITI}
    assert [item["id"] for item in sent["family"]["links"]] == [LINK]
    assert set(sent["stories"]) == {HASSAN, SITI}  # every story
    assert sent["stories"][SITI]["story"].startswith("# Siti's story")
    assert list(sent["files"]) == [f"/api/persons/{SITI}/media/day-out.webp"]  # hers alone
    assert list(sent["photos"]) == [SITI]
    assert sent["photos"][SITI]["display"].startswith("data:image/webp;base64,")
    assert sent["photos"][SITI]["crop"] == {"x": 0, "y": 0, "width": 100, "height": 100}
