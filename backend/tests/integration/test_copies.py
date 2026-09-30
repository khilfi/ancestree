"""View-only copies: a copy answers as the app does, leaves
out what it's asked to, and carries nothing from this PC but the family."""

import base64
from collections.abc import Iterator
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.exceptions import InvalidTag
from neo4j import AsyncDriver
from PIL import Image

from ancestree.config import Settings
from ancestree.domain.search import find_people
from ancestree.exchange.copies import CopyOptions, family_snapshot, read_page, unseal
from ancestree.exchange.restore import read_info
from ancestree.seed.loader import load_seed
from ancestree.services import exports as exports_service
from ancestree.services.context import Context

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

# The copy's app stands in here: building the real one takes Node and a few seconds.
APP = (
    "<!doctype html><html><head><title>AncesTree</title></head>"
    '<body><div id="root"></div><!--ANCESTREE-COPY--></body></html>'
)
LANGUAGES = ("en", "ms", "jv")
# Where the test family's living people were born and live. Kota Bharu, where two who
# have died were born, stays in every copy.
LIVING_PLACES = ("Shah Alam", "Klang", "Petaling Jaya", "Muar", "Ipoh")


@pytest.fixture(autouse=True)
def copy_app(monkeypatch: pytest.MonkeyPatch) -> None:
    async def app() -> str:
        return APP

    monkeypatch.setattr(exports_service, "copy_app", app)


def jpeg(colour: tuple[int, int, int]) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (900, 600), colour).save(buffer, "JPEG")
    return buffer.getvalue()


async def add_picture(client: httpx.AsyncClient, person_id: str) -> str:
    added = await client.post(
        f"/api/persons/{person_id}/media",
        files={"file": ("picture.jpg", jpeg((200, 150, 90)), "image/jpeg")},
    )
    assert added.status_code == 201, added.text
    src: str = added.json()["src"]
    return src


async def tell(client: httpx.AsyncClient, person_id: str, story: str, sources: list[str]) -> None:
    saved = await client.put(
        f"/api/persons/{person_id}/biography",
        json={"story": story, "sources": sources, "base_version": "none"},
    )
    assert saved.status_code == 200, saved.text


async def family(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> dict[str, str]:
    """The test family, with photos, two stories, and a picture taken out of a story. Ali, who
    is living, also has an occupation and notes. Everyone's id, by name."""
    await load_seed(driver, settings.neo4j_database)
    graph = (await client.get("/api/graph")).json()
    ids = {p["full_name"]: p["id"] for p in graph["people"] if not p["placeholder"]}
    hassan, aminah, ali = ids["Hassan bin Ismail"], ids["Aminah binti Hassan"], ids["Ali bin Rosli"]

    for person in (hassan, aminah):
        photo = await client.put(
            f"/api/persons/{person}/photo",
            files={"file": ("photo.jpg", jpeg((90, 120, 200)), "image/jpeg")},
        )
        assert photo.status_code == 200, photo.text
    shown = await add_picture(client, hassan)
    await add_picture(client, hassan)  # added, then left out of the story
    await tell(
        client,
        hassan,
        f"## Work\n\nHe worked on the railway for thirty years.\n\n![At Gemas station]({shown})",
        ["Talk with Nor, 2019"],
    )
    her_picture = await add_picture(client, aminah)
    await tell(client, aminah, f"She teaches in Shah Alam.\n\n![]({her_picture})", [])

    detail = (await client.get(f"/api/persons/{ali}")).json()
    body = {key: detail[key] for key in ("full_name", "gender", "birth_place", "residence")}
    changed = await client.put(
        f"/api/persons/{ali}",
        json={
            **body,
            "birth_date": detail["birth_date"]["value"],
            "occupation": "Jurutera",
            "notes": "Plays badminton on Sundays.",
        },
    )
    assert changed.status_code == 200, changed.text
    return ids


async def copy_page(client: httpx.AsyncClient, **choices: Any) -> tuple[str, httpx.Response]:
    request = {"format": "copy", "title": "", "hide_living": False, "archive": True, **choices}
    made = await client.post("/api/exports", json=request)
    assert made.status_code == 201, made.text
    download = await client.get(f"/api/exports/{made.json()['name']}")
    assert download.status_code == 200
    return made.json()["name"], download


async def copy_of(client: httpx.AsyncClient, **choices: Any) -> dict[str, Any]:
    _, download = await copy_page(client, **choices)
    return unseal(read_page(download.text))


def carried(file: dict[str, Any]) -> bytes:
    return base64.b64decode(file["data"])


def data_of(uri: str) -> bytes:
    return base64.b64decode(uri.split(",", 1)[1])


def strings(value: Any) -> Iterator[str]:
    """Every text in an answer, keys included."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


async def test_a_copy_answers_as_the_app_does(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    ids = await family(client, driver, settings)
    hassan, aminah = ids["Hassan bin Ismail"], ids["Aminah binti Hassan"]

    name, download = await copy_page(client, title="  Keluarga   Contoh ")
    copy = unseal(read_page(download.text))

    # One file, named for its title, that downloads rather than opens here.
    assert name == f"ancestree-keluarga-contoh-{date.today():%Y-%m-%d}.html"
    assert download.headers["content-type"] == "text/html; charset=utf-8"
    assert download.headers["content-disposition"].startswith("attachment;")
    assert "<title>Keluarga Contoh · AncesTree</title>" in download.text
    about = copy["about"]
    assert (about["title"], about["people"], about["hidden_living"], about["archive"]) == (
        "Keluarga Contoh",
        len(ids),
        False,
        True,
    )

    # Everything the app asks, answered as the API answers it.
    for route, key in (
        ("/api/graph", "graph"),
        ("/api/settings", "tree_settings"),
        ("/api/relationship-kinds", "kinds"),
        ("/api/kinship/dictionary", "dictionary"),
        ("/api/kinship/settings", "kinship_settings"),
        ("/api/family/facts", "facts"),
    ):
        assert copy[key] == (await client.get(route)).json(), route
    # The map, found here: a copy carries the points, and no pins.
    assert copy["map"] == (await client.get("/api/map")).json() | {"pins": []}
    assert about["family"] == copy["graph"]["layout"]["units"][0]["centre"][0]
    kinship = copy["kinship_settings"]
    # What the copy's own relationship finder works from: the words as the answers use
    # them, the family's Malay titles applied, and the dictionary rows answers belong to.
    books = copy["kinship"]["books"]
    assert set(books) == {"en", "ms", "jv"}
    assert books["ms"]["titles"] == {"places": kinship["titles"], "youngest": kinship["youngest"]}
    assert "dictionary" not in books["en"]["data"]
    assert [row_id for row_id, _ in copy["kinship"]["rows"]][:2] == ["father", "mother"]
    for language in LANGUAGES:
        await client.put("/api/kinship/settings", json={**kinship, "language": language})
        for person in copy["persons"]:
            answer = (await client.get(f"/api/persons/{person}")).json()
            assert copy["persons"][person][language] == answer, (person, language)
    assert set(copy["persons"]) == {p["id"] for p in copy["graph"]["people"]}
    for person in ids.values():
        story = (await client.get(f"/api/persons/{person}/biography")).json()
        assert copy["stories"].get(person, {"story": "", "sources": [], "version": "none"}) == story
    assert set(copy["stories"]) == {hassan, aminah}
    for text in ("", "a", "hassan", "Bin Ismail", "zul", "nenek f", "tok"):
        found = (await client.get("/api/persons", params={"q": text, "limit": 20})).json()
        assert find_people(copy["search"], text, 20) == found, text

    # Photos in both sizes, and the pictures the stories show: not the one left out.
    for person in (hassan, aminah):
        for size in (128, 512):
            address = f"/api/persons/{person}/photo/avatar?size={size}"
            served = await client.get(f"/api/persons/{person}/photo/avatar", params={"size": size})
            assert data_of(copy["files"][address]) == served.content
    pictures = [address for address in copy["files"] if "/media/" in address]
    assert len(pictures) == 2
    for address in pictures:
        assert data_of(copy["files"][address]) == (await client.get(address)).content
    kept = settings.data_dir / "people" / hassan / "media"
    assert len(list(kept.glob("*.webp"))) == 2  # the one left out is still on this PC

    # The files its Export gives, as the app makes them.
    exports = copy["exports"]
    spreadsheet = await client.post("/api/exports", json={"format": "csv"})
    csv = await client.get(f"/api/exports/{spreadsheet.json()['name']}")
    assert carried(exports["csv"]) == csv.content
    gedcom = carried(exports["gedcom"]).decode("utf-8")
    assert gedcom.startswith("0 HEAD\r\n")
    assert gedcom.count(" INDI\r\n") == len(ids)
    template = await client.get("/api/imports/template")
    assert carried(exports["template"]) == template.content
    archive = tmp_path / exports["archive"]["name"]
    archive.write_bytes(carried(exports["archive"]))
    assert read_info(archive).people == len(ids)


async def test_hiding_living_people_leaves_out_their_details(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await family(client, driver, settings)
    hassan, aminah, ali = ids["Hassan bin Ismail"], ids["Aminah binti Hassan"], ids["Ali bin Rosli"]

    copy = await copy_of(client, hide_living=True)

    exports = copy.pop("exports")
    texts = list(strings(copy))
    files = {
        "gedcom": carried(exports["gedcom"]).decode("utf-8"),
        "csv": carried(exports["csv"]).decode("utf-8-sig"),
    }
    for place in LIVING_PLACES:
        assert not [text for text in texts if place in text], place
        for kind, text in files.items():
            assert place not in text, (place, kind)
    for kind, text in files.items():
        assert "Kota Bharu" in text, kind
        for detail in ("Jurutera", "badminton", "21 FEB 1980", "21/2/1980", "1980-02-21"):
            assert detail not in text, (detail, kind)
    assert not [text for text in texts if "Jurutera" in text or "badminton" in text]
    for language in LANGUAGES:
        shown = copy["persons"][ali][language]
        assert shown["birth_date"]["text"] == "1980"
        assert (shown["birth_date"]["value"]["month"], shown["birth_date"]["value"]["day"]) == (
            None,
            None,
        )
        assert shown["birth_place"] is shown["residence"] is shown["occupation"] is None
        assert shown["full_name"] == "Ali bin Rosli"  # who they are stays
        # Those who have died keep theirs.
        assert copy["persons"][hassan][language]["birth_date"]["text"] == "14/3/1938"
    [graph_ali] = [p for p in copy["graph"]["people"] if p["id"] == ali]
    assert graph_ali["born"]["month"] is None
    # Off the map, as in his panel; those who have died stay on it.
    mapped = {person["id"]: person for person in copy["map"]["people"]}
    assert mapped[ali]["lives"] is mapped[ali]["born"] is None
    assert mapped[hassan]["born"]["name"] == "Kota Bharu"
    # Their stories and the stories' pictures stay behind; their photos come along.
    assert set(copy["stories"]) == {hassan}
    assert all(f"/{hassan}/media/" in a for a in copy["files"] if "/media/" in a)
    assert f"/api/persons/{aminah}/photo/avatar?size=512" in copy["files"]
    assert exports["archive"] is None  # it holds everything
    assert copy["about"]["hidden_living"] is True
    assert copy["about"]["archive"] is False


async def test_a_copy_carries_the_seats_for_other_centres_as_the_app_seats_them(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    """Each family's centre and each branch's: a viewer can move a copy's centre
    to any of them, and sees what the app would show."""
    await load_seed(driver, settings.neo4j_database)
    copy = await copy_of(client)

    layouts = copy["layouts"]
    assert layouts
    assert copy["about"]["centres"] == list(layouts)
    for centre, layout in layouts.items():
        saved = await client.put("/api/settings", json={"centre": centre, "colours": "branch"})
        assert saved.status_code == 200, saved.text
        assert layout == (await client.get("/api/graph")).json()["layout"], centre

    # A copy made with a centre of its own carries the oldest ancestor too, as "".
    await client.put("/api/settings", json={"centre": None, "colours": "branch"})
    oldest = (await client.get("/api/graph")).json()["layout"]
    chosen = copy["about"]["centres"][-1]
    await client.put("/api/settings", json={"centre": chosen, "colours": "branch"})
    again = await copy_of(client)
    assert again["layouts"][""] == oldest
    assert chosen in again["about"]["centres"]
    assert chosen not in again["layouts"]  # it's the copy's own graph


async def test_living_peoples_birthdays_stay_out_of_family_facts(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await family(client, driver, settings)
    ctx = Context(driver, settings.neo4j_database, settings.data_dir)
    september = date(2026, 9, 1)  # Zul, who is living, was born on 10 September 1980

    shown = await family_snapshot(ctx, CopyOptions(), today=september)
    hidden = await family_snapshot(ctx, CopyOptions(hide_living=True), today=september)

    assert [a["person"]["name"] for a in shown["facts"]["this_month"]] == ["Zul"]
    assert hidden["facts"]["this_month"] == []
    born_in = {place["name"] for place in shown["facts"]["birthplaces"]}
    assert born_in == {"Kelantan", "Johor", "Perak", "Selangor"}
    # Only where those who have died were born.
    assert [place["name"] for place in hidden["facts"]["birthplaces"]] == ["Kelantan"]


async def test_a_locked_copy_opens_with_its_password_only(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    ids = await family(client, driver, settings)

    _, download = await copy_page(client, password="kunci rahsia keluarga")
    sealed = read_page(download.text)

    assert set(sealed) == {"format", "locked"}
    assert sealed["locked"]["iterations"] >= 600_000
    assert unseal(sealed, "kunci rahsia keluarga")["about"]["people"] == len(ids)
    with pytest.raises(InvalidTag):
        unseal(sealed, "kunci rahsia")
    with pytest.raises(ValueError, match="locked"):
        unseal(sealed)
    short = await client.post("/api/exports", json={"format": "copy", "password": "12345"})
    assert short.status_code == 422


async def test_a_copy_names_nothing_on_this_pc(
    client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await family(client, driver, settings)

    _, download = await copy_page(client)
    copy = unseal(read_page(download.text))

    copy["exports"].pop("archive")  # the family's own backup, by the user's choice
    secrets = (
        str(settings.data_dir),
        settings.data_dir.as_posix(),
        settings.neo4j_password.get_secret_value(),
        settings.neo4j_uri,
    )
    for secret in secrets:
        assert secret not in download.text
        assert not [text for text in strings(copy) if secret in text], secret
    assert copy["health"]["data_folder"] == copy["health"]["backup_folder"] == ""


async def test_a_family_with_no_one_in_it_isnt_copied(client: httpx.AsyncClient) -> None:
    refused = await client.post("/api/exports", json={"format": "copy"})

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "empty_family"
