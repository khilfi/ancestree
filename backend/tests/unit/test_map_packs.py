"""The map's packs: the pins the app fetches them by, fetching them
as Neo4j is fetched, and reading their tiles. Nothing here reaches the internet: the downloads
are made up, and so are the packs, which the pmtiles library writes."""

import gzip
import hashlib
import io
import threading
import urllib.error
from pathlib import Path
from typing import Any, get_args

import pytest

from ancestree.config import REPO_ROOT
from ancestree.domain.map import PackKey
from ancestree.maps import packs as packs_module
from ancestree.maps.packs import BUILD, PACKS, Pack, PackError, PackStore, TileReader, fetch
from tests.fake_packs import write_pack


def test_the_pins_are_as_the_app_and_the_workflow_take_them() -> None:
    """packs.json: a pack for each key the API knows, the world first, each fetched over https
    from this repository's release for its build, with a SHA-256, and cut to an area that's
    there (desktop/maps/)."""
    assert list(PACKS) == list(get_args(PackKey)) == ["world", "malaysia", "indonesia"]
    assert [pack.first for pack in PACKS.values()] == [True, False, False]
    for pack in PACKS.values():
        assert pack.url == (
            f"https://github.com/khilfi/ancestree/releases/download/maps-{BUILD}/{pack.key}-{BUILD}.pmtiles"
        )
        assert len(pack.sha256) == 64
        assert int(pack.sha256, 16) >= 0
        assert pack.size > 1_000_000
        assert pack.region is None or (REPO_ROOT / "desktop" / "maps" / pack.region).is_file()
    assert PACKS["world"].maxzoom + 1 == PACKS["malaysia"].minzoom == PACKS["indonesia"].minzoom


# Fetching, from a made-up release.
CONTENT = bytes(range(256)) * 400  # a made-up pack, 100 KB


class Release:
    """What GitHub's release would answer, a connection that breaks when told to, and what
    was asked of it."""

    def __init__(self, content: bytes, break_at: int | None = None) -> None:
        self.content = content
        self.break_at = break_at
        self.asked: list[str | None] = []

    def urlopen(self, request: Any, timeout: float) -> Any:
        wanted = request.get_header("Range")
        self.asked.append(wanted)
        start = int(wanted.removeprefix("bytes=").rstrip("-")) if wanted else 0
        if start > len(self.content):
            raise urllib.error.HTTPError(request.full_url, 416, "Range Not Satisfiable", {}, None)  # type: ignore[arg-type]
        body = self.content[start:]
        cut, self.break_at = self.break_at, None
        return Answer(body, 206 if start else 200, cut)


class Answer(io.BytesIO):
    def __init__(self, body: bytes, status: int, cut: int | None) -> None:
        super().__init__(body)
        self.status = status
        self.cut = cut

    def read(self, size: int | None = -1) -> bytes:
        if self.cut is not None and self.tell() >= self.cut:
            raise ConnectionResetError("the connection broke")
        return super().read(min(size or -1, (self.cut - self.tell()) if self.cut else size or -1))

    def __enter__(self) -> Answer:
        return self


def made_up(content: bytes, sha256: str | None = None) -> Pack:
    return Pack(
        key="world",
        title="The world",
        minzoom=0,
        maxzoom=6,
        region=None,
        first=True,
        size=len(content),
        sha256=sha256 or hashlib.sha256(content).hexdigest(),
    )


@pytest.fixture
def release(monkeypatch: pytest.MonkeyPatch) -> Release:
    answer = Release(CONTENT)
    monkeypatch.setattr("urllib.request.urlopen", answer.urlopen)
    return answer


def test_a_pack_is_fetched_and_kept_once_it_matches(release: Release, tmp_path: Path) -> None:
    told: list[tuple[int, int]] = []
    kept = fetch(made_up(CONTENT), tmp_path, lambda done, total: told.append((done, total)))
    assert kept == tmp_path / f"world-{BUILD}.pmtiles"
    assert kept.read_bytes() == CONTENT
    assert told[-1] == (len(CONTENT), len(CONTENT))
    assert release.asked == [None]
    assert [path.name for path in tmp_path.iterdir()] == [kept.name]


def test_a_broken_connection_carries_on_where_it_stopped(release: Release, tmp_path: Path) -> None:
    """A 338 MB pack on a slow line: what came is kept, and the rest asked for."""
    release.break_at = 40_000
    waits: list[float] = []
    kept = fetch(made_up(CONTENT), tmp_path, lambda done, total: None, pause=waits.append)
    assert kept.read_bytes() == CONTENT
    assert release.asked == [None, "bytes=40000-"]
    assert waits == [5]


def test_a_pack_that_doesnt_match_its_pin_is_refused(release: Release, tmp_path: Path) -> None:
    """Fetched afresh once, in case it was spoilt on the way; then refused, and nothing kept."""
    pinned = made_up(CONTENT, sha256="0" * 64)
    with pytest.raises(PackError, match="didn't match its fingerprint"):
        fetch(pinned, tmp_path, lambda done, total: None, pause=lambda seconds: None)
    assert release.asked == [None, None]
    assert list(tmp_path.iterdir()) == []


def test_a_pack_not_fetched_over_https_is_refused(
    release: Release, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(packs_module._PINNED, "release", "http://example.org/{build}/")
    with pytest.raises(PackError, match="isn't fetched over https"):
        fetch(made_up(CONTENT), tmp_path, lambda done, total: None)
    assert release.asked == []


def test_without_the_internet_it_tries_again_then_says_so(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def offline(request: Any, timeout: float) -> Any:
        raise urllib.error.URLError("no internet")

    monkeypatch.setattr("urllib.request.urlopen", offline)
    waits: list[float] = []
    with pytest.raises(
        PackError, match=r"^The world couldn't be fetched: no internet, or the connection broke$"
    ):
        fetch(made_up(CONTENT), tmp_path, lambda done, total: None, pause=waits.append)
    assert waits == [5, 10, 20]


def test_a_pack_the_release_doesnt_have_is_said_at_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Asking again wouldn't find it: said plainly, with no wait. GitHub busy is tried again."""
    answers = [503, 404]

    def release(request: Any, timeout: float) -> Any:
        code = answers.pop(0)
        reason = {503: "Service Unavailable", 404: "Not Found"}[code]
        raise urllib.error.HTTPError(request.full_url, code, reason, {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr("urllib.request.urlopen", release)
    waits: list[float] = []
    with pytest.raises(
        PackError, match=r"^The world couldn't be fetched: the server answered 404 \(Not Found\)$"
    ):
        fetch(made_up(CONTENT), tmp_path, lambda done, total: None, pause=waits.append)
    assert waits == [5]  # after the 503 alone


def test_a_part_longer_than_the_pack_is_started_again(release: Release, tmp_path: Path) -> None:
    (tmp_path / f"world-{BUILD}.pmtiles.part").write_bytes(CONTENT + b"more")
    kept = fetch(made_up(CONTENT), tmp_path, lambda done, total: None, pause=lambda s: None)
    assert kept.read_bytes() == CONTENT
    assert release.asked == [f"bytes={len(CONTENT) + 4}-", None]


# Reading tiles, from a pack the pmtiles library writes.
TILES = {(0, 0, 0): b"the world", (1, 1, 0): b"a quarter", (2, 3, 1): b"Malaysia, near enough"}


def test_a_packs_tiles_are_read_as_cut(tmp_path: Path) -> None:
    write_pack(tmp_path / "pack.pmtiles", TILES)
    reader = TileReader(tmp_path / "pack.pmtiles")
    try:
        assert reader.gzipped
        for (z, x, y), data in TILES.items():
            tile = reader.tile(z, x, y)
            assert tile is not None
            assert gzip.decompress(tile) == data
        assert reader.tile(2, 0, 0) is None  # none there
        assert reader.tile(9, 400, 250) is None  # deeper than the pack goes
    finally:
        reader.close()


def test_a_file_that_isnt_a_map_pack_is_refused(tmp_path: Path) -> None:
    (tmp_path / "pack.pmtiles").write_bytes(b"PMTiles" + bytes(200))
    with pytest.raises(Exception):  # noqa: B017, PT011 - what the library makes of it
        TileReader(tmp_path / "pack.pmtiles")


# The packs on this computer.
def test_a_pack_is_fetched_once_in_the_background(tmp_path: Path) -> None:
    started = threading.Event()
    go_on = threading.Event()

    def fetcher(pack: Pack, folder: Path, progress: Any) -> Path:
        started.set()
        progress(10, pack.size)
        go_on.wait(5)
        (folder / pack.name).write_bytes(b"pack")
        return folder / pack.name

    store = PackStore(tmp_path, fetcher=fetcher)
    world = PACKS["world"]
    assert store.start(world)
    started.wait(5)
    assert not store.start(world)  # on its way already
    assert store.fetching["world"].done == 10
    go_on.set()
    thread = store.fetching["world"].thread
    assert thread is not None
    thread.join(5)
    assert store.installed(world)
    assert not store.start(world)  # here already


def test_a_pack_on_its_way_stops_when_removed(tmp_path: Path) -> None:
    """Windows won't remove a file that's being written: it's stopped first."""

    def fetcher(pack: Pack, folder: Path, progress: Any) -> Path:
        part = folder / (pack.name + ".part")
        with part.open("wb") as out:
            for done in range(10_000):
                out.write(b"x")
                progress(done, pack.size)
                threading.Event().wait(0.001)
        return part

    store = PackStore(tmp_path, fetcher=fetcher)
    indonesia = PACKS["indonesia"]
    store.start(indonesia)
    store.remove(indonesia)
    assert not store.installed(indonesia)
    assert "indonesia" not in store.fetching
    assert not (tmp_path / (indonesia.name + ".part")).exists()


def test_a_failed_fetch_says_why_and_can_be_tried_again(tmp_path: Path) -> None:
    def fetcher(pack: Pack, folder: Path, progress: Any) -> Path:
        raise PackError(f"{pack.title} didn't match its fingerprint, so it wasn't kept")

    store = PackStore(tmp_path, fetcher=fetcher)
    world = PACKS["world"]
    store.start(world)
    thread = store.fetching["world"].thread
    assert thread is not None
    thread.join(5)
    assert (
        store.fetching["world"].error == "The world didn't match its fingerprint, so it wasn't kept"
    )
    assert store.start(world)  # asked again, it tries again


def test_packs_of_an_earlier_build_are_tidied_away(tmp_path: Path) -> None:
    for name in (
        "world-20250101.pmtiles",
        "malaysia-20250101.pmtiles.part",
        f"world-{BUILD}.pmtiles",
        f"indonesia-{BUILD}.pmtiles.part",
        "notes.txt",
    ):
        (tmp_path / name).write_bytes(b"x")
    removed = PackStore(tmp_path).tidy()
    assert removed == ["malaysia-20250101.pmtiles.part", "world-20250101.pmtiles"]
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        f"indonesia-{BUILD}.pmtiles.part",
        "notes.txt",
        f"world-{BUILD}.pmtiles",
    ]


# The map's online extra: the computer's choice, kept beside the packs.


def test_the_online_extra_is_off_until_chosen_and_stays_as_chosen(tmp_path: Path) -> None:
    folder = tmp_path / "maps"
    assert PackStore(folder).online is False  # nothing chosen yet: off, and nothing written
    assert not folder.exists()

    store = PackStore(folder)
    store.choose_online(True)
    assert store.online is True
    assert PackStore(folder).online is True  # kept for the next start
    store.choose_online(False)
    assert PackStore(folder).online is False
    assert PackStore(folder).tidy() == []  # the choice isn't a pack, and stays


def test_a_damaged_choice_reads_as_off(tmp_path: Path) -> None:
    """Only a plain yes turns the extra on: a file cut short, or anything else, leaves the map
    asking nothing of the internet."""
    for written in ("{", '{"online": "yes"}', '{"online": 1}', "[true]", "true", ""):
        (tmp_path / packs_module.CHOSEN).write_text(written, encoding="utf-8")
        assert PackStore(tmp_path).online is False, written
    (tmp_path / packs_module.CHOSEN).write_text('{"online": true}', encoding="utf-8")
    assert PackStore(tmp_path).online is True


def test_a_tile_a_pack_here_has_is_covered(tmp_path: Path) -> None:
    """Where a region's pack has the tile, OpenFreeMap isn't asked for it: only where none has,
    such as across the border, or past the pack's deepest zoom."""
    store = PackStore(tmp_path)
    assert not store.covered(10, 801, 503)  # no pack here yet
    write_pack(tmp_path / f"malaysia-{BUILD}.pmtiles", {(10, 801, 503): b"Kuala Lumpur"})
    assert store.covered(10, 801, 503)
    assert not store.covered(10, 797, 472)  # Bangkok, beyond it
    assert not store.covered(15, 25640, 16097)  # past Malaysia's deepest zoom
