"""The map's packs: the list the app fetches them by,
every country's, fetching them as Neo4j is fetched, and reading their tiles, those cut to one
depth as one source. Nothing here reaches the internet: the downloads are made up, and so are
the packs, which the pmtiles library writes."""

import gzip
import hashlib
import io
import re
import threading
import time
import urllib.error
from pathlib import Path
from typing import Any

import pytest

from ancestree.maps import packs as packs_module
from ancestree.maps.packs import (
    BUILD,
    COUNTRIES,
    PACKS,
    PLACE_FILES,
    Pack,
    PackError,
    PackStore,
    PlaceFile,
    TileReader,
    fetch,
)
from tests.fake_packs import write_pack

GERMANY = (5.8, 47.2, 15.1, 55.1)


def test_the_list_is_as_the_app_and_the_workflow_take_it() -> None:
    """packs.json: the world first, then every country's packs, its own or its states',
    each keyed as the API takes it, fetched over https from this repository's release for its
    build, cut to its own area from the zoom after the world's, to 13 or 14, pinned by the
    pinning run, and under GitHub's 2 GiB a file; and every country with its packs."""
    assert next(iter(PACKS)) == "world"
    assert [key for key, pack in PACKS.items() if pack.first] == ["world"]
    assert len(COUNTRIES) > 200
    for pack in PACKS.values():
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)?", pack.key)
        assert pack.url == (
            f"https://github.com/khilfi/ancestree/releases/download/maps-{BUILD}/{pack.key}-{BUILD}.pmtiles"
        )
        assert re.fullmatch(r"[0-9a-f]{64}", pack.sha256), pack.key
        assert 0 < pack.size < 2**31
        if not pack.first:
            assert pack.country in COUNTRIES
            assert pack.region == f"{pack.key}.geojson"
            assert pack.minzoom == PACKS["world"].maxzoom + 1
            assert pack.maxzoom in (13, 14)
    assert len(PACKS["world"].sha256) == 64
    assert {key for country in COUNTRIES.values() for key in country.packs} == set(PACKS) - {
        "world"
    }
    assert COUNTRIES["my"].packs == ("my",)
    assert COUNTRIES["us"].title == "United States"
    assert "us-tx" in COUNTRIES["us"].packs
    assert (PACKS["de"].maxzoom, PACKS["my"].maxzoom) == (13, 14)


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
        sha256=hashlib.sha256(content).hexdigest() if sha256 is None else sha256,
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


def test_a_pack_not_cut_yet_is_refused(release: Release, tmp_path: Path) -> None:
    """Listed, but not pinned until the pinning run has cut it: never fetched unchecked."""
    with pytest.raises(PackError, match="isn't out yet"):
        fetch(made_up(CONTENT, sha256=""), tmp_path, lambda done, total: None)
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
    indonesia = PACKS["id"]
    store.start(indonesia)
    store.remove(indonesia)
    assert not store.installed(indonesia)
    assert "id" not in store.fetching
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
        f"id-{BUILD}.pmtiles.part",
        f"malaysia-{BUILD}.pmtiles",  # an earlier list's region, now a country's pack
        "notes.txt",
    ):
        (tmp_path / name).write_bytes(b"x")
    removed = PackStore(tmp_path).tidy()
    assert removed == [
        "malaysia-20250101.pmtiles.part",
        f"malaysia-{BUILD}.pmtiles",
        "world-20250101.pmtiles",
    ]
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        f"id-{BUILD}.pmtiles.part",
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


def test_a_tile_a_pack_here_has_is_covered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Where a country's pack has the tile, OpenFreeMap isn't asked for it: only where none has,
    such as across the border, or past the pack's deepest zoom."""
    monkeypatch.setattr(packs_module, "HERE_FOR", 0)  # a pack put here by hand is seen at once
    store = PackStore(tmp_path)
    assert not store.covered(10, 801, 503)  # no pack here yet
    write_pack(tmp_path / f"my-{BUILD}.pmtiles", {(10, 801, 503): b"Kuala Lumpur"})
    assert store.covered(10, 801, 503)
    assert not store.covered(10, 797, 472)  # Bangkok, beyond it
    assert not store.covered(15, 25640, 16097)  # past Malaysia's deepest zoom


# Every country's packs: those cut to one depth as one source, and a country at a time.


def test_a_tile_comes_from_whichever_pack_of_its_depth_has_it(tmp_path: Path) -> None:
    """Malaysia's pack is cut to 14, Germany's to 13: each depth's tiles are answered from its
    own packs alone, and a pack whose bounds are elsewhere isn't searched."""
    write_pack(tmp_path / f"my-{BUILD}.pmtiles", {(10, 801, 503): b"Kuala Lumpur"})
    write_pack(tmp_path / f"de-{BUILD}.pmtiles", {(10, 550, 335): b"Berlin"}, GERMANY)
    store = PackStore(tmp_path)
    found = store.tile(10, 801, 503, 14)
    assert found is not None
    assert gzip.decompress(found[0]) == b"Kuala Lumpur"
    assert found[1]  # gzipped
    assert store.tile(10, 801, 503, 13) is None  # Germany's depth: not Malaysia's pack
    berlin = store.tile(10, 550, 335, 13)
    assert berlin is not None
    assert gzip.decompress(berlin[0]) == b"Berlin"
    assert store.tile(10, 550, 335, 14) is None
    assert store.tile(10, 550, 335) is not None  # any depth, as OpenFreeMap's check asks
    malaysia = store.reader(PACKS["my"])
    assert malaysia is not None
    assert malaysia.may_have(10, 801, 503)
    assert not malaysia.may_have(10, 550, 335)  # Berlin is outside its bounds


def test_a_country_is_fetched_and_removed_whole(tmp_path: Path) -> None:
    """The United States, split by state: one Download fetches every state, those here already
    left as they are; Remove takes them all."""
    fetched: list[str] = []

    def fetcher(pack: Pack, folder: Path, progress: Any) -> Path:
        fetched.append(pack.key)
        (folder / pack.name).write_bytes(b"pack")
        return folder / pack.name

    (tmp_path / PACKS["us-tx"].name).write_bytes(b"pack")  # Texas, fetched before alone
    store = PackStore(tmp_path, fetcher=fetcher)
    usa = COUNTRIES["us"]
    store.start_country(usa)
    for key in usa.packs:
        thread = store.fetching[key].thread if key in store.fetching else None
        if thread is not None:
            thread.join(5)
    places = store.fetching["places-us"].thread
    assert places is not None
    places.join(5)
    expected = ["places-us", *(key for key in usa.packs if key != "us-tx")]
    assert sorted(fetched) == sorted(expected)  # its places with it
    assert all(store.installed(PACKS[key]) for key in usa.packs)
    store.remove_country(usa)
    assert not any(store.installed(PACKS[key]) for key in usa.packs)
    assert list(tmp_path.iterdir()) == []


# Each country's places: fetched with its packs, checked by their lines, and gone with
# the last of them.


def packed(text: str, level: int) -> bytes:
    return gzip.compress(text.encode("utf-8"), compresslevel=level, mtime=0)


def test_a_place_file_is_checked_by_its_lines_however_packed(tmp_path: Path) -> None:
    """One zlib packs the same lines into other bytes than another: the lines are what count."""
    text = "MY\tKelantan\tTumpat\tP\tKampung Contoh\t6.0000\t102.1000\t1200\t\n"
    places = PlaceFile("my", "Malaysia's places", 100, hashlib.sha256(text.encode()).hexdigest())
    for level in (1, 9):
        (tmp_path / "places.tsv.gz").write_bytes(packed(text, level))
        assert places.matches(tmp_path / "places.tsv.gz"), level
    (tmp_path / "places.tsv.gz").write_bytes(packed(text.replace("1200", "1201"), 9))
    assert not places.matches(tmp_path / "places.tsv.gz")
    (tmp_path / "places.tsv.gz").write_bytes(b"not gzipped")
    assert not places.matches(tmp_path / "places.tsv.gz")


def test_a_file_larger_than_its_pin_goes_no_further(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Put right in the security review of 0.8.0: a release's file larger than its pin, as one
    put there in the pack's place could be, is fetched no further than the pin's size and a
    piece, so it never fills the disk, and isn't kept; and a place file whose lines unpack to
    many times what it comes in, as no list of places does, isn't read on."""
    big = Release(b"x" * (8 << 20))
    monkeypatch.setattr("urllib.request.urlopen", big.urlopen)
    fetched: list[int] = []
    with pytest.raises(PackError, match="didn't match"):
        fetch(made_up(CONTENT), tmp_path, lambda done, _: fetched.append(done), pause=print)
    assert max(fetched) <= 1 << 20  # of 8 MB
    assert not list(tmp_path.glob("*.part"))

    lines = gzip.compress(b"0" * (64 << 20), compresslevel=9)
    places = PlaceFile("my", "Malaysia's places", len(lines), hashlib.sha256(b"").hexdigest())
    (tmp_path / "places.tsv.gz").write_bytes(lines)
    began = time.perf_counter()
    assert not places.matches(tmp_path / "places.tsv.gz")
    assert time.perf_counter() - began < 5


def test_every_country_with_places_has_its_file_pinned() -> None:
    """From GeoNames' copy packs.json pins: the world's, and Malaysia's among the countries'."""
    assert PLACE_FILES["world"].title == "The world's towns and postcodes"
    assert PLACE_FILES["my"].title == "Malaysia's places"
    assert len(PLACE_FILES) > 200
    for places in PLACE_FILES.values():
        assert len(places.lines) == 64
        assert places.size > 0
        assert places.name.startswith(f"places-{places.country}-")
        assert places.url.startswith("https://github.com/khilfi/ancestree/releases/download/")


def test_a_countrys_places_come_with_its_first_pack_and_go_with_its_last(tmp_path: Path) -> None:
    """Texas alone brings the United States' places; removing it leaves them while California
    stays, and takes them with California. The gazetteer is told each time, which country's,
    and whether they're here."""
    told: list[tuple[str, bool]] = []

    def fetcher(item: Pack | PlaceFile, folder: Path, progress: Any) -> Path:
        (folder / item.name).write_bytes(b"x")
        return folder / item.name

    store = PackStore(tmp_path, fetcher=fetcher)
    store.places_changed = lambda country, here: told.append((country, here))
    for key in ("us-tx", "us-ca"):
        store.start(PACKS[key])
    for state in list(store.fetching.values()):
        if state.thread is not None:
            state.thread.join(5)
    places = PLACE_FILES["us"]
    assert store.installed(places)
    assert store.places_path("us") == tmp_path / places.name
    assert store.places_path("my") is None
    assert told == [("us", True)]
    store.remove(PACKS["us-tx"])
    assert store.installed(places)  # California is still here
    store.remove(PACKS["us-ca"])
    assert not store.installed(places)
    assert told == [("us", True), ("us", False)]
    assert list(tmp_path.iterdir()) == []


def test_places_of_another_geonames_copy_are_tidied_away(tmp_path: Path) -> None:
    here = PLACE_FILES["my"].name
    for name in ("places-my-20250101.tsv.gz", here, "places-world-20250101.tsv.gz.part"):
        (tmp_path / name).write_bytes(b"x")
    assert PackStore(tmp_path).tidy() == [
        "places-my-20250101.tsv.gz",
        "places-world-20250101.tsv.gz.part",
    ]
    assert [path.name for path in tmp_path.iterdir()] == [here]
