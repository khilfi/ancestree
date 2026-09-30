"""Changes to the fictional family, and what the API answers to each.

A copy to edit makes changes with TypeScript twins of the app's rules. The cases are
written down once, in frontend/src/copyedit/edit-cases.json: the app answers them here, and
the copy must answer them the same way (src/copyedit/edit-cases.test.ts)."""

import json
import re
from typing import Any

import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import REPO_ROOT, Settings
from ancestree.seed.family import load_seed_family
from ancestree.seed.loader import load_seed

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

CASES = json.loads(
    (REPO_ROOT / "frontend" / "src" / "copyedit" / "edit-cases.json").read_text("utf-8")
)["cases"]
_NAMED = re.compile(r"@([^/?\"]+?)(?=$|/|\?)")
_KEPT = re.compile(r"\$([a-z]+)")


def _ids() -> dict[str, str]:
    return {person.full_name: str(person.id) for person in load_seed_family().people_as_domain()}


def fill(value: Any, ids: dict[str, str], kept: dict[str, str]) -> Any:
    """A case's value with '@Full name' and '$kept' put in."""
    if isinstance(value, dict):
        return {key: fill(item, ids, kept) for key, item in value.items()}
    if isinstance(value, list):
        return [fill(item, ids, kept) for item in value]
    if not isinstance(value, str):
        return value
    if value.startswith("@"):
        return ids[value[1:]]
    if value.startswith("$") and _KEPT.fullmatch(value):
        return kept[value[1:]]
    return value


def fill_path(path: str, ids: dict[str, str], kept: dict[str, str]) -> str:
    path = _NAMED.sub(lambda match: ids[match.group(1)], path)
    return _KEPT.sub(lambda match: kept[match.group(1)], path)


def pick(answer: Any, path: str) -> Any:
    """A field by its path in the answer: "person.parents.0.full_name", "links.length"."""
    for part in path.split("."):
        if part == "length":
            answer = len(answer)
        elif isinstance(answer, list):
            answer = answer[int(part)]
        else:
            answer = answer[part]
    return answer


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
async def test_the_app_answers_each_case(
    case: dict[str, Any], client: httpx.AsyncClient, driver: AsyncDriver, settings: Settings
) -> None:
    await load_seed(driver, settings.neo4j_database)
    ids = _ids()
    kept: dict[str, str] = {}
    for number, step in enumerate(case["steps"], start=1):
        method, path = step["call"].split(" ", 1)
        where = f"step {number}, {step['call']}"
        body = fill(step["body"], ids, kept) if "body" in step else None
        response = await client.request(
            method, fill_path(path, ids, kept), json=body if body is not None else None
        )
        assert response.status_code == step["status"], f"{where}: {response.text}"
        answer: Any = response.json() if response.content else None
        if "code" in step:
            assert answer["detail"]["code"] == step["code"], where
        if "notices" in step:
            assert [notice["code"] for notice in answer["notices"]] == step["notices"], where
        for name, field in step.get("keep", {}).items():
            kept[name] = str(pick(answer, field))
        for field, expected in step.get("expect", {}).items():
            assert pick(answer, field) == fill(expected, ids, kept), f"{where}: {field}"
