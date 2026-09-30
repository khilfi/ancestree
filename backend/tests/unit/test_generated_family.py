import time

from ancestree.seed.generated import generated_family
from ancestree.services.graph import build_graph


def test_a_generated_family_is_the_same_every_time() -> None:
    assert generated_family(300) == generated_family(300)


def test_two_thousand_people_are_seated_well_within_a_second() -> None:
    people, links = generated_family(2000)

    started = time.perf_counter()
    graph = build_graph(people, links, {"biological": True}, None)
    elapsed = time.perf_counter() - started

    assert len(graph.people) == 2000
    anchors = {unit.anchor for unit in graph.layout.units if unit.anchor}
    assert len(graph.layout.seats) == 2000  # everyone has a seat: on the rings or in a cluster
    assert anchors <= set(graph.layout.seats)
    assert graph.layout.units[0].id == "main:0"
    assert elapsed < 0.5, f"seating took {elapsed:.2f}s"
