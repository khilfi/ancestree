"""Property tests on random families: connected people always get an
answer, every answer has its matching reverse, and paths follow real links."""

from collections import deque
from dataclasses import dataclass

from hypothesis import given, settings
from hypothesis import strategies as st

from ancestree.kinship.blood import blood_ties
from ancestree.kinship.family import Family
from ancestree.kinship.finder import relate
from tests.kinship_fixtures import BOOKS, ENGLISH, Builder


@dataclass(frozen=True)
class Drawn:
    family: Family
    a: str
    b: str


@st.composite
def families(draw: st.DrawFn) -> Drawn:
    """Up to 14 people. Each may have up to two parents among the people before them (so no
    one is their own ancestor), mostly by birth, sometimes adopted; a few marriages."""
    size = draw(st.integers(min_value=2, max_value=14))
    family = Builder()
    for n in range(size):
        family.person(f"P{n}", draw(st.sampled_from("mf?")))
    for n in range(1, size):
        parents = draw(st.lists(st.integers(0, n - 1), max_size=2, unique=True))
        kind = draw(st.sampled_from(["biological"] * 6 + ["adoptive", "guardian"]))
        for parent in parents:
            family.child(f"P{parent}", f"P{n}", kind=kind)
    couples = draw(
        st.lists(
            st.tuples(st.integers(0, size - 1), st.integers(0, size - 1)).filter(
                lambda pair: pair[0] < pair[1]
            ),
            max_size=4,
            unique=True,
        )
    )
    for x, y in couples:
        family.marry(f"P{x}", f"P{y}")
    a, b = draw(
        st.tuples(st.integers(0, size - 1), st.integers(0, size - 1)).filter(
            lambda pair: pair[0] != pair[1]
        )
    )
    return Drawn(family.family(), f"P{a}", f"P{b}")


def connected(family: Family, a: str, b: str) -> bool:
    seen, queue = {a}, deque([a])
    while queue:
        person = queue.popleft()
        neighbours = (
            [link.parent for link in family.up[person]]
            + [link.child for link in family.down[person]]
            + [m.other(person) for m in family.wed[person]]
        )
        for other in neighbours:
            if other not in seen:
                seen.add(other)
                queue.append(other)
    return b in seen


@given(families())
@settings(max_examples=300, deadline=None)
def test_connected_people_always_get_an_answer(drawn: Drawn) -> None:
    relations = relate(drawn.family, drawn.a, drawn.b, ENGLISH, BOOKS)

    assert bool(relations) == connected(drawn.family, drawn.a, drawn.b)


@given(families())
@settings(max_examples=300, deadline=None)
def test_blood_ties_mirror_each_other(drawn: Drawn) -> None:
    there = blood_ties(drawn.family, drawn.a, drawn.b)
    back = blood_ties(drawn.family, drawn.b, drawn.a)

    assert sorted((t.up, t.down, t.ancestors) for t in there) == sorted(
        (t.down, t.up, t.ancestors) for t in back
    )


@given(families())
@settings(max_examples=300, deadline=None)
def test_every_answer_has_its_matching_reverse(drawn: Drawn) -> None:
    there = relate(drawn.family, drawn.a, drawn.b, ENGLISH, BOOKS)
    back = relate(drawn.family, drawn.b, drawn.a, ENGLISH, BOOKS)

    if there and there[0].type in ("marriage", "blood"):
        # Uncle one way, nephew the other: the same relation, and the generations cancel.
        assert back[0].type == there[0].type
        assert back[0].generations == -there[0].generations
        assert back[0].forward.sentence == there[0].reverse.sentence
        assert back[0].reverse.sentence == there[0].forward.sentence


@given(families())
@settings(max_examples=300, deadline=None)
def test_paths_follow_real_links(drawn: Drawn) -> None:
    family = drawn.family
    joined = {link.id: {link.parent, link.child} for links in family.up.values() for link in links}
    joined |= {m.id: {m.a, m.b} for ms in family.wed.values() for m in ms}

    for relation in relate(family, drawn.a, drawn.b, ENGLISH, BOOKS):
        assert relation.path[0] == drawn.a
        assert relation.path[-1] == drawn.b
        assert len(relation.links) == len(relation.path) - 1
        assert len(set(relation.path)) == len(relation.path)
        for here, there, link in zip(
            relation.path, relation.path[1:], relation.links, strict=False
        ):
            assert joined[link] == {here, there}
