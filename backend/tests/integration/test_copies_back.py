"""Changes back from a copy to edit: made-up relatives' copies,
edited as the copy edits them, come back through the review, and every change lands exactly as
approved. A tampered file changes nothing you didn't approve; Take back undoes it all.

A copy to edit is made by the app itself (Export → Copy to edit); a relative's changes are made
to its family here, as the copy's own code makes them (frontend/src/copyedit/book.ts)."""

import base64
import io
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4, uuid7

import httpx
import pytest
from neo4j import AsyncDriver
from PIL import Image

from ancestree.config import Settings
from ancestree.exchange.backup import create_backup
from ancestree.exchange.copies import page, read_page, seal, unseal
from ancestree.seed.loader import load_seed
from ancestree.storage.copies import read_brought
from tests.integration.test_copies import (
    APP,
    copy_app,  # noqa: F401 - the copy's app stands in here too
)

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

PASSWORD = "kunci rahsia keluarga"


# --- A relative, editing their copy -------------------------------------------------------------


class Copy:
    """A copy to edit's family, changed as the copy changes it."""

    def __init__(self, snapshot: dict[str, Any], password: str | None = None) -> None:
        self.snapshot = snapshot
        self.password = password

    @property
    def people(self) -> list[dict[str, Any]]:
        people: list[dict[str, Any]] = self.snapshot["family"]["people"]
        return people

    @property
    def links(self) -> list[dict[str, Any]]:
        links: list[dict[str, Any]] = self.snapshot["family"]["links"]
        return links

    def id(self, name: str) -> str:
        return next(str(p["id"]) for p in self.people if p["full_name"] == name)

    def person(self, name: str) -> dict[str, Any]:
        return next(p for p in self.people if p["full_name"] == name)

    def link(self, link_type: str, a: str, b: str) -> dict[str, Any]:
        ends = {self.id(a), self.id(b)}
        return next(
            link
            for link in self.links
            if link["type"] == link_type and {link["source"], link["target"]} == ends
        )

    def change(self, name: str, **props: Any) -> None:
        self.person(name).update(props)

    def add(self, name: str, **props: Any) -> str:
        pid = str(uuid7())
        self.people.append(
            {
                "id": pid,
                "full_name": name,
                "gender": "unknown",
                "placeholder": False,
                "has_photo": False,
                **props,
            }
        )
        return pid

    def link_up(self, link_type: str, source: str, target: str, **props: Any) -> str:
        lid = str(uuid7())
        self.links.append(
            {
                "id": lid,
                "type": link_type,
                "source": source,
                "target": target,
                "kind": "biological" if link_type == "parent" else None,
                "status": "married" if link_type == "spouse" else None,
                "order": None,
                **props,
            }
        )
        return lid

    def remove(self, name: str) -> None:
        pid = self.id(name)
        self.snapshot["family"]["people"] = [p for p in self.people if p["id"] != pid]
        self.snapshot["family"]["links"] = [
            link for link in self.links if pid not in (link["source"], link["target"])
        ]

    def unlink(self, link: dict[str, Any]) -> None:
        self.snapshot["family"]["links"] = [x for x in self.links if x["id"] != link["id"]]

    def tell(self, name: str, story: str, sources: list[str], pictures: dict[str, str]) -> None:
        pid = self.id(name)
        self.snapshot["stories"][pid] = {"story": story, "sources": sources, "version": "copy"}
        for picture, data in pictures.items():
            self.snapshot["files"][f"/api/persons/{pid}/media/{picture}"] = data

    def photo(self, name: str, data: str) -> None:
        person = self.person(name)
        person["has_photo"] = True
        person["photo_version"] = (person.get("photo_version") or 0) + 1
        self.snapshot["photos"][person["id"]] = {
            "display": data,
            "crop": {"x": 0, "y": 0, "width": 100, "height": 100},
        }
        self.snapshot["files"][f"/api/persons/{person['id']}/photo/avatar?size=128"] = data

    def saved(self, when: datetime) -> bytes:
        """The page Save a new copy writes: locked again if it was."""
        self.snapshot["about"]["editing"]["saved_at"] = when.isoformat()
        return page(APP, seal(self.snapshot, self.password)).encode("utf-8")


def webp(colour: tuple[int, int, int], size: int = 400) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), colour).save(buffer, "WEBP")
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


async def made(client: httpx.AsyncClient, password: str | None = None, **may: bool) -> Copy:
    """Export → Copy to edit, for Mak Long, and the page as it's sent."""
    request = {
        "format": "copy",
        "title": "Keluarga Contoh",
        "editable": True,
        "for_name": "Mak Long",
        "password": password,
        "may": {
            "add": True,
            "change": True,
            "remove": True,
            "stories": True,
            "photos": True,
            **may,
        },
    }
    export = await client.post("/api/exports", json=request)
    assert export.status_code == 201, export.text
    download = await client.get(f"/api/exports/{export.json()['name']}")
    return Copy(unseal(read_page(download.text), password), password)


async def preview(
    client: httpx.AsyncClient, data: bytes, password: str | None = None, answers: Any = None
) -> httpx.Response:
    form = {"answers": json.dumps(answers or {})}
    if password is not None:
        form["password"] = password
    return await client.post(
        "/api/imports/copy/preview", files={"file": ("back.html", data, "text/html")}, data=form
    )


async def bring_in(
    client: httpx.AsyncClient,
    data: bytes,
    chosen: list[str] | None = None,
    password: str | None = None,
    answers: Any = None,
) -> httpx.Response:
    form = {"answers": json.dumps(answers or {})}
    if chosen is not None:
        form["chosen"] = json.dumps(chosen)
    if password is not None:
        form["password"] = password
    return await client.post(
        "/api/imports/copy", files={"file": ("back.html", data, "text/html")}, data=form
    )


async def person(client: httpx.AsyncClient, pid: str) -> dict[str, Any]:
    found = await client.get(f"/api/persons/{pid}")
    assert found.status_code == 200, found.text
    detail: dict[str, Any] = found.json()
    return detail


def kinds(changes: list[dict[str, Any]]) -> dict[str, int]:
    counted: dict[str, int] = {}
    for change in changes:
        counted[change["kind"]] = counted.get(change["kind"], 0) + 1
    return counted


LATER = datetime(2026, 10, 2, 9, tzinfo=UTC)


# --- Tests ---------------------------------------------------------------------------------------


async def test_a_copys_changes_come_in_as_ticked_and_only_once(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await load_seed(driver, settings.neo4j_database)
    copy = await made(client)
    ali, hassan, aminah = (
        copy.id(n) for n in ("Ali bin Rosli", "Hassan bin Ismail", "Aminah binti Hassan")
    )
    copy.change(
        "Ali bin Rosli",
        occupation="Jurutera",
        residence_town="Klang",
        residence_state="Selangor",
        residence_country="Malaysia",
    )
    aina = copy.add("Aina binti Ali", gender="female", birth_year=2016)
    copy.link_up("parent", ali, aina)
    copy.link_up("parent", copy.id("Nadia binti Hashim"), aina)
    picture = webp((200, 150, 90))
    copy.tell(
        "Hassan bin Ismail",
        "He worked on the railway for thirty years.\n\n![At Gemas](media/2026-10-01-abc123.webp)",
        ["Talk with Nor, 2019"],
        {"2026-10-01-abc123.webp": picture},
    )
    copy.photo("Aminah binti Hassan", webp((90, 120, 200)))
    data = copy.saved(LATER)

    shown = await preview(client, data)
    assert shown.status_code == 200, shown.text
    review = shown.json()
    assert review["about"]["for_name"] == "Mak Long"
    assert kinds(review["changes"]) == {
        "set": 2,
        "add_person": 1,
        "add_link": 2,
        "story": 1,
        "photo": 1,
    }
    assert all(change["ticked"] for change in review["changes"])
    [photo] = [c for c in review["changes"] if c["kind"] == "photo"]
    assert photo["picture"].startswith("data:image/webp;base64,")  # made again here

    done = await bring_in(client, data)
    assert done.status_code == 201, done.text
    assert (done.json()["people"], done.json()["links"], done.json()["changed"]) == (1, 2, 2)
    assert (done.json()["stories"], done.json()["photos"]) == (1, 1)

    now = await person(client, ali)
    assert now["occupation"] == "Jurutera"
    assert now["residence"]["town"] == "Klang"
    children = [c["full_name"] for g in now["child_groups"] for c in g["children"]]
    assert "Aina binti Ali" in children
    assert (await person(client, aina))["id"] == aina  # the copy's own id
    story = (await client.get(f"/api/persons/{hassan}/biography")).json()
    assert story["sources"] == ["Talk with Nor, 2019"]
    [shown_picture] = [part.split(")")[0] for part in story["story"].split("](")[1:]]
    assert shown_picture != "media/2026-10-01-abc123.webp"  # a name made here, never the file's
    assert (await client.get(f"/api/persons/{hassan}/{shown_picture}")).status_code == 200
    assert (await person(client, aminah))["photo_version"] is not None

    # Listed with the imports, for whom; the same file again has nothing new.
    [listed] = (await client.get("/api/imports")).json()
    assert (listed["kind"], listed["for_name"], listed["people"]) == ("copy", "Mak Long", 1)
    again = await bring_in(client, data)
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "nothing_to_import"


async def test_a_clash_keeps_yours_unless_you_tick_theirs_and_look_alikes_are_asked(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await load_seed(driver, settings.neo4j_database)
    copy = await made(client)
    ali = copy.id("Ali bin Rosli")
    # Since the copy was made: you gave Ali an occupation, and added his daughter Siti.
    detail = await person(client, ali)
    body = {key: detail[key] for key in ("full_name", "gender", "birth_place", "residence")}
    mine = await client.put(
        f"/api/persons/{ali}",
        json={**body, "birth_date": detail["birth_date"]["value"], "occupation": "Akauntan"},
    )
    assert mine.status_code == 200, mine.text
    siti = await client.post(
        f"/api/persons/{ali}/relatives",
        json={
            "relation": "child",
            "person": {
                "full_name": "Siti binti Ali",
                "gender": "female",
                "birth_date": {"year": 2018},
            },
        },
    )
    assert siti.status_code == 201, siti.text
    # Meanwhile, in the copy: another occupation, and the same daughter, with more about her.
    copy.change("Ali bin Rosli", occupation="Jurutera")
    theirs = copy.add("Siti binti Ali", gender="female", birth_year=2018, nickname="Iti")
    copy.link_up("parent", ali, theirs)
    data = copy.saved(LATER)

    review = (await preview(client, data)).json()

    [clash] = [c for c in review["changes"] if c["kind"] == "set" and c["column"] == "Occupation"]
    assert (clash["before"], clash["after"], clash["clash"], clash["ticked"]) == (
        "Akauntan",
        "Jurutera",
        True,
        False,
    )
    [question] = review["questions"]
    assert question["answer"] == f"person:{siti.json()['person']['id']}"  # the same person
    [nickname] = [c for c in review["changes"] if c["column"] == "Nickname"]
    assert (nickname["unsure"], nickname["ticked"]) == (True, False)
    assert not [c for c in review["changes"] if c["kind"] in ("add_person", "add_link")]

    # Theirs, ticked: it replaces yours; the rest as it came.
    chosen = [c["id"] for c in review["changes"] if c["ticked"]] + [clash["id"], nickname["id"]]
    done = await bring_in(client, data, chosen)
    assert done.status_code == 201, done.text
    assert (await person(client, ali))["occupation"] == "Jurutera"
    them = await person(client, siti.json()["person"]["id"])
    assert them["nickname"] == "Iti"
    daughters = [c for g in (await person(client, ali))["child_groups"] for c in g["children"]]
    assert [c["full_name"] for c in daughters].count("Siti binti Ali") == 1  # no double


async def test_links_and_unknown_parents_come_back_through_the_rules(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await load_seed(driver, settings.neo4j_database)
    copy = await made(client)
    mariam, salmah = copy.id("Mariam binti Daud"), copy.id("Salmah binti Daud")
    aisyah, umar = copy.id("Aisyah binti Ali"), copy.id("Umar bin Ali")
    # The unknown parent of Mariam and Salmah, filled in with their father.
    unknown = next(p for p in copy.people if p["placeholder"])
    for link in [x for x in copy.links if x["source"] == unknown["id"]]:
        copy.unlink(link)
    copy.snapshot["family"]["people"].remove(unknown)
    daud = copy.add("Daud bin Ahmad", gender="male", birth_year=1915)
    copy.link_up("parent", daud, mariam)
    copy.link_up("parent", daud, salmah)
    # Umar is the elder; Ali and Nadia divorced; Adam was adopted by Johari.
    copy.change("Umar bin Ali", birth_order=1)
    copy.change("Aisyah binti Ali", birth_order=2)
    copy.link("spouse", "Ali bin Rosli", "Nadia binti Hashim")["status"] = "divorced"
    copy.link("parent", "Johari bin Kamarudin", "Adam bin Johari")["kind"] = "adoptive"
    # Two cousins who aren't linked in the tree turn out to be brothers.
    hafiz, danial = copy.id("Hafiz bin Rahman"), copy.id("Danial bin Karim")
    for link in [x for x in copy.links if x["target"] in (hafiz, danial) and x["type"] == "parent"]:
        copy.unlink(link)  # no parents recorded for them in the copy
    data = copy.saved(LATER)

    review = (await preview(client, data)).json()
    by_kind = kinds(review["changes"])
    assert (by_kind["fill_in"], by_kind["order"], by_kind["change_link"]) == (1, 1, 2)
    removals = [c for c in review["changes"] if c["kind"] == "remove_link"]
    assert removals
    assert all((c["ticked"], c["removes"]) == (False, True) for c in removals)

    done = await bring_in(client, data)  # as ticked: nothing taken out
    assert done.status_code == 201, done.text
    for sister in (mariam, salmah):
        parents = [p["full_name"] for p in (await person(client, sister))["parents"]]
        assert parents == ["Daud bin Ahmad"]
    ali = await person(client, copy.id("Ali bin Rosli"))
    assert [s["status"] for s in ali["spouses"]] == ["divorced"]
    [group] = [g for g in ali["child_groups"] if g["children"]]
    assert [c["full_name"] for c in group["children"]] == ["Umar bin Ali", "Aisyah binti Ali"]
    adam = await person(client, copy.id("Adam bin Johari"))
    assert {p["full_name"]: p["kind"] for p in adam["parents"]}[
        "Johari bin Kamarudin"
    ] == "adoptive"
    assert len((await person(client, hafiz))["parents"]) == 2  # unticked: still linked
    assert aisyah != umar


async def test_take_back_undoes_it_all_and_the_file_can_come_again(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await load_seed(driver, settings.neo4j_database)
    copy = await made(client)
    ali, johari = copy.id("Ali bin Rosli"), copy.id("Johari bin Kamarudin")
    copy.change("Ali bin Rosli", occupation="Jurutera")
    aina = copy.add("Aina binti Ali", gender="female", birth_year=2016)
    copy.link_up("parent", ali, aina)
    copy.remove("Adam bin Johari")
    copy.unlink(copy.link("spouse", "Ali bin Rosli", "Nadia binti Hashim"))
    copy.tell("Ali bin Rosli", "Jurutera di Klang.", [], {})
    copy.photo("Ali bin Rosli", webp((10, 200, 10)))
    adam = copy.id("Johari bin Kamarudin")
    data = copy.saved(LATER)
    review = (await preview(client, data)).json()
    everything = [c["id"] for c in review["changes"]]  # the removals too

    done = await bring_in(client, data, everything)
    assert done.status_code == 201, done.text
    assert (done.json()["removed"], done.json()["photos"]) == (1, 1)
    [listed] = (await client.get("/api/imports")).json()

    taken = await client.post(f"/api/imports/{listed['id']}/take-back")

    assert taken.status_code == 200, taken.text
    result = taken.json()
    assert (result["moved"], result["restored"], result["reverted"]) == (1, 1, 1)
    assert (result["links"], result["stories"], result["photos"]) == (1, 1, 1)
    now = await person(client, ali)
    assert now["occupation"] is None
    assert now["photo_version"] is None
    assert [s["full_name"] for s in now["spouses"]] == ["Nadia binti Hashim"]
    assert (await client.get(f"/api/persons/{ali}/biography")).json()["story"] == ""
    assert (await client.get(f"/api/persons/{aina}")).status_code == 404  # in the Trash
    children = [
        c["full_name"]
        for g in (await person(client, johari))["child_groups"]
        for c in g["children"]
    ]
    assert "Adam bin Johari" in children  # back from the Trash, linked
    assert adam
    # Compared as before the import: the file shows its changes again.
    again = (await preview(client, data)).json()
    assert {c["id"] for c in again["changes"]} == set(everything)


async def test_a_tampered_file_changes_nothing_you_didnt_approve(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await load_seed(driver, settings.neo4j_database)
    copy = await made(client, remove=False)
    hassan, ali = copy.id("Hassan bin Ismail"), copy.id("Ali bin Rosli")
    copy.snapshot["about"]["editing"]["may"]["remove"] = True  # says it may remove: it may not
    copy.snapshot["about"]["editing"]["for"] = "Someone else"
    copy.remove("Hassan bin Ismail")
    copy.change("Ali bin Rosli", notes="Plays badminton.", colour="green")  # and something unknown
    data = copy.saved(LATER)

    review = (await preview(client, data)).json()

    assert review["about"]["for_name"] == "Mak Long"  # as the app made it, not as the file says
    assert [c["kind"] for c in review["changes"]] == ["set"]
    assert [item["why"] for item in review["left_out"]] == [
        "This copy didn't let Mak Long remove people or links, so it's left out."
    ]
    nothing = await bring_in(client, data, [])
    assert nothing.status_code == 409
    assert nothing.json()["detail"]["code"] == "nothing_chosen"
    done = await bring_in(client, data, [review["changes"][0]["id"]])
    assert done.status_code == 201, done.text
    assert (await person(client, ali))["notes"] == "Plays badminton."
    assert (await client.get(f"/api/persons/{hassan}")).status_code == 200  # still here


async def test_what_cant_come_back_is_refused_with_the_reason(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await load_seed(driver, settings.neo4j_database)
    locked = await made(client, PASSWORD)
    locked.change("Ali bin Rosli", occupation="Jurutera")
    data = locked.saved(LATER)

    no_password = await preview(client, data)
    wrong = await preview(client, data, "kunci")
    right = await preview(client, data, PASSWORD)

    assert (no_password.status_code, no_password.json()["detail"]["code"]) == (422, "locked")
    assert (wrong.status_code, wrong.json()["detail"]["code"]) == (422, "wrong_password")
    assert right.status_code == 200, right.text
    assert right.json()["about"]["locked"] is True

    # Brought in, then an older save of the same copy: it has nothing newer.
    assert (await bring_in(client, data, password=PASSWORD)).status_code == 201
    older = locked.saved(datetime(2026, 10, 1, tzinfo=UTC))
    refused = await preview(client, older, PASSWORD)
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "older_copy")

    # Not made here; a view-only copy; not a copy at all.
    stranger = locked.snapshot | {"about": {**locked.snapshot["about"]}}
    stranger["about"]["editing"] = {**stranger["about"]["editing"], "id": str(uuid4())}
    unknown = await preview(client, page(APP, seal(stranger)).encode("utf-8"))
    assert (unknown.status_code, unknown.json()["detail"]["code"]) == (409, "unknown_copy")
    view_only = {
        **locked.snapshot,
        "about": {k: v for k, v in locked.snapshot["about"].items() if k != "editing"},
    }
    shown = await preview(client, page(APP, seal(view_only)).encode("utf-8"))
    assert (shown.status_code, shown.json()["detail"]["code"]) == (422, "not_to_edit")
    letter = await preview(client, b"<html><body>Salam</body></html>")
    assert (letter.status_code, letter.json()["detail"]["code"]) == (422, "not_a_copy")


async def test_backups_keep_what_copies_started_from(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings, tmp_path: Any
) -> None:
    await load_seed(driver, settings.neo4j_database)
    copy = await made(client)
    copy_id = copy.snapshot["about"]["editing"]["id"]

    backup = await create_backup(driver, settings.neo4j_database, settings.data_dir, tmp_path)

    from zipfile import ZipFile

    with ZipFile(backup.path) as archive:
        names = archive.namelist()
    assert f"copies/{copy_id}/about.json" in names
    assert f"copies/{copy_id}/start.json.gz" in names
    assert read_brought(settings.data_dir, copy_id) is None
