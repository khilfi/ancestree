"""The seats a view-only copy carries for other centres: each
family's centre and each branch's, seated exactly as the app seats them, within a budget."""

from typing import Any
from uuid import UUID

import pytest

from ancestree.seed.generated import generated_family
from ancestree.services import graph
from ancestree.services.graph import build_graph, centre_layouts

KINDS = {"biological": True}


def test_each_familys_centre_and_each_branch_is_carried_as_the_app_seats_it() -> None:
    rows, links = generated_family(120)
    made = build_graph(rows, links, KINDS, None)

    layouts = centre_layouts(rows, links, KINDS, made, None)

    first = made.layout.units[0].id
    roots = {str(unit.centre[0]) for unit in made.layout.units}
    branches = {
        str(person)
        for person, seat in made.layout.seats.items()
        if seat.branch == person and seat.unit == first
    }
    assert len(made.layout.units) > 1  # married-in families, as in a real family
    assert roots | branches <= set(layouts)
    assert "" not in layouts  # made with the oldest ancestor: that's the copy's own graph
    for centre, layout in layouts.items():
        assert layout == build_graph(rows, links, KINDS, UUID(centre)).layout, centre
        assert layout.units[0].centre[0] == UUID(centre)


def test_a_copy_made_with_another_centre_carries_the_oldest_ancestor_too() -> None:
    rows, links = generated_family(60)
    oldest = build_graph(rows, links, KINDS, None)
    branch = next(person for person, seat in oldest.layout.seats.items() if seat.branch == person)
    made = build_graph(rows, links, KINDS, branch)

    layouts = centre_layouts(rows, links, KINDS, made, branch)

    assert layouts[""] == oldest.layout
    assert str(branch) not in layouts  # the copy's own centre is its graph


def test_the_seats_stop_before_the_budget() -> None:
    rows, links = generated_family(120)
    made = build_graph(rows, links, KINDS, None)
    per_layout = len(made.layout.seats)

    layouts = centre_layouts(rows, links, KINDS, made, None, budget=3 * per_layout)

    assert 0 < len(layouts) <= 3
    assert sum(len(layout.seats) for layout in layouts.values()) <= 3 * per_layout


def test_a_layout_past_the_budget_is_never_worked_out(monkeypatch: pytest.MonkeyPatch) -> None:
    # Working out seats is the slow part: at 2,000 people, a copy used to seat the family again
    # for every centre it met after the budget ran out, and took minutes.
    rows, links = generated_family(120)
    made = build_graph(rows, links, KINDS, None)
    seated: list[Any] = []

    def counted(*args: Any) -> Any:
        seated.append(args[-1])
        return build_graph(*args)

    monkeypatch.setattr(graph, "build_graph", counted)
    layouts = centre_layouts(rows, links, KINDS, made, None, budget=3 * len(made.layout.seats))

    assert len(seated) == len(layouts) == 3
