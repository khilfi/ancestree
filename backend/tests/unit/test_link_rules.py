"""The rules every link keeps, over a family held in memory: the same sentences as the
app's, and the loops of parents a family could store before 0.8.7, each found with the link to
take out. Names are the fictional family's."""

import time
from uuid import NAMESPACE_URL, uuid5, uuid7

from ancestree.domain.links import Link, Rules, family_refusal, parent_loops

NAMES = {"tok": "Ismail", "hassan": "Hassan", "ali": "Ali", "siti": "Siti", "yusof": "Yusof"}


def parent(lid: str, a: str, b: str, *, blood: bool = True) -> Link:
    return Link(lid, "PARENT_OF", a, b, blood)


def test_each_link_is_taken_in_through_the_rules() -> None:
    rules = Rules(NAMES)
    assert rules.add(parent("1", "tok", "hassan")) is None
    assert rules.add(parent("2", "hassan", "ali")) is None
    assert rules.add(parent("3", "ali", "tok")) == (
        "Ismail is already an ancestor of Ali. This would make Ismail their own ancestor."
    )
    assert rules.add(parent("4", "hassan", "ali")) == "Hassan and Ali are already parent and child."
    assert rules.add(Link("5", "SPOUSE_OF", "hassan", "ali")) == (
        "One of Hassan and Ali is the other's parent, so they can't be married."
    )
    assert rules.add(parent("6", "siti", "ali")) is None
    assert rules.add(parent("7", "yusof", "ali")) == (
        "Ali already has two biological parents: Hassan and Siti. "
        "Choose another kind, such as adoptive."
    )
    assert rules.add(parent("8", "yusof", "ali", blood=False)) is None  # a guardian, say
    assert (
        rules.add(Link("9", "SPOUSE_OF", "ali", "ali")) == "Someone can't be linked to themselves."
    )


def test_a_loop_is_found_with_the_newest_link_in_it_to_take_out() -> None:
    links = [("a1", "tok", "hassan"), ("a2", "hassan", "ali"), ("a3", "ali", "tok")]
    [loop] = parent_loops([*links, ("a0", "tok", "siti")])
    assert (loop.link, loop.parent, loop.child) == ("a3", "ali", "tok")
    assert loop.people == ("tok", "hassan", "ali")
    assert loop.sentence(NAMES) == (
        "a loop of parents: Ismail is Hassan's parent, Hassan is Ali's, and Ali is Ismail's"
    )
    [two] = parent_loops([("b1", "hassan", "ali"), ("b2", "ali", "hassan")])
    assert two.sentence(NAMES) == "a loop of parents: Hassan is Ali's parent and Ali is Hassan's"
    [itself] = parent_loops([("c1", "ali", "ali")])
    assert itself.sentence(NAMES) == "a loop of parents: Ali is Ali's parent"
    assert (
        parent_loops([("d1", "tok", "hassan"), ("d2", "tok", "ali"), ("d3", "hassan", "ali")]) == []
    )


def test_two_loops_through_one_person_are_each_found() -> None:
    links = [
        ("1", "tok", "hassan"),
        ("2", "hassan", "tok"),
        ("3", "tok", "ali"),
        ("4", "ali", "tok"),
    ]
    assert [loop.link for loop in parent_loops(links)] == ["2", "4"]


def test_a_big_family_without_a_loop_is_checked_quickly() -> None:
    # Ten generations of a line of 2,000, each with two children: nothing to walk twice.
    links = [(f"{n:05}", f"p{n // 2}", f"p{n}") for n in range(1, 2000)]
    started = time.perf_counter()
    assert parent_loops(links) == []
    family = [parent(lid, a, b) for lid, a, b in links]
    assert family_refusal(family, {}) is None
    assert time.perf_counter() - started < 1


def test_a_whole_family_says_the_first_rule_it_breaks() -> None:
    names = NAMES
    assert family_refusal([parent("1", "ali", "ali")], names) == "Ali is linked to themselves"
    twice = [parent("1", "hassan", "ali"), parent("2", "hassan", "ali")]
    assert family_refusal(twice, names) == "Ali and Hassan are linked as parent and child twice"
    both = [parent("1", "hassan", "ali"), Link("2", "SPOUSE_OF", "ali", "hassan")]
    assert family_refusal(both, names) == "Ali and Hassan are parent and child, and married too"
    three = [parent(str(n), p, "ali") for n, p in enumerate(("hassan", "siti", "yusof"))]
    assert family_refusal(three, names) == "Ali has three birth parents: Hassan, Siti and Yusof"
    three[2] = parent("2", "yusof", "ali", blood=False)
    assert family_refusal(three, names) is None


def test_a_link_made_in_the_app_is_newer_than_a_test_familys() -> None:
    # The example family's ids are UUIDs of version 5, any order; the app's, version 7.
    seeded = [str(uuid5(NAMESPACE_URL, f"link-{n}")) for n in range(2)]
    made = str(uuid7())
    links = [(seeded[0], "tok", "hassan"), (seeded[1], "hassan", "ali"), (made, "ali", "tok")]
    [loop] = parent_loops(links)
    assert loop.link == made


def test_each_child_with_three_birth_parents_is_found_with_the_newest_link() -> None:
    from ancestree.domain.links import three_birth_parents

    links = [("1", "hassan", "ali"), ("2", "siti", "ali"), ("3", "yusof", "ali")]
    [crowded] = three_birth_parents([*links, ("4", "hassan", "siti")])
    assert (crowded.child, crowded.parents, crowded.link) == (
        "ali",
        ("hassan", "siti", "yusof"),
        "3",
    )
    assert crowded.sentence(NAMES) == "Ali has three birth parents: Hassan, Siti and Yusof"
    assert three_birth_parents(links[:2]) == []
