"""A relative's changes, brought in by the keeper: what a
relative's computer sent, reviewed and brought in on the keeper's, every kind of change landing
exactly as approved; and Take back undoing it all.

The relative's family starts as the keeper's was, records and all (exchange/records.py), and
is changed here as their app changes it. These were the copy to edit's cases, whose
review and bringing in the family folder kept."""

import base64
import copy
import gzip
import io
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid7

import httpx
import pytest
from neo4j import AsyncDriver
from PIL import Image

from ancestree.config import Settings
from ancestree.exchange.records import in_link_order, person_record
from ancestree.exchange.returned import sent_family
from ancestree.importing.returned import Base
from ancestree.repo.graph import read_family
from ancestree.repo.imports import read_tree
from ancestree.seed.loader import load_seed
from ancestree.services import returns
from ancestree.services.biography import biography_from
from ancestree.services.context import Context, RuleError, read
from ancestree.services.history import History
from ancestree.storage import biography as stories

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

DEVICE = "5e4d3c2b1a090807"
COMPUTER = "Mak Long's laptop"
SENT_AT = datetime(2026, 10, 2, 9, tzinfo=UTC)


# --- A relative, changing their family -----------------------------------------------------------


class Relative:
    """A relative's family, as it started (the keeper's, then) and as they've changed it."""

    def __init__(self, ctx: Context, start: dict[str, Any]) -> None:
        self.ctx = ctx
        self.start = start
        self.family: dict[str, Any] = copy.deepcopy(start) | {"files": {}, "photos": {}}

    @property
    def people(self) -> list[dict[str, Any]]:
        people: list[dict[str, Any]] = self.family["family"]["people"]
        return people

    @property
    def links(self) -> list[dict[str, Any]]:
        links: list[dict[str, Any]] = self.family["family"]["links"]
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
        self.family["family"]["people"] = [p for p in self.people if p["id"] != pid]
        self.family["family"]["links"] = [
            link for link in self.links if pid not in (link["source"], link["target"])
        ]

    def unlink(self, link: dict[str, Any]) -> None:
        self.family["family"]["links"] = [x for x in self.links if x["id"] != link["id"]]

    def tell(self, name: str, story: str, sources: list[str], pictures: dict[str, str]) -> None:
        pid = self.id(name)
        self.family["stories"][pid] = {"story": story, "sources": sources}
        for picture, data in pictures.items():
            self.family["files"][f"/api/persons/{pid}/media/{picture}"] = data

    def photo(self, name: str, data: str) -> None:
        person = self.person(name)
        person["has_photo"] = True
        person["photo_version"] = (person.get("photo_version") or 0) + 1
        self.family["photos"][person["id"]] = {
            "display": data,
            "crop": {"x": 0, "y": 0, "width": 100, "height": 100},
        }
        self.family["files"][f"/api/persons/{person['id']}/photo/avatar?size=128"] = data

    def sent(self) -> returns.Sent:
        """What their computer sends: the whole family, and the one it started from."""
        start = self.start["family"]
        return returns.Sent(
            returned=sent_family(json.loads(json.dumps(self.family)), DEVICE),
            base=Base(
                people={str(p["id"]): p for p in start["people"]},
                links={str(link["id"]): link for link in start["links"]},
                stories=dict(self.start["stories"]),
                ids={},
            ),
            device=DEVICE,
            proposal=1,
            computer=COMPUTER,
            email="mak.long@example.com",
            sent_at=SENT_AT,
            packed=gzip.compress(json.dumps(self.family).encode("utf-8"), mtime=0),
        )


async def relative(driver: AsyncDriver, settings: Settings) -> Relative:
    """The made-up family in the keeper's tree, and a relative whose family starts as it."""
    await load_seed(driver, settings.neo4j_database)
    ctx = Context(driver, settings.neo4j_database, settings.data_dir)
    people, _ = await read(ctx, read_tree)
    _, links, _ = await read_family(ctx.driver, ctx.database)
    told: dict[str, Any] = {}
    for props in people:
        text = stories.read_story(ctx.data_dir, str(props["id"]))
        if text and text.strip():
            told[str(props["id"])] = biography_from(text).model_dump(mode="json")
    family = {"people": [person_record(p) for p in people], "links": in_link_order(links)}
    return Relative(ctx, {"family": family, "stories": told})


async def preview(them: Relative, answers: Any = None) -> dict[str, Any]:
    shown = await returns.preview_sent(them.ctx, them.sent(), answers or {})
    return shown.model_dump(mode="json")


async def bring_in(
    them: Relative, chosen: list[str] | None = None, answers: Any = None
) -> dict[str, Any]:
    done = await returns.run_sent(them.ctx, History(), them.sent(), answers or {}, chosen)
    return done.done.model_dump(mode="json")


def webp(colour: tuple[int, int, int], size: int = 400) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), colour).save(buffer, "WEBP")
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


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


# --- Tests ---------------------------------------------------------------------------------------


async def test_a_relatives_changes_come_in_as_ticked(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    them = await relative(driver, settings)
    ali, hassan, aminah = (
        them.id(n) for n in ("Ali bin Rosli", "Hassan bin Ismail", "Aminah binti Hassan")
    )
    them.change(
        "Ali bin Rosli",
        occupation="Jurutera",
        residence_town="Klang",
        residence_state="Selangor",
        residence_country="Malaysia",
    )
    aina = them.add("Aina binti Ali", gender="female", birth_year=2016)
    them.link_up("parent", ali, aina)
    them.link_up("parent", them.id("Nadia binti Hashim"), aina)
    picture = webp((200, 150, 90))
    them.tell(
        "Hassan bin Ismail",
        "He worked on the railway for thirty years.\n\n![At Gemas](media/2026-10-01-abc123.webp)",
        ["Talk with Nor, 2019"],
        {"2026-10-01-abc123.webp": picture},
    )
    them.photo("Aminah binti Hassan", webp((90, 120, 200)))

    review = await preview(them)
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

    done = await bring_in(them)
    assert (done["people"], done["links"], done["changed"]) == (1, 2, 2)
    assert (done["stories"], done["photos"]) == (1, 1)

    now = await person(client, ali)
    assert now["occupation"] == "Jurutera"
    assert now["residence"]["town"] == "Klang"
    children = [c["full_name"] for g in now["child_groups"] for c in g["children"]]
    assert "Aina binti Ali" in children
    assert (await person(client, aina))["id"] == aina  # the id they gave her
    story = (await client.get(f"/api/persons/{hassan}/biography")).json()
    assert story["sources"] == ["Talk with Nor, 2019"]
    [shown_picture] = [part.split(")")[0] for part in story["story"].split("](")[1:]]
    assert shown_picture != "media/2026-10-01-abc123.webp"  # a name made here, never theirs
    assert (await client.get(f"/api/persons/{hassan}/{shown_picture}")).status_code == 200
    assert (await person(client, aminah))["photo_version"] is not None

    # Listed with the imports, from their computer.
    [listed] = (await client.get("/api/imports")).json()
    assert (listed["kind"], listed["for_name"], listed["people"]) == ("folder", COMPUTER, 1)


async def test_a_clash_keeps_yours_unless_you_tick_theirs_and_look_alikes_are_asked(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    them = await relative(driver, settings)
    ali = them.id("Ali bin Rosli")
    # Since their changes started: you gave Ali an occupation, and added his daughter Siti.
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
    # Meanwhile, on their computer: another occupation, and the same daughter, with more about
    # her, and something the app doesn't know, which is passed over.
    them.change("Ali bin Rosli", occupation="Jurutera", colour="green")
    theirs = them.add("Siti binti Ali", gender="female", birth_year=2018, nickname="Iti")
    them.link_up("parent", ali, theirs)

    review = await preview(them)

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

    # Nothing ticked brings nothing in.
    with pytest.raises(RuleError) as nothing:
        await bring_in(them, [])
    assert nothing.value.code == "nothing_chosen"

    # Theirs, ticked: it replaces yours; the rest as it came.
    chosen = [c["id"] for c in review["changes"] if c["ticked"]] + [clash["id"], nickname["id"]]
    await bring_in(them, chosen)
    assert (await person(client, ali))["occupation"] == "Jurutera"
    found = await person(client, siti.json()["person"]["id"])
    assert found["nickname"] == "Iti"
    daughters = [c for g in (await person(client, ali))["child_groups"] for c in g["children"]]
    assert [c["full_name"] for c in daughters].count("Siti binti Ali") == 1  # no double


async def test_links_and_unknown_parents_come_back_through_the_rules(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    them = await relative(driver, settings)
    mariam, salmah = them.id("Mariam binti Daud"), them.id("Salmah binti Daud")
    # The unknown parent of Mariam and Salmah, filled in with their father.
    unknown = next(p for p in them.people if p["placeholder"])
    for link in [x for x in them.links if x["source"] == unknown["id"]]:
        them.unlink(link)
    them.people.remove(unknown)
    daud = them.add("Daud bin Ahmad", gender="male", birth_year=1915)
    them.link_up("parent", daud, mariam)
    them.link_up("parent", daud, salmah)
    # Umar is the elder; Ali and Nadia divorced; Adam was adopted by Johari.
    them.change("Umar bin Ali", birth_order=1)
    them.change("Aisyah binti Ali", birth_order=2)
    them.link("spouse", "Ali bin Rosli", "Nadia binti Hashim")["status"] = "divorced"
    them.link("parent", "Johari bin Kamarudin", "Adam bin Johari")["kind"] = "adoptive"
    # Two cousins have no parents recorded on their computer.
    hafiz, danial = them.id("Hafiz bin Rahman"), them.id("Danial bin Karim")
    for link in [x for x in them.links if x["target"] in (hafiz, danial) and x["type"] == "parent"]:
        them.unlink(link)

    review = await preview(them)
    by_kind = kinds(review["changes"])
    assert (by_kind["fill_in"], by_kind["order"], by_kind["change_link"]) == (1, 1, 2)
    removals = [c for c in review["changes"] if c["kind"] == "remove_link"]
    assert removals
    assert all((c["ticked"], c["removes"]) == (False, True) for c in removals)

    await bring_in(them)  # as ticked: nothing taken out
    for sister in (mariam, salmah):
        parents = [p["full_name"] for p in (await person(client, sister))["parents"]]
        assert parents == ["Daud bin Ahmad"]
    ali = await person(client, them.id("Ali bin Rosli"))
    assert [s["status"] for s in ali["spouses"]] == ["divorced"]
    [group] = [g for g in ali["child_groups"] if g["children"]]
    assert [c["full_name"] for c in group["children"]] == ["Umar bin Ali", "Aisyah binti Ali"]
    adam = await person(client, them.id("Adam bin Johari"))
    assert {p["full_name"]: p["kind"] for p in adam["parents"]}[
        "Johari bin Kamarudin"
    ] == "adoptive"
    assert len((await person(client, hafiz))["parents"]) == 2  # unticked: still linked


async def test_take_back_undoes_it_all_and_the_changes_show_again(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    them = await relative(driver, settings)
    ali, johari = them.id("Ali bin Rosli"), them.id("Johari bin Kamarudin")
    them.change("Ali bin Rosli", occupation="Jurutera")
    aina = them.add("Aina binti Ali", gender="female", birth_year=2016)
    them.link_up("parent", ali, aina)
    them.remove("Adam bin Johari")
    them.unlink(them.link("spouse", "Ali bin Rosli", "Nadia binti Hashim"))
    them.tell("Ali bin Rosli", "Jurutera di Klang.", [], {})
    them.photo("Ali bin Rosli", webp((10, 200, 10)))
    review = await preview(them)
    everything = [c["id"] for c in review["changes"]]  # the removals too

    done = await bring_in(them, everything)
    assert (done["removed"], done["photos"]) == (1, 1)
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
    # The tree as it was: what they sent shows its changes again.
    again = await preview(them)
    assert {c["id"] for c in again["changes"]} == set(everything)
