"""Downloads that say where they went, through the API: with
a Downloads folder, as the desktop app's engine sets, the template, the example, an export or a
backup, an import's report and the tree's picture saved there, a taken name numbered, and Show
in folder for those alone. Without one, as in a browser, nothing is saved. A made-up folder,
and a stand-in for the file manager: nothing here opens a window."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest

from ancestree.config import Settings
from ancestree.desktop import downloads
from ancestree.exchange.spreadsheet import ENCODING
from ancestree.importing.template import template_csv
from ancestree.main import create_app
from tests.integration.conftest import create_person

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


@asynccontextmanager
async def desktop(settings: Settings, folder: Path) -> AsyncIterator[httpx.AsyncClient]:
    """The app as the desktop app's engine makes it: downloads saved in `folder`."""
    app = create_app(settings.model_copy(update={"downloads_dir": folder}))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


@pytest.fixture
def shown(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    """The file manager, here: what it was asked to show."""
    asked: list[Path] = []
    monkeypatch.setattr(downloads, "show", asked.append)
    return asked


async def test_the_template_and_example_are_saved_and_say_where(
    settings: Settings, tmp_path: Path, shown: list[Path]
) -> None:
    folder = tmp_path / "Downloads"
    async with desktop(settings, folder) as client:
        template = await client.post("/api/downloads", json={"what": "template"})
        assert template.status_code == 201, template.text
        assert template.json() == {"name": "ancestree-import-template.csv", "folder": "Downloads"}
        again = await client.post("/api/downloads", json={"what": "template"})
        assert again.json()["name"] == "ancestree-import-template (2).csv"
        example = await client.post("/api/downloads", json={"what": "example"})
        assert example.json()["name"] == "ancestree-import-example.csv"

        saved = (folder / "ancestree-import-template.csv").read_bytes()
        assert saved == template_csv().encode(ENCODING)  # as Excel opens it
        saved = (folder / "ancestree-import-example.csv").read_bytes()
        assert saved == template_csv(example=True).encode(ENCODING)

        done = await client.post("/api/downloads/show", json={"name": again.json()["name"]})
        assert done.status_code == 204
        assert shown == [folder / "ancestree-import-template (2).csv"]


async def test_an_export_a_backup_and_a_picture_are_saved_there(
    settings: Settings, tmp_path: Path
) -> None:
    folder = tmp_path / "Downloads"
    async with desktop(settings, folder) as client:
        await create_person(client, "Hassan bin Ismail", gender="male", birth_date="1938")
        backup = (await client.post("/api/exports", json={"format": "archive"})).json()
        saved = await client.post("/api/downloads", json={"what": "export", "name": backup["name"]})
        assert saved.json()["name"] == backup["name"]
        kept = Path(backup["folder"]) / backup["name"]
        assert (folder / backup["name"]).read_bytes() == kept.read_bytes()
        assert kept.exists()  # the backup stays where it was

        picture = await client.post(
            "/api/downloads/picture",
            data={"name": "ancestree-tree-2026-10-17.svg"},
            files={"file": ("tree.svg", b"<svg/>", "image/svg+xml")},
        )
        assert picture.json() == {"name": "ancestree-tree-2026-10-17.svg", "folder": "Downloads"}
        assert (folder / "ancestree-tree-2026-10-17.svg").read_bytes() == b"<svg/>"


async def test_nothing_else_is_saved_or_shown(
    settings: Settings, tmp_path: Path, shown: list[Path]
) -> None:
    folder = tmp_path / "Downloads"
    (tmp_path / "secret.zip").write_bytes(b"not an export")
    async with desktop(settings, folder) as client:
        for request in (
            {"what": "export", "name": "../secret.zip"},
            {"what": "export", "name": "ancestree-backup-2026-01-01T00-00-00.zip"},
            {"what": "report", "id": "no-such-import"},
        ):
            refused = await client.post("/api/downloads", json=request)
            assert refused.status_code == 404, request
        for name in ("../elsewhere.png", "ancestree-tree.exe", "tree.png"):
            refused = await client.post(
                "/api/downloads/picture",
                data={"name": name},
                files={"file": ("tree.png", b"png", "image/png")},
            )
            assert refused.status_code in (409, 422), name
        # Only a download saved here can be shown: never another file in the folder.
        folder.mkdir(exist_ok=True)
        (folder / "someone-elses.csv").write_text("theirs")
        for name in ("someone-elses.csv", "..\\secret.zip", "../secret.zip"):
            refused = await client.post("/api/downloads/show", json={"name": name})
            assert refused.status_code == 404, name
    assert shown == []
    assert sorted(path.name for path in folder.iterdir()) == ["someone-elses.csv"]


async def test_in_a_browser_the_browser_saves_them(client: httpx.AsyncClient) -> None:
    asked = [
        await client.post("/api/downloads", json={"what": "template"}),
        await client.post("/api/downloads", json={"what": "example"}),
        await client.post("/api/downloads/show", json={"name": "a.csv"}),
    ]
    for answer in asked:
        assert answer.status_code == 409
        assert answer.json()["detail"]["code"] == "browser_saves"
