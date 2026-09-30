"""The golden files a view-only copy's kinship engine is checked against
must hold the Python engine's answers as they are now."""

from collections.abc import Callable

import pytest

from tests.kinship_golden import FAMILIES, Golden, content, read


@pytest.mark.parametrize("make", FAMILIES, ids=lambda make: make.__name__)
def test_the_golden_files_are_up_to_date(make: Callable[[], Golden]) -> None:
    golden = make()

    if read(golden.name) != content(golden):
        pytest.fail(
            f"frontend/src/kinship/golden/{golden.name}.json.gz is out of date. In backend/, run "
            "`uv run python -m tests.kinship_golden`, then make the copy's engine agree "
            "(frontend/src/kinship/golden.test.ts).",
            pytrace=False,
        )
