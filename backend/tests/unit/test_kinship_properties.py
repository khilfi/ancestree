"""Property tests on random families: connected people always get an
answer, every answer has its matching reverse, and paths follow real links. Since 0.8.7,
every answer is the same both ways round, in random families and in every pair of the
test family."""

from collections import deque
from dataclasses import dataclass
from itertools import permutations

from hypothesis import example, given, settings
from hypothesis import strategies as st

from ancestree.kinship.blood import blood_ties
from ancestree.kinship.family import Family
from ancestree.kinship.finder import Relation, relate
from tests.kinship_fixtures import BOOKS, ENGLISH, Builder, seed
from tests.kinship_fixtures import example as example_family


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


def said(relations: list[Relation]) -> list[tuple[str, str, tuple[str, ...], int]]:
    return [(r.forward.sentence, r.reverse.sentence, r.path, r.generations) for r in relations]


def mirrored(relations: list[Relation]) -> list[tuple[str, str, tuple[str, ...], int]]:
    """The same relations as the other one sees them."""
    return [
        (r.reverse.sentence, r.forward.sentence, r.path[::-1], -r.generations) for r in relations
    ]


def grandfather_and_half_brother() -> Builder:
    """Hypothesis's find of 20 Nov 2026, made small: Hassan is Ali's grandfather, by his
    mother Siti, and his half-brother too, by their father Tok, whom Ali's mother also had Ali
    by; Hassan adopted Aminah. A stretch up from Ali to Hassan was said as the closer of the
    two, a half-brother, so each said the other was a generation below."""
    family = Builder()
    family.people("Tok:? Hassan:m Siti:f Ali:m Aminah:f")
    family.child("Tok", "Hassan", "Ali")
    family.child("Hassan", "Siti")
    family.child("Siti", "Ali")
    family.child("Hassan", "Aminah", kind="adoptive")
    return family


@given(families())
@example(Drawn(grandfather_and_half_brother().family(), "Ali", "Aminah"))
@settings(max_examples=300, deadline=None)
def test_every_answer_is_the_same_both_ways_round(drawn: Drawn) -> None:
    there = relate(drawn.family, drawn.a, drawn.b, ENGLISH, BOOKS)
    back = relate(drawn.family, drawn.b, drawn.a, ENGLISH, BOOKS)

    assert said(back) == mirrored(there)


def test_a_stretch_by_birth_is_said_as_the_tie_it_walks() -> None:
    family = grandfather_and_half_brother()
    there = family.relate("Ali", "Aminah")
    assert said(family.relate("Aminah", "Ali")) == mirrored(there)
    walked = next(r for r in there if r.path == ("Ali", "Siti", "Hassan", "Aminah"))
    assert walked.forward.term == "maternal grandfather's adopted daughter"
    assert walked.reverse.term == "adoptive sister's son"
    assert walked.generations == 1


def test_every_pair_of_the_test_family_answers_the_same_both_ways_round() -> None:
    # The review's #12: before 0.8.7, 54 of these 1,640 pairs said one thing one
    # way and another the other way, and 72 had a relation missing on one side.
    family, ids = seed()
    pairs = list(permutations(sorted(ids.values()), 2))

    assert len(pairs) == 1640
    for a, b in pairs:
        there = relate(family, a, b, ENGLISH, BOOKS)
        back = relate(family, b, a, ENGLISH, BOOKS)
        assert said(back) == mirrored(there), (family.members[a].name, family.members[b].name)


def test_two_relations_that_tie_are_both_shown() -> None:
    # The review's example: "Rokiah is Acan's sister-in-law", but "Acan is Rokiah's
    # co-parent-in-law".
    family, ids = seed()
    acan, rokiah = ids["hassan"], ids["rokiah"]

    there = relate(family, acan, rokiah, ENGLISH, BOOKS)
    assert {r.forward.sentence for r in there} == {
        "Rokiah is Acan's sister-in-law",
        "Rokiah is Acan's co-parent-in-law",
    }
    assert said(relate(family, rokiah, acan, ENGLISH, BOOKS)) == mirrored(there)


def test_of_two_that_tie_the_one_with_its_marriage_at_an_end_comes_first() -> None:
    """The user's answer of 19 Nov 2026: a relative's husband or wife, or a husband's or
    wife's relative, before a relation whose marriage is in its middle. A great-uncle's wife
    and an aunt's mother-in-law: the aunt married the great-uncle's son."""
    family = Builder()
    family.people("Tok:m Hassan:m Yusof:m Rokiah:f Azman:m Karim:m Nor:f Danial:m")
    family.child("Tok", "Hassan", "Yusof")
    family.marry("Yusof", "Rokiah")
    family.parents(("Yusof", "Rokiah"), "Azman")
    family.child("Hassan", "Karim", "Nor")
    family.marry("Nor", "Azman")
    family.child("Karim", "Danial")

    there = family.relate("Danial", "Rokiah")
    assert [r.forward.term for r in there] == ["great-uncle's wife", "aunt's mother-in-law"]
    assert said(family.relate("Rokiah", "Danial")) == mirrored(there)


def test_the_example_familys_rokiah_is_danials_great_uncles_wife_first() -> None:
    # What the browser journeys found: "Your aunt's mother-in-law" on Rokiah's panel,
    # Danial being Me.
    family, ids = example_family()
    there = relate(family, ids["danial"], ids["rokiah"], ENGLISH, BOOKS)
    assert there[0].forward.term == "great-uncle's wife"
    assert "aunt's mother-in-law" in [r.forward.term for r in there[1:]]


def test_a_relation_named_only_the_other_way_round_is_shown_both_ways() -> None:
    # Cousins who married: Nor is Tok Ismail's granddaughter, and his granddaughter-in-law;
    # he is her grandfather, and her husband's, which has no word of its own.
    family, ids = seed()
    ismail, nor = ids["ismail"], ids["nor"]

    assert [r.forward.sentence for r in relate(family, nor, ismail, ENGLISH, BOOKS)] == [
        "Tok Ismail is Nor's paternal grandfather",
        "Tok Ismail is Nor's husband's paternal grandfather",
    ]


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
