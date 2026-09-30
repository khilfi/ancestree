"""A view-only copy's page, and the app it's built from."""

import json
import shutil
from pathlib import Path

import pytest

from ancestree.config import REPO_ROOT
from ancestree.domain.person import DateQualifier, PartialDate
from ancestree.exchange import copy_app
from ancestree.exchange.copies import MARKER, page, read_page, seal, unseal, year_only
from ancestree.storage.biography import pictures_in

APP = f"<html><head><title>AncesTree</title></head><body>{MARKER}</body></html>"
VIEWER = REPO_ROOT / "frontend" / "src" / "viewer"


def test_the_family_cant_break_out_of_its_script_element() -> None:
    sealed = {"format": 1, "note": "</script><script>alert(1)</script><!-- & \u2028\u2029 >"}

    made = page(APP, sealed, title="Keluarga <Contoh> & co")

    inside = made.split('id="ancestree-copy">', 1)[1].rsplit("</script>", 1)[0]
    for unsafe in ("<", ">", "&", "\u2028", "\u2029"):
        assert unsafe not in inside
    assert made.count("</script>") == 1
    assert read_page(made) == sealed
    assert "<title>Keluarga &lt;Contoh&gt; &amp; co · AncesTree</title>" in made
    assert "<title>AncesTree</title>" in page(APP, sealed)


def test_a_page_needs_exactly_one_place_for_the_family() -> None:
    for app in ("<html></html>", APP + MARKER):
        with pytest.raises(ValueError, match="no place"):
            page(app, {"format": 1})
    with pytest.raises(ValueError, match="isn't an AncesTree copy"):
        read_page("<html></html>")


def test_what_is_sealed_is_unsealed() -> None:
    snapshot = {"about": {"title": "Keluarga Contoh"}, "names": ["Siti binti Rahman", "Zul"]}

    assert unseal(seal(snapshot)) == snapshot
    assert seal(snapshot) == seal(snapshot)  # the same family makes the same copy
    locked = seal(snapshot, "kunci rahsia")
    assert unseal(locked, "kunci rahsia") == snapshot
    assert set(locked["locked"]) == {"salt", "iv", "iterations", "data"}
    assert "Siti" not in json.dumps(locked)


def test_the_copys_page_is_given_what_it_opens() -> None:
    # The same cases the copy's page opens (src/viewer/snapshot.test.ts).
    cases = json.loads((VIEWER / "sealed-cases.json").read_text("utf-8"))

    assert unseal(cases["open"]) == cases["snapshot"]
    assert unseal(cases["locked"], cases["password"]) == cases["snapshot"]


def test_year_only_keeps_the_year_and_how_sure_it_is() -> None:
    born = PartialDate(year=1980, month=2, day=21, original_text="21/2/1980")
    assert year_only(born) == PartialDate(year=1980)
    about = PartialDate(year=1905, qualifier=DateQualifier.ABOUT)
    assert year_only(about) == about
    between = PartialDate(year=1938, year_to=1941, qualifier=DateQualifier.BETWEEN)
    assert year_only(between) == between
    assert year_only(None) is None


def test_only_the_pictures_a_story_shows_go_with_it() -> None:
    story = (
        "![At Gemas station](media/2026-09-27-4f3a9c.webp)\n\n"
        '![](media/2026-09-28-0b1c2d.webp "On the train")\n\n'
        "Again: ![At Gemas station](media/2026-09-27-4f3a9c.webp)\n\n"
        '<img src="media/2026-09-29-1a2b3c.webp" alt="At home">\n\n'
        "![Elsewhere](https://example.org/media/2026-01-01-aaaaaa.webp), "
        "see xmedia/2026-01-02-bbbbbb.webp and media/Not-a-name.webp"
    )

    assert pictures_in(story) == [
        "2026-09-27-4f3a9c.webp",
        "2026-09-28-0b1c2d.webp",
        "2026-09-29-1a2b3c.webp",
    ]
    assert pictures_in("No pictures here.") == []


def fake_frontend(tmp_path: Path) -> Path:
    frontend = tmp_path / "frontend"
    (frontend / "src").mkdir(parents=True)
    (frontend / "src" / "main.tsx").write_text("one", encoding="utf-8")
    (frontend / copy_app.PAGE).write_text(MARKER, encoding="utf-8")
    return frontend


def test_the_copys_app_is_built_again_only_when_the_frontend_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    frontend = fake_frontend(tmp_path)
    builds: list[str] = []

    def build(folder: Path) -> None:
        builds.append((folder / "src" / "main.tsx").read_text(encoding="utf-8"))
        (folder / copy_app.OUT).mkdir(exist_ok=True)
        (folder / copy_app.OUT / copy_app.PAGE).write_text(f"from {builds[-1]}", encoding="utf-8")

    monkeypatch.setattr(copy_app, "_build", build)

    assert copy_app.ready_page(frontend) == "from one"
    assert copy_app.ready_page(frontend) == "from one"
    assert builds == ["one"]
    (frontend / "src" / "main.tsx").write_text("two", encoding="utf-8")
    assert copy_app.ready_page(frontend) == "from two"
    (frontend / copy_app.OUT / copy_app.PAGE).unlink()  # cleaned away
    copy_app.ready_page(frontend)
    assert builds == ["one", "two", "two"]


def test_without_node_the_copys_app_says_what_is_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(shutil, "which", lambda _: None)

    with pytest.raises(copy_app.CopyAppError, match="isn't installed"):
        copy_app.ready_page(fake_frontend(tmp_path))
