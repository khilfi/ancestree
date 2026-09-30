from ancestree.domain.person import Gender, PartialDate
from ancestree.lineage.seating import Member, ParentEdge, Seat, SpouseEdge, seat_family

M, F = Gender.MALE, Gender.FEMALE


def person(
    name: str, gender: Gender = Gender.UNKNOWN, born: int | None = None, **extra: object
) -> Member:
    birth = PartialDate(year=born) if born else None
    return Member(id=name, name=name, gender=gender, birth=birth, **extra)  # type: ignore[arg-type]


def children(parents: tuple[str, ...], *kids: str, in_layout: bool = True) -> list[ParentEdge]:
    return [ParentEdge(parent, kid, in_layout) for parent in parents for kid in kids]


def seat(unit: str, generation: int, **fields: object) -> Seat:
    return Seat(unit, generation, **fields)  # type: ignore[arg-type]


def test_generations_follow_lineage_not_birth_years() -> None:
    # Zul is born the same year as his nephew Ali, and is still one ring further in (D3).
    people = [
        person("Tok", M, 1900),
        person("Nek", F, 1905),
        person("Aminah", F, 1962),
        person("Zul", M, 1980),
        person("Kamal", M, 1960),
        person("Ali", M, 1980),
    ]
    links = children(("Tok", "Nek"), "Aminah", "Zul") + children(("Aminah", "Kamal"), "Ali")

    seating = seat_family(people, links, [SpouseEdge("Tok", "Nek"), SpouseEdge("Aminah", "Kamal")])

    [unit] = seating.units
    assert unit.centre == ("Tok", "Nek")
    assert seating.seats["Nek"] == seat("main:0", 1, partner_of="Tok")
    assert seating.seats["Aminah"] == seat("main:0", 2, parent="Tok", order=0, branch="Aminah")
    assert seating.seats["Zul"] == seat("main:0", 2, parent="Tok", order=1, branch="Zul")
    assert seating.seats["Kamal"] == seat("main:0", 2, partner_of="Aminah", branch="Aminah")
    assert seating.seats["Ali"] == seat("main:0", 3, parent="Aminah", order=0, branch="Aminah")


def test_branches_start_where_a_single_line_first_splits() -> None:
    # Everyone comes down through Ahmad, so the colours start with his sons.
    people = [person(n) for n in ("Tok", "Ahmad", "Leaf", "Hassan", "Husin", "H1", "S1", "Wife")]
    links = (
        children(("Tok",), "Ahmad", "Leaf")
        + children(("Ahmad",), "Hassan", "Husin")
        + children(("Hassan",), "H1")
        + children(("Husin",), "S1")
    )

    seating = seat_family(people, links, [SpouseEdge("Ahmad", "Wife")])

    branch = {name: seat.branch for name, seat in seating.seats.items()}
    assert branch == {
        "Tok": None,
        "Ahmad": None,
        "Wife": None,
        "Leaf": None,
        "Hassan": "Hassan",
        "H1": "Hassan",
        "Husin": "Husin",
        "S1": "Husin",
    }


def test_a_wifes_own_family_hangs_off_her_in_a_cluster() -> None:
    people = [
        person("Tok", M, 1900),
        person("Hassan", M, 1930),
        person("Ahmad", M, 1932),
        person("Mariam", F, 1935),
        person("Daud", M, 1910),
        person("Aisyah", F, 1912),
        person("Salmah", F, 1938),
        person("Amin", M, 1960),
    ]
    links = (
        children(("Tok",), "Hassan", "Ahmad")
        + children(("Daud", "Aisyah"), "Mariam", "Salmah")
        + children(("Hassan", "Mariam"), "Amin")
    )

    seating = seat_family(people, links, [SpouseEdge("Hassan", "Mariam")])

    main, cluster = seating.units
    assert main.centre == ("Tok",)  # as deep as Daud's line, and born first
    assert seating.seats["Mariam"] == seat("main:0", 2, partner_of="Hassan", branch="Hassan")
    assert (cluster.id, cluster.anchor, cluster.centre, cluster.size) == (
        "cluster:Mariam",
        "Mariam",
        ("Daud", "Aisyah"),
        3,
    )
    assert cluster.anchor_seat == seat("cluster:Mariam", 2, parent="Daud", order=0, branch="Mariam")
    assert seating.seats["Salmah"] == seat(
        "cluster:Mariam", 2, parent="Daud", order=1, branch="Salmah"
    )


def test_a_wifes_first_husband_and_their_son_hang_off_her() -> None:
    # Wati married into the family after a divorce; her first husband and their son are linked
    # to the family only through her.
    people = [
        person("Tok", M, 1900),
        person("Daud", M, 1930),
        person("Wati", F, 1945),
        person("Fauzi", M, 1940),
        person("Ismail", M, 1966),
        person("Zainab", F, 1968),
    ]
    links = (
        children(("Tok",), "Daud")
        + children(("Fauzi", "Wati"), "Ismail")
        + children(("Daud", "Wati"), "Zainab")
    )

    seating = seat_family(people, links, [SpouseEdge("Daud", "Wati"), SpouseEdge("Fauzi", "Wati")])

    def where(place: Seat | None) -> tuple[object, ...]:
        assert place is not None
        return place.unit, place.generation, place.parent, place.partner_of

    _, cluster = seating.units
    assert where(seating.seats["Wati"]) == ("main:0", 2, None, "Daud")
    assert (cluster.anchor, cluster.centre, cluster.size) == ("Wati", ("Fauzi",), 2)
    assert where(cluster.anchor_seat) == ("cluster:Wati", 1, None, "Fauzi")
    assert where(seating.seats["Ismail"]) == ("cluster:Wati", 2, "Fauzi", None)


def test_clusters_hanging_off_the_same_person_each_have_their_own_id() -> None:
    # Wati's guardian looks after her and her son from her first marriage. The guardian hangs
    # off Wati inside the cluster that itself hangs off Wati: two clusters on one person.
    people = [
        person("Tok", M, 1900),
        person("Daud", M, 1930),
        person("Wati", F, 1945),
        person("Fauzi", M, 1940),
        person("Ismail", M, 1966),
        person("Guardian", M, 1920),
    ]
    links = (
        children(("Tok",), "Daud")
        + children(("Fauzi", "Wati"), "Ismail")
        + children(("Guardian",), "Wati", "Ismail", in_layout=False)
    )

    seating = seat_family(people, links, [SpouseEdge("Daud", "Wati"), SpouseEdge("Fauzi", "Wati")])

    ids = [unit.id for unit in seating.units]
    assert ids == ["main:0", "cluster:Wati", "cluster:Wati:2"]
    assert seating.seats["Guardian"].unit == "cluster:Wati:2"


def test_the_child_of_cousins_sits_outside_the_parent_further_out() -> None:
    people = [person(n) for n in ("Tok", "A", "B", "A1", "B1", "B2", "C")]
    links = (
        children(("Tok",), "A", "B")
        + children(("A",), "A1")
        + children(("B",), "B1")
        + children(("B1",), "B2")
        + children(("A1", "B2"), "C")
    )

    seating = seat_family(people, links, [SpouseEdge("A1", "B2")])

    assert seating.seats["A1"].generation == 3
    assert seating.seats["B2"].generation == 4
    assert seating.seats["C"] == seat("main:0", 5, parent="B2", order=0, branch="B")
    assert seating.seats["A1"].partner_of is None  # a cousin is seated by descent


def test_an_unknown_parent_at_the_top_sits_at_the_centre() -> None:
    people = [person("?", placeholder=True), person("Umar"), person("Hana"), person("Kid")]
    links = children(("?",), "Umar", "Hana") + children(("Umar",), "Kid")

    seating = seat_family(people, links, [])

    assert seating.units[0].centre == ("?",)
    assert seating.seats["Kid"].generation == 3


def test_a_chosen_centre_has_its_ancestors_hang_off_it() -> None:
    people = [person(n) for n in ("Tok", "Nek", "Hassan", "Amin")]
    links = children(("Tok", "Nek"), "Hassan") + children(("Hassan",), "Amin")

    seating = seat_family(people, links, [], centre="Hassan")

    main, cluster = seating.units
    assert main.centre == ("Hassan",)
    assert seating.seats["Amin"].generation == 2
    assert (cluster.anchor, cluster.centre) == ("Hassan", ("Nek", "Tok"))
    assert cluster.anchor_seat is not None
    assert cluster.anchor_seat.generation == 2


def test_unrelated_families_get_their_own_rings_and_loners_wait_apart() -> None:
    people = [person(n) for n in ("Tok", "Ali", "Pak", "Budi", "Badu", "Solo")]
    links = children(("Tok",), "Ali") + children(("Pak",), "Budi", "Badu")

    seating = seat_family(people, links, [])

    assert [(u.id, u.centre) for u in seating.units] == [
        ("main:0", ("Pak",)),
        ("main:1", ("Tok",)),
    ]
    assert seating.unlinked == ["Solo"]


def test_a_chosen_centre_puts_its_family_first_even_when_another_is_bigger() -> None:
    people = [person(n) for n in ("Tok", "Ali", "Pak", "Budi", "Badu")]
    links = children(("Tok",), "Ali") + children(("Pak",), "Budi", "Badu")

    seating = seat_family(people, links, [], centre="Tok")

    assert [(u.id, u.centre) for u in seating.units] == [
        ("main:0", ("Tok",)),
        ("main:1", ("Pak",)),
    ]


def test_second_wives_sit_in_marriage_order_with_their_children() -> None:
    people = [
        person("Hassan", M, 1930),
        person("Wife1", F, 1935),
        person("Wife2", F, 1940),
        person("K1", born=1960),
        person("K2", born=1962),
        person("K3", born=1958),  # older than Wife1's children, but from the second marriage
    ]
    links = children(("Hassan", "Wife1"), "K1", "K2") + children(("Hassan", "Wife2"), "K3")
    marriages = [SpouseEdge("Hassan", "Wife2", order=2), SpouseEdge("Hassan", "Wife1", order=1)]

    seating = seat_family(people, links, marriages)

    assert seating.units[0].centre == ("Hassan", "Wife1", "Wife2")
    assert [seating.seats[k].order for k in ("K1", "K2", "K3")] == [0, 1, 2]
    assert [seating.seats[w].order for w in ("Wife1", "Wife2")] == [0, 1]


def test_a_guardian_doesnt_move_the_child() -> None:
    people = [person(n) for n in ("Tok", "Ali", "Guard")]
    links = children(("Tok",), "Ali") + children(("Guard",), "Ali", in_layout=False)

    seating = seat_family(people, links, [])

    assert seating.seats["Ali"] == seat("main:0", 2, parent="Tok", order=0, branch="Ali")
    assert seating.seats["Guard"].unit == "cluster:Ali"
