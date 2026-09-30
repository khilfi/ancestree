"""A fictional family in a spreadsheet and a chart, with the same kinds of slips as real ones."""

from datetime import date
from pathlib import Path

from ancestree.importing.plan import Decisions, ImportPlan, PlannedPerson, build_plan
from ancestree.importing.sources import read_csv, read_drawio

FIXTURES = Path(__file__).parent / "fixtures" / "importing"
CSV = FIXTURES / "keluarga.csv"
CHART = FIXTURES / "keluarga.drawio"


def plan_for(decisions: Decisions | None = None) -> ImportPlan:
    sources = [read_csv(CSV), read_drawio(CHART)]
    return build_plan(sources, decisions, today=date(2026, 9, 27))


def people(plan: ImportPlan) -> dict[str, PlannedPerson]:
    """Everyone but the unknown parents, by label."""
    return {p.label: p for p in plan.people.values() if not p.placeholder}


def parents_of(plan: ImportPlan, label: str) -> set[str]:
    child = people(plan)[label].ref
    return {plan.people[parent].label for parent, kid in plan.parent_links if kid == child}


def couples(plan: ImportPlan) -> set[frozenset[str]]:
    return {frozenset((plan.people[a].label, plan.people[b].label)) for a, b in plan.marriages}
