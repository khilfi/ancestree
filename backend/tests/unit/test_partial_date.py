from typing import Any

import pytest
from pydantic import ValidationError

from ancestree.domain.person import PartialDate


@pytest.mark.parametrize(
    "fields",
    [
        {"year": 1950},
        {"year": 1950, "month": 3},
        {"year": 1950, "month": 3, "day": 12},
        {"year": 2024, "month": 2, "day": 29},
        {"year": 1920, "qualifier": "about"},
        {"year": 1900, "qualifier": "before"},
        {"year": 1910, "year_to": 1915, "qualifier": "between"},
        {"original_text": "zaman Jepun"},
    ],
)
def test_accepts_partial_and_approximate_dates(fields: dict[str, Any]) -> None:
    PartialDate.model_validate(fields)


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"month": 3}, "a month needs a year"),
        ({"year": 1950, "day": 3}, "a day needs a month"),
        ({"year": 2023, "month": 2, "day": 29}, "February 2023 has no day 29"),
        ({"year": 1950, "month": 13}, "less than or equal to 12"),
        ({"year": 1910, "qualifier": "between"}, "'between' needs both"),
        ({"year": 1915, "year_to": 1910, "qualifier": "between"}, "must not be before"),
        ({"year": 1910, "year_to": 1915}, "only used with 'between'"),
        ({"qualifier": "about"}, "a qualifier needs a year"),
    ],
)
def test_rejects_inconsistent_dates(fields: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        PartialDate.model_validate(fields)
