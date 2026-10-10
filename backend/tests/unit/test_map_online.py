"""The map's online extra: OpenFreeMap's tiles, fetched by the
engine from OpenFreeMap's own server alone. Nothing here reaches the internet: OpenFreeMap is
made up."""

import gzip
import io
import json
import urllib.error
from typing import Any

import pytest

from ancestree.maps import online as online_module
from ancestree.maps.online import AGAIN, INDEX, OnlineError, OpenFreeMap

TILES = "https://tiles.openfreemap.org/planet/20261004_113936_pt/{z}/{x}/{y}.pbf"
KUALA_LUMPUR = b"a tile of Kuala Lumpur"


class Answer(io.BytesIO):
    def __init__(self, body: bytes, packed: str | None) -> None:
        super().__init__(body)
        self.headers = {"Content-Encoding": packed} if packed else {}

    def __enter__(self) -> Answer:
        return self


class MadeUp:
    """OpenFreeMap as the engine meets it: its index, gzipped, then its tiles, and what was
    asked of it."""

    def __init__(self, tiles: object = TILES, body: bytes = KUALA_LUMPUR) -> None:
        self.index = gzip.compress(json.dumps({"tilejson": "3.0.0", "tiles": [tiles]}).encode())
        self.body = body
        self.packed: str | None = "gzip"
        self.asked: list[str] = []

    def urlopen(self, request: Any, timeout: float) -> Answer:
        self.asked.append(request.full_url)
        assert request.get_header("User-agent") == "AncesTree"
        if request.full_url == INDEX:
            return Answer(self.index, "gzip")
        return Answer(gzip.compress(self.body) if self.packed == "gzip" else self.body, self.packed)


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> MadeUp:
    made_up = MadeUp()
    monkeypatch.setattr("urllib.request.urlopen", made_up.urlopen)
    return made_up


def test_this_weeks_tiles_are_found_from_its_index_and_fetched_as_they_come(
    server: MadeUp,
) -> None:
    now = [0.0]
    openfreemap = OpenFreeMap(clock=lambda: now[0])

    found = openfreemap.tile(10, 801, 503)
    assert found is not None
    data, gzipped = found
    assert gzipped  # passed on as it came, for the window to unpack
    assert gzip.decompress(data) == KUALA_LUMPUR
    openfreemap.tile(10, 801, 504)
    assert server.asked == [
        INDEX,
        "https://tiles.openfreemap.org/planet/20261004_113936_pt/10/801/503.pbf",
        "https://tiles.openfreemap.org/planet/20261004_113936_pt/10/801/504.pbf",
    ]

    now[0] = AGAIN + 1  # hours later: where this week's tiles are, asked again
    openfreemap.tile(10, 801, 503)
    assert server.asked[3] == INDEX


@pytest.mark.parametrize(
    "elsewhere",
    [
        "https://attacker.example/{z}/{x}/{y}.pbf",
        "http://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf",
        "https://tiles.openfreemap.org.attacker.example/{z}/{x}/{y}.pbf",
        "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf?then=https://attacker.example",
        ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"],
    ],
)
def test_an_index_that_names_somewhere_else_is_never_followed(
    elsewhere: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Were OpenFreeMap's index changed to send the engine elsewhere, nothing is fetched."""
    server = MadeUp(tiles=elsewhere)
    monkeypatch.setattr("urllib.request.urlopen", server.urlopen)
    with pytest.raises(OnlineError, match=r"named somewhere else|didn't say where"):
        OpenFreeMap().tile(10, 801, 503)
    assert server.asked == [INDEX]


def test_where_openfreemap_has_nothing_there_is_nothing(server: MadeUp) -> None:
    server.body, server.packed = b"", None
    assert OpenFreeMap().tile(14, 0, 0) is None


def test_a_tile_packed_another_way_or_too_big_is_refused(
    server: MadeUp, monkeypatch: pytest.MonkeyPatch
) -> None:
    server.packed = "br"
    with pytest.raises(OnlineError, match="packed as br"):
        OpenFreeMap().tile(10, 801, 503)
    server.packed = "gzip"
    monkeypatch.setattr(online_module, "MOST_BYTES", 10)
    with pytest.raises(OnlineError, match="more than a tile"):
        OpenFreeMap().tile(10, 801, 503)


def test_without_the_internet_it_says_so_and_reads_the_index_again_next_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = MadeUp()
    monkeypatch.setattr("urllib.request.urlopen", server.urlopen)
    openfreemap = OpenFreeMap()
    openfreemap.tile(10, 801, 503)

    asked: list[str] = []

    def offline(request: Any, timeout: float) -> Any:
        asked.append(request.full_url)
        raise urllib.error.URLError("no internet")

    monkeypatch.setattr("urllib.request.urlopen", offline)
    unreachable = r"^OpenFreeMap couldn't be reached: no internet, or the connection broke$"
    with pytest.raises(OnlineError, match=unreachable):
        openfreemap.tile(10, 801, 504)
    assert len(asked) == 2  # tried twice, as a connection can break

    monkeypatch.setattr("urllib.request.urlopen", server.urlopen)
    server.asked.clear()
    openfreemap.tile(10, 801, 504)
    assert server.asked[0] == INDEX  # the week may have turned while it was away


def test_an_answer_other_than_a_tile_is_said(monkeypatch: pytest.MonkeyPatch) -> None:
    def busy(request: Any, timeout: float) -> Any:
        raise urllib.error.HTTPError(request.full_url, 503, "Service Unavailable", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr("urllib.request.urlopen", busy)
    with pytest.raises(OnlineError, match=r"^OpenFreeMap answered 503 \(Service Unavailable\)$"):
        OpenFreeMap().tile(10, 801, 503)
