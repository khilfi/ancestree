"""The golden files a copy to edit's twins are checked against must
hold what Python works out now: the graph, its seats and people's views."""

from collections.abc import Callable

import pytest

from tests.copy_golden import content, read
from tests.kinship_golden import FAMILIES, Golden


@pytest.mark.parametrize("make", FAMILIES, ids=lambda make: make.__name__)
def test_the_golden_files_are_up_to_date(make: Callable[[], Golden]) -> None:
    golden = make()

    if read(golden.name) != content(golden):
        pytest.fail(
            f"frontend/src/copyedit/golden/{golden.name}.json.gz is out of date. In backend/, run "
            "`uv run python -m tests.copy_golden`, then make the copy's twins agree "
            "(frontend/src/copyedit/golden.test.ts).",
            pytrace=False,
        )
