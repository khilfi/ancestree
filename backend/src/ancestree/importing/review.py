"""The review file, where the import's answers are changed, and the report that explains
them. The review file lives in DATA_DIR, never in the repository.
"""

import json
import textwrap
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import yaml

from ancestree.domain.person import Gender
from ancestree.importing.plan import Decisions, ImportPlan, Question
from ancestree.storage.files import atomic_write

REVIEW_FORMAT = 1
_WIDTH = 88

_GENDER_WORDS = {
    "male": Gender.MALE,
    "m": Gender.MALE,
    "lelaki": Gender.MALE,
    "female": Gender.FEMALE,
    "f": Gender.FEMALE,
    "perempuan": Gender.FEMALE,
    "unknown": Gender.UNKNOWN,
    "": Gender.UNKNOWN,
}


@dataclass(frozen=True)
class Review:
    csv: Path | None
    drawio: Path | None
    decisions: Decisions


class ReviewError(Exception):
    """A review file that can't be used as it is."""


def read_review(path: Path) -> Review:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as error:
        raise ReviewError(f"Couldn't read the review file {path}: {error}") from error
    if not isinstance(data, dict):
        raise ReviewError(f"The review file {path} isn't laid out as expected.")
    files = data.get("files") or {}
    answers = {str(key): _text(value) for key, value in (data.get("answers") or {}).items()}
    genders = {}
    for label, value in (data.get("genders") or {}).items():
        gender = _GENDER_WORDS.get(_text(value).casefold())
        if gender is None:
            raise ReviewError(
                f"In {path.name}, '{value}' for {label} isn't male, female or unknown."
            )
        genders[str(label)] = gender
    return Review(_path(files.get("csv")), _path(files.get("drawio")), Decisions(answers, genders))


def write_review(path: Path, plan: ImportPlan, csv: Path | None, drawio: Path | None) -> None:
    lines = [
        "# AncesTree import review",
        "#",
        "# Each answer below is what the importer proposes. Change any you disagree with,",
        "# save this file, and run the check again to see the result:",
        "#     uv run ancestree import check",
        "# Nothing is imported until you run:",
        "#     uv run ancestree import apply",
        "",
        f"format: {REVIEW_FORMAT}",
        "files:",
        f"  csv: {_quote(str(csv)) if csv else 'null'}",
        f"  drawio: {_quote(str(drawio)) if drawio else 'null'}",
        "",
        "answers:" if plan.questions else "answers: {}",
    ]
    for question in plan.questions:
        lines += _comment(question.title, "  # ")
        lines += _comment(question.detail, "  #   ")
        choices = "; ".join(f"{answer} = {meaning}" for answer, meaning in question.options.items())
        lines += _comment(f"Answers: {choices}", "  #   ")
        lines.append(f"  {_quote(question.id)}: {_quote(plan.answers[question.id])}")
        lines.append("")
    lines += [
        "# Genders the files don't give. Write male, female or unknown.",
        "genders:" if plan.genders else "genders: {}",
    ]
    for choice in plan.genders:
        hint = f"  # {choice.hint}" if choice.hint else ""
        lines.append(f"  {_quote(choice.label)}: {choice.gender.value}{hint}")
    atomic_write(path, ("\n".join(lines) + "\n").encode("utf-8"))


def render_report(plan: ImportPlan, review_path: Path) -> str:
    people = [person for person in plan.people.values() if not person.placeholder]
    lines = ["AncesTree import check", "", "Files"]
    for source in plan.sources:
        named = sum(1 for person in source.people if person.name)
        extra = []
        if blank := len(source.people) - named:
            extra.append(f"{blank} blank boxes")
        if source.marriages:
            extra.append(f"{len(source.marriages)} Kahwin circles")
        lines.append(f"  {source.name}: {named} people" + "".join(f", {e}" for e in extra))

    orders = Counter(order.how for order in plan.orders)
    unknown = sum(1 for choice in plan.genders if choice.gender is Gender.UNKNOWN)
    lines += [
        "",
        "If imported now",
        f"  {_count(len(people), 'person', 'people')}, and "
        f"{_count(plan.placeholders, 'unknown parent', 'unknown parents')} joining brothers "
        "and sisters",
        f"  {plan.merged} of them are in both files and become one person each",
        f"  {_count(len(plan.parent_links), 'parent link', 'parent links')} and "
        f"{_count(len(plan.marriages), 'marriage', 'marriages')}",
        f"  Birth order: {_count(orders['dates'], 'family', 'families')} by their dates, "
        f"{orders['chart']} by the chart, {orders['open']} to order in the app",
        f"  Gender not in the files: {_count(unknown, 'person', 'people')} (see 'genders' in "
        "the review file)",
    ]

    same = [q for q in plan.questions if q.id.startswith("same person: ")]
    others = [q for q in plan.questions if q not in same]
    lines += ["", "Answers"]
    if same:
        kept_apart = [q for q in same if plan.answers[q.id] == "no"]
        lines.append(
            f"  Same person in both files: {len(same) - len(kept_apart)} merged"
            + (f", {len(kept_apart)} kept apart" if kept_apart else "")
        )
    for question in others:
        lines += _answer_lines(question, plan.answers[question.id])

    chart = [order for order in plan.orders if order.how == "chart"]
    if chart:
        lines += ["", "Birth order from the chart (eldest first)"]
        for order in chart:
            lines += _wrapped(f"{order.parents}: {', '.join(order.children)}", "  ", "      ")
    if plan.notices:
        lines += ["", "What the importer did"]
        for notice in plan.notices:
            lines += _wrapped(notice, "  - ", "    ")
    if plan.warnings:
        lines += ["", "Worth a look after importing (imported as they are)"]
        for warning in plan.warnings:
            lines += _wrapped(warning, "  - ", "    ")
    lines += [
        "",
        f"Review file: {review_path}",
        "Change any answer there and run the check again. To import (a backup is made first):",
        "  uv run ancestree import apply",
    ]
    return "\n".join(lines)


def _count(number: int, one: str, many: str) -> str:
    return f"{number} {one if number == 1 else many}"


def _answer_lines(question: Question, answer: str) -> list[str]:
    lines = _wrapped(question.title, "  ", "    ")
    lines += _wrapped(question.detail, "    ", "    ")
    return lines + _wrapped(f"-> {answer}: {question.options[answer]}", "    ", "       ")


def _wrapped(text: str, first: str, rest: str) -> list[str]:
    return textwrap.wrap(
        text, _WIDTH, initial_indent=first, subsequent_indent=rest, break_on_hyphens=False
    ) or [first.rstrip()]


def _comment(text: str, prefix: str) -> list[str]:
    return textwrap.wrap(
        text, _WIDTH, initial_indent=prefix, subsequent_indent=prefix, break_on_hyphens=False
    )


def _quote(text: str) -> str:
    """A JSON string is also a valid YAML string, so any name round-trips safely."""
    return json.dumps(text, ensure_ascii=False)


def _text(value: object) -> str:
    """What YAML read: an unquoted yes or no arrives as true or false."""
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return "" if value is None else str(value)


def _path(value: object) -> Path | None:
    return Path(str(value)) if value else None
