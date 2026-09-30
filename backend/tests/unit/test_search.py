"""The search rule, shared with a view-only copy: the copy's tests run the same cases."""

import json
from typing import Any

import pytest

from ancestree.config import REPO_ROOT
from ancestree.domain.search import find_people, words

CASES: dict[str, Any] = json.loads(
    (REPO_ROOT / "frontend" / "src" / "viewer" / "search-cases.json").read_text("utf-8")
)


@pytest.mark.parametrize("case", CASES["searches"], ids=lambda case: repr(case["text"]))
def test_the_app_finds_what_a_copy_finds(case: dict[str, Any]) -> None:
    found = find_people(CASES["people"], case["text"], case["limit"])
    assert [person["id"] for person in found] == case["found"]


def test_words_are_letters_and_digits() -> None:
    assert words("Dato' Hamid  bin_Kassim 2nd") == ["dato", "hamid", "bin", "kassim", "2nd"]
