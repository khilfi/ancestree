"""Importing a spreadsheet in the app."""

import csv
import io
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from ancestree.config import Settings
from tests.integration.conftest import create_person, get_person, link

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

HEADER = "ID,Full name,Gender,Born,Parents,Spouses,Children"


def sheet(*rows: str) -> bytes:
    return ("\r\n".join([HEADER, *rows]) + "\r\n").encode("utf-8-sig")


async def exported(client: httpx.AsyncClient) -> list[dict[str, str]]:
    """The tree's spreadsheet export, row by row, to edit as in Excel."""
    made = await client.post("/api/exports", json={"format": "csv"})
    assert made.status_code == 201, made.text
    text = (await client.get(f"/api/exports/{made.json()['name']}")).content.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def written(rows: list[dict[str, str]]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8-sig")


def row_of(rows: list[dict[str, str]], name: str) -> dict[str, str]:
    return next(row for row in rows if row["Full name"] == name)


def new_row(rows: list[dict[str, str]], **cells: str) -> dict[str, str]:
    return {**dict.fromkeys(rows[0], ""), **{k.replace("_", " "): v for k, v in cells.items()}}


async def send(
    client: httpx.AsyncClient,
    path: str,
    data: bytes,
    answers: dict[str, str] | None = None,
    name: str = "cousins.csv",
    chosen: list[str] | None = None,
) -> httpx.Response:
    form = {"answers": json.dumps(answers or {})}
    if chosen is not None:
        form["chosen"] = json.dumps(chosen)
    return await client.post(path, files={"file": (name, data, "text/csv")}, data=form)


async def preview(client: httpx.AsyncClient, data: bytes, **more: Any) -> dict[str, Any]:
    response = await send(client, "/api/imports/preview", data, **more)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def run(client: httpx.AsyncClient, data: bytes, **more: Any) -> dict[str, Any]:
    response = await send(client, "/api/imports", data, **more)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def names(client: httpx.AsyncClient) -> list[str]:
    graph = (await client.get("/api/graph")).json()
    return sorted(p["full_name"] for p in graph["people"] if not p["placeholder"])


async def test_the_template_and_its_example_download_as_csv(client: httpx.AsyncClient) -> None:
    template = await client.get("/api/imports/template")
    assert template.status_code == 200
    assert template.headers["content-type"].startswith("text/csv")
    assert "ancestree-import-template.csv" in template.headers["content-disposition"]
    assert template.content.decode("utf-8-sig").startswith("ID,Full name,Nickname")

    example = await client.get("/api/imports/template", params={"example": "true"})
    assert "Hassan bin Ismail" in example.content.decode("utf-8-sig")


async def test_the_preview_writes_nothing_and_the_import_does_what_it_showed(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", birth_date="1938")
    data = sheet(
        "P1,Adam bin Hassan,Male,1965,Hassan bin Ismail,Nadia binti Omar,",
        "P2,Nadia binti Omar,Female,1968,,,",
        "P3,Irfan bin Adam,Male,1990,P1; P2,,",
    )

    shown = await preview(client, data)

    assert [p["name"] for p in shown["people"]] == [
        "Adam bin Hassan",
        "Nadia binti Omar",
        "Irfan bin Adam",
    ]
    assert (shown["links"], shown["links_to_tree"]) == (4, 1)
    assert shown["questions"] == []
    assert await names(client) == ["Hassan bin Ismail"]  # nothing written

    done = await run(client, data)

    assert (done["people"], done["links"], done["left_out"]) == (3, 4, 0)
    assert done["label"] == "Import 3 people from cousins.csv"
    assert await names(client) == [
        "Adam bin Hassan",
        "Hassan bin Ismail",
        "Irfan bin Adam",
        "Nadia binti Omar",
    ]
    detail = await get_person(client, hassan["id"])
    assert [c["full_name"] for g in detail["child_groups"] for c in g["children"]] == [
        "Adam bin Hassan"
    ]
    history = (await client.get("/api/history")).json()
    assert history["undo"]["label"] == "Import 3 people from cousins.csv"
    backups = list((settings.data_dir / "exports").glob("*.zip"))
    assert [path.name for path in backups] == [done["backup"]]  # made first


async def test_an_import_is_one_undo_step(client: httpx.AsyncClient) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    await run(client, sheet(",Adam bin Hassan,Male,1965,Hassan bin Ismail,,"))

    step = (await client.get("/api/history")).json()["undo"]
    undone = await client.post("/api/history/undo", params={"step": step["id"]})

    assert undone.status_code == 200, undone.text
    assert await names(client) == ["Hassan bin Ismail"]
    detail = await get_person(client, hassan["id"])
    assert detail["child_groups"] == []


async def test_a_link_the_rules_refuse_is_left_out_and_only_that_link(
    client: httpx.AsyncClient,
) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male")
    for parent in ("Ismail bin Ahmad", "Fatimah binti Yusof"):
        person = await create_person(client, parent)
        await link(client, person["id"], hassan["id"], "parent")

    shown = await preview(client, sheet(",Latif bin Omar,Male,1910,,,Hassan bin Ismail"))

    assert [p["name"] for p in shown["people"]] == ["Latif bin Omar"]
    [left_out] = shown["left_out"]
    assert (left_out["row"], left_out["column"], left_out["written"]) == (
        2,
        "Children",
        "Hassan bin Ismail",
    )
    assert "already has two biological parents" in left_out["why"]
    assert shown["links"] == 0


async def test_answers_decide_who_is_who(client: httpx.AsyncClient) -> None:
    hassan = await create_person(client, "Hassan bin Ismail", gender="male", birth_date="1938")
    data = sheet(",Hasan bin Ismail,Male,1938,,,", ",Adam bin Hassan,Male,1965,Hasan bin Ismail,,")

    asked = await preview(client, data)
    [question] = asked["questions"]
    assert question["id"] == "same:2"
    assert question["answer"] == "new"
    assert len(asked["people"]) == 2

    answered = await preview(client, data, answers={"same:2": f"person:{hassan['id']}"})
    assert [p["name"] for p in answered["people"]] == ["Adam bin Hassan"]
    assert (answered["matched"], answered["links_to_tree"]) == (1, 1)
    # The file has no Version, so the other spelling waits for your tick.
    [spelling] = [c for c in answered["changes"] if c["kind"] == "set"]
    assert (spelling["column"], spelling["before"], spelling["after"]) == (
        "Full name",
        "Hassan bin Ismail",
        "Hasan bin Ismail",
    )
    assert (spelling["unsure"], spelling["ticked"]) == (True, False)


async def test_take_back_moves_everyone_it_added_to_the_trash(
    client: httpx.AsyncClient,
) -> None:
    await create_person(client, "Hassan bin Ismail", gender="male")
    done = await run(
        client,
        sheet(",Adam bin Hassan,Male,1965,Hassan bin Ismail,,", ",Nadia binti Omar,Female,,,,"),
    )

    taken = await client.post(f"/api/imports/{done['id']}/take-back")

    assert taken.status_code == 200, taken.text
    assert taken.json() == {
        "moved": 2, "gone": 0, "restored": 0, "reverted": 0, "kept": 0,
        "links": 0, "stories": 0, "photos": 0,
    }  # fmt: skip
    assert await names(client) == ["Hassan bin Ismail"]
    trash = (await client.get("/api/trash")).json()
    assert sorted(entry["full_name"] for entry in trash) == ["Adam bin Hassan", "Nadia binti Omar"]
    [summary] = (await client.get("/api/imports")).json()
    assert summary["people_present"] == 0
    assert summary["taken_back_at"] is not None
    again = await client.post(f"/api/imports/{done['id']}/take-back")
    assert again.status_code == 409


async def test_an_import_is_kept_with_its_report(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    done = await run(client, sheet(",Adam bin Hassan,x,31/2/1965,,,", ",,Male,,,,"))

    [summary] = (await client.get("/api/imports")).json()
    assert summary["id"] == done["id"]
    assert summary["file_name"] == "cousins.csv"
    assert (summary["people"], summary["people_present"]) == (1, 1)
    assert [(i["row"], i["column"]) for i in summary["left_out"]] == [
        (2, "Gender"),
        (2, "Born"),
        (3, "Full name"),
    ]
    report = await client.get(f"/api/imports/{done['id']}/report")
    assert report.status_code == 200
    text = report.content.decode("utf-8-sig")
    assert text.splitlines()[0] == "Row,Column,Written,What happened"
    assert "Left out. Use Male or Female" in text
    folder: Path = settings.data_dir / "imports" / done["id"]
    assert (folder / "source.csv").read_bytes().startswith(b"\xef\xbb\xbfID,Full name")

    # What's missing shows what the spreadsheet said beside the date picker.
    graph = (await client.get("/api/graph")).json()
    [adam] = graph["people"]
    assert (adam["born"], adam["birth_text"]) == (None, "31/2/1965")


async def test_a_file_that_isnt_a_spreadsheet_of_people_is_refused(
    client: httpx.AsyncClient,
) -> None:
    refused = await send(client, "/api/imports/preview", b"Name,Born\r\nZul,1980\r\n")
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "bad_spreadsheet"

    garbled = await client.post(
        "/api/imports/preview",
        files={"file": ("a.csv", sheet(",Zul,,,,,"), "text/csv")},
        data={"answers": "[1, 2]"},
    )
    assert garbled.status_code == 422
    assert garbled.json()["detail"]["code"] == "bad_answers"


async def test_a_file_with_nothing_new_is_refused(client: httpx.AsyncClient) -> None:
    hassan = await create_person(client, "Hassan bin Ismail")

    refused = await send(client, "/api/imports", sheet(f"{hassan['id']},Hassan bin Ismail,,,,,"))

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "nothing_to_import"
    assert list((await client.get("/api/imports")).json()) == []

    unticked = await send(client, "/api/imports", sheet(",Adam bin Hassan,Male,,,,"), chosen=[])
    assert unticked.status_code == 409
    assert unticked.json()["detail"]["code"] == "nothing_chosen"


# --- An export edited and brought back ---


async def edited_family(client: httpx.AsyncClient) -> tuple[dict[str, str], bytes]:
    """Three people in the tree, and their export edited: Hassan's occupation changed and
    his nickname emptied, Hassan and Mariam married, Latif marked Remove, and Adam added."""
    hassan = await create_person(
        client, "Hassan bin Ismail", gender="male", occupation="Station master", nickname="Acan"
    )
    mariam = await create_person(
        client, "Mariam binti Salleh", gender="female", occupation="Teacher"
    )
    latif = await create_person(client, "Latif bin Omar", gender="male")
    rows = await exported(client)
    row_of(rows, "Hassan bin Ismail").update(
        {"Occupation": "Retired", "Nickname": "", "Spouses": "Mariam binti Salleh"}
    )
    row_of(rows, "Mariam binti Salleh")["Occupation"] = "Headmistress"
    row_of(rows, "Latif bin Omar")["Remove"] = "yes"
    rows.append(new_row(rows, Full_name="Adam bin Hassan", Parents=hassan["id"]))
    ids = {"hassan": hassan["id"], "mariam": mariam["id"], "latif": latif["id"]}
    return ids, written(rows)


def ids_of(shown: dict[str, Any], kind: str, column: str | None = None) -> list[str]:
    return [
        c["id"]
        for c in shown["changes"]
        if c["kind"] == kind and (column is None or c["column"] == column)
    ]


async def test_an_edited_export_changes_only_what_you_tick(client: httpx.AsyncClient) -> None:
    ids, data = await edited_family(client)

    shown = await preview(client, data)

    assert [(c["kind"], c["column"], c["ticked"]) for c in shown["changes"]] == [
        ("set", "Nickname", True),
        ("set", "Occupation", True),
        ("set", "Occupation", True),
        ("add_person", None, True),
        ("add_link", "Spouses", True),
        ("add_link", "Parents", True),
        ("remove_person", None, False),  # only by your own tick
    ]
    assert await names(client) == ["Hassan bin Ismail", "Latif bin Omar", "Mariam binti Salleh"]

    hassans = f"set:{ids['hassan']}:occupation"
    removal = f"remove:{ids['latif']}"
    done = await run(client, data, chosen=[hassans, removal])

    assert (done["people"], done["links"], done["changed"], done["removed"]) == (0, 0, 1, 1)
    assert done["label"] == "Import 1 change from cousins.csv"
    hassan = await get_person(client, ids["hassan"])
    assert (hassan["occupation"], hassan["nickname"], hassan["spouses"]) == ("Retired", "Acan", [])
    assert (await get_person(client, ids["mariam"]))["occupation"] == "Teacher"
    assert await names(client) == ["Hassan bin Ismail", "Mariam binti Salleh"]
    trash = (await client.get("/api/trash")).json()
    assert [entry["full_name"] for entry in trash] == ["Latif bin Omar"]
    [summary] = (await client.get("/api/imports")).json()
    assert (summary["changed"], summary["removed"]) == (1, 1)


async def test_undo_puts_back_the_details_and_brings_back_those_removed(
    client: httpx.AsyncClient,
) -> None:
    ids, data = await edited_family(client)
    shown = await preview(client, data)
    await run(client, data, chosen=[c["id"] for c in shown["changes"]])  # everything
    assert await names(client) == ["Adam bin Hassan", "Hassan bin Ismail", "Mariam binti Salleh"]

    step = (await client.get("/api/history")).json()["undo"]
    undone = await client.post("/api/history/undo", params={"step": step["id"]})

    assert undone.status_code == 200, undone.text
    assert await names(client) == ["Hassan bin Ismail", "Latif bin Omar", "Mariam binti Salleh"]
    hassan = await get_person(client, ids["hassan"])
    assert (hassan["occupation"], hassan["nickname"], hassan["spouses"]) == (
        "Station master",
        "Acan",
        [],
    )
    assert (await client.get("/api/trash")).json() == []

    redone = await client.post("/api/history/redo")
    assert redone.status_code == 200, redone.text
    assert await names(client) == ["Adam bin Hassan", "Hassan bin Ismail", "Mariam binti Salleh"]
    assert (await get_person(client, ids["hassan"]))["occupation"] == "Retired"


async def test_take_back_puts_back_what_the_import_changed(client: httpx.AsyncClient) -> None:
    ids, data = await edited_family(client)
    shown = await preview(client, data)
    everything = [c["id"] for c in shown["changes"] if c["column"] != "Nickname"]
    done = await run(client, data, chosen=everything)
    assert (done["people"], done["links"], done["changed"], done["removed"]) == (1, 2, 2, 1)
    # Hassan's occupation is changed again since: that stays.
    changed = await client.put(
        f"/api/persons/{ids['hassan']}",
        json={
            "full_name": "Hassan bin Ismail",
            "gender": "male",
            "nickname": "Acan",
            "occupation": "Guru",
        },
    )
    assert changed.status_code == 200, changed.text

    taken = await client.post(f"/api/imports/{done['id']}/take-back")

    assert taken.status_code == 200, taken.text
    assert taken.json() == {
        "moved": 1, "gone": 0, "restored": 1, "reverted": 1, "kept": 1,
        "links": 0, "stories": 0, "photos": 0,
    }  # fmt: skip
    assert await names(client) == ["Hassan bin Ismail", "Latif bin Omar", "Mariam binti Salleh"]
    hassan = await get_person(client, ids["hassan"])
    assert (hassan["occupation"], hassan["spouses"]) == ("Guru", [])  # the marriage it made went
    assert (await get_person(client, ids["mariam"]))["occupation"] == "Teacher"
    trash = (await client.get("/api/trash")).json()
    assert [entry["full_name"] for entry in trash] == ["Adam bin Hassan"]
