"""The made-up families of spike S7: each seated as the plan describes
it, the same every time, and named so that no name can be anyone's."""

import re

import pytest

from ancestree.domain.graph import Graph
from ancestree.seed.clusters import ClusteredFamily, clustered_families
from ancestree.services.graph import build_graph


def seated(family: ClusteredFamily) -> Graph:
    return build_graph(family.people, family.links, {"biological": True}, None)


def married_in(graph: Graph) -> list[tuple[int, int, int]]:
    """Each married-in family: its size, the generation of its person on the rings it hangs
    from, and how many families deep it hangs."""
    seats = graph.layout.seats
    hosts = {
        unit.id: seats[unit.anchor].unit
        for unit in graph.layout.units
        if unit.anchor and unit.anchor in seats
    }

    def deep(unit: str) -> int:
        return 1 + deep(hosts[unit]) if unit in hosts else 0

    return [
        (unit.size, seats[unit.anchor].generation, deep(unit.id))
        for unit in graph.layout.units
        if unit.anchor
    ]


FAMILIES = {family.key: family for family in clustered_families()}


def test_each_family_is_the_same_every_time() -> None:
    assert clustered_families() == clustered_families()
    assert [family.key for family in clustered_families()] == [
        "planned",
        "neighbours",
        "six",
        "deep",
        "sizes",
        "generations",
    ]


@pytest.mark.parametrize("family", clustered_families(), ids=lambda family: family.key)
def test_each_family_keeps_its_own_couple_at_the_centre(family: ClusteredFamily) -> None:
    graph = seated(family)
    first = graph.layout.units[0]
    assert first.id == "main:0"
    assert [str(person) for person in first.centre] == [row["id"] for row in family.people[:2]]
    assert len(graph.layout.seats) == len(family.people)  # everyone seated, nobody left over


def test_the_family_shaped_as_planned_has_two_married_in_families_on_generations_3_and_4() -> None:
    graph = seated(FAMILIES["planned"])
    assert sorted(married_in(graph)) == [(7, 4, 1), (14, 3, 1)]
    main = [seat for seat in graph.layout.seats.values() if seat.unit == "main:0"]
    assert 80 <= len(main) <= 90
    assert max(seat.generation for seat in main) == 6


def test_married_in_families_hang_off_neighbours() -> None:
    graph = seated(FAMILIES["neighbours"])
    assert sorted(married_in(graph)) == [(5, 3, 1), (6, 3, 1)]
    anchors = [unit.anchor for unit in graph.layout.units if unit.anchor]
    spouses = [graph.layout.seats[anchor].partner_of for anchor in anchors if anchor]
    parents = {graph.layout.seats[spouse].parent for spouse in spouses if spouse}
    assert len(parents) == 1  # a brother and sister: side by side on their ring


def test_six_married_in_families_hang_around_one_ring() -> None:
    families = married_in(seated(FAMILIES["six"]))
    assert len(families) == 6
    assert {generation for _, generation, _ in families} == {2}


def test_married_in_families_hang_three_deep() -> None:
    assert sorted(deep for _, _, deep in married_in(seated(FAMILIES["deep"]))) == [1, 2, 3]


def test_a_married_in_family_of_60_hangs_beside_one_of_5() -> None:
    families = married_in(seated(FAMILIES["sizes"]))
    assert sorted(size for size, _, _ in families) == [4, 62]
    assert {generation for _, generation, _ in families} == {3}


def test_married_in_families_hang_off_a_parent_and_their_child() -> None:
    graph = seated(FAMILIES["generations"])
    assert sorted(generation for _, generation, _ in married_in(graph)) == [2, 3]
    seats = graph.layout.seats
    by_generation = {
        seats[unit.anchor].generation: unit.anchor for unit in graph.layout.units if unit.anchor
    }
    mother, wife = by_generation[2], by_generation[3]  # the son's wife, and their son's wife
    husband = seats[wife].partner_of
    assert husband is not None
    assert seats[husband].parent == seats[mother].partner_of  # her husband is their son


def test_no_name_can_be_anyones() -> None:
    for family in clustered_families():
        for person in family.people:
            assert re.fullmatch(r"\w+ \(\d+\)", person["full_name"]), person["full_name"]
