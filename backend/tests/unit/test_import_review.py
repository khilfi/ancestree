from pathlib import Path

import pytest

from ancestree.domain.person import Gender
from ancestree.importing.review import ReviewError, read_review, render_report, write_review
from tests.import_fixtures import CHART, CSV, plan_for


def test_the_review_file_reads_back_as_written(tmp_path: Path) -> None:
    plan = plan_for()
    path = tmp_path / "review.yaml"

    write_review(path, plan, CSV, CHART)
    review = read_review(path)

    assert (review.csv, review.drawio) == (CSV, CHART)
    assert review.decisions.answers == plan.answers
    assert review.decisions.genders == {choice.label: choice.gender for choice in plan.genders}


def test_hand_typed_answers_are_understood(tmp_path: Path) -> None:
    path = tmp_path / "review.yaml"
    path.write_text(
        "answers:\n"
        "  capital letters: no\n"
        '  "same person: Aiman Bin Rosli": yes\n'
        "genders:\n"
        "  Salmah: F\n"
        "  Umar: lelaki\n",
        encoding="utf-8",
    )

    review = read_review(path)

    assert review.decisions.answers == {
        "capital letters": "no",
        "same person: Aiman Bin Rosli": "yes",
    }
    assert review.decisions.genders == {"Salmah": Gender.FEMALE, "Umar": Gender.MALE}


def test_a_gender_that_isnt_one_is_explained(tmp_path: Path) -> None:
    path = tmp_path / "review.yaml"
    path.write_text("genders:\n  Salmah: girl\n", encoding="utf-8")

    with pytest.raises(ReviewError, match="'girl' for Salmah isn't male, female or unknown"):
        read_review(path)


def test_the_report_sums_up_what_would_be_imported() -> None:
    report = render_report(plan_for(), Path("review.yaml"))

    assert "22 people, and 2 unknown parents" in report
    assert "8 of them are in both files" in report
    assert "Birth order: 1 family by their dates, 3 by the chart, 1 to order in the app" in report
    assert "Kamal Bin Daud & Kalsom Binti Yusof: Rosli Bin Kamal, Salmah, Ja'far" in report
