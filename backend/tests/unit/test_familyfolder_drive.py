"""Google Drive's API as the family folder calls it (0.3.1): a busy Drive tried again, as
Google asks, and a file's id kept to its own place in an address. Nothing here reaches Google:
urllib's opener is a stand-in that answers as Drive would."""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
from email.message import Message
from typing import Any

import pytest

from ancestree.familyfolder.drive import Drive, DriveError
from ancestree.familyfolder.google import OfflineError

ACCOUNT = {"user": {"emailAddress": "keeper@example.com"}}


class Answer:
    """Drive's answer to a call that went through."""

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = json.dumps(body).encode()
        self.headers: dict[str, str] = {}

    def read(self) -> bytes:
        return self.body

    def __enter__(self) -> Answer:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def refused(status: int, why: str = "", retry_after: str | None = None) -> urllib.error.HTTPError:
    """Drive saying no, as it does: a message, and its reason's code."""
    headers = Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    body = json.dumps({"error": {"message": f"said {status}", "errors": [{"reason": why}]}})
    url = "https://www.googleapis.com/drive/v3/about"
    return urllib.error.HTTPError(url, status, "no", headers, io.BytesIO(body.encode()))


class Opener:
    """Each call's answer in turn, and every address asked for."""

    def __init__(self, answers: list[Answer | Exception]) -> None:
        self.answers = answers
        self.urls: list[str] = []

    def __call__(self, request: urllib.request.Request, timeout: float = 0) -> Answer:
        self.urls.append(request.full_url)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def drive_with(
    monkeypatch: pytest.MonkeyPatch, answers: list[Answer | Exception]
) -> tuple[Drive, Opener, list[float]]:
    opener = Opener(answers)
    monkeypatch.setattr(urllib.request, "urlopen", opener)
    waits: list[float] = []
    return Drive(lambda: "made-up-token", pause=waits.append), opener, waits


def test_a_busy_drive_is_tried_again(monkeypatch: pytest.MonkeyPatch) -> None:
    drive, opener, waits = drive_with(
        monkeypatch, [refused(503), refused(429, retry_after="7"), Answer(ACCOUNT)]
    )
    assert drive.account() == "keeper@example.com"
    assert len(opener.urls) == 3
    assert 1.0 <= waits[0] <= 1.5  # a second, give or take: never with every computer at once
    assert waits[1] == 7.0  # as long as Drive asked


def test_a_rate_limit_is_tried_again_and_a_refusal_is_not(monkeypatch: pytest.MonkeyPatch) -> None:
    drive, _, waits = drive_with(
        monkeypatch, [refused(403, "userRateLimitExceeded"), Answer(ACCOUNT)]
    )
    assert drive.account() == "keeper@example.com"
    assert len(waits) == 1
    for status, why in ((403, "insufficientFilePermissions"), (404, "notFound")):
        drive, opener, waits = drive_with(monkeypatch, [refused(status, why)])
        with pytest.raises(DriveError) as said:
            drive.account()
        assert (said.value.status, said.value.why, waits, len(opener.urls)) == (status, why, [], 1)


def test_drive_busy_for_too_long_is_left_to_the_next_round(monkeypatch: pytest.MonkeyPatch) -> None:
    drive, opener, waits = drive_with(monkeypatch, [refused(500) for _ in range(4)])
    with pytest.raises(DriveError) as said:
        drive.account()
    assert said.value.status == 500
    assert (len(opener.urls), len(waits)) == (4, 3)


def test_no_internet_is_said_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    drive, _, waits = drive_with(monkeypatch, [urllib.error.URLError("no route")])
    with pytest.raises(OfflineError):
        drive.account()
    assert waits == []


def test_a_files_id_stays_in_its_own_place_in_an_address(monkeypatch: pytest.MonkeyPatch) -> None:
    item = {"id": "a/b?c", "name": "x", "mimeType": "text/plain", "owners": []}
    drive, opener, _ = drive_with(monkeypatch, [Answer(item), Answer({"files": []})])
    drive.get("a/b?c")
    assert opener.urls[0].startswith("https://www.googleapis.com/drive/v3/files/a%2Fb%3Fc?")
    drive.children("it's")
    assert "q=%27it%5C%27s%27+in+parents" in opener.urls[1]  # quoted inside the search
