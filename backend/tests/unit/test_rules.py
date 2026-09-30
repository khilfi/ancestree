from ancestree.domain.person import Gender, PartialDate
from ancestree.services.rules import Facts, life_notices, parent_child_notices


def person(
    name: str, gender: Gender = Gender.MALE, born: int | None = None, died: int | None = None
) -> Facts:
    return Facts(
        name=name,
        gender=gender,
        birth=PartialDate(year=born) if born else None,
        death=PartialDate(year=died) if died else None,
    )


def codes(parent: Facts, child: Facts, *, blood: bool = True) -> list[str]:
    return [notice.code for notice in parent_child_notices(parent, child, blood=blood)]


def test_a_plausible_link_raises_nothing() -> None:
    assert (
        codes(person("Hassan bin Ismail", born=1938), person("Aminah binti Hassan", born=1962))
        == []
    )


def test_the_patronymic_ignores_titles_like_haji() -> None:
    father = person("Haji Yusof bin Kassim")
    assert codes(father, person("Abdul Halim bin Haji Yusof")) == []
    assert codes(father, person("Ali bin Yusof")) == []


def test_a_patronymic_naming_someone_else_is_flagged() -> None:
    assert codes(person("Rosli bin Hamid"), person("Ali bin Daud")) == ["patronymic_mismatch"]


def test_only_a_biological_father_is_checked_against_the_name() -> None:
    mother = person("Hadiah binti Saleh", Gender.FEMALE)
    assert codes(mother, person("Abdul Halim bin Haji Yusof")) == []
    assert codes(person("Rosli bin Hamid"), person("Lina binti Zakaria"), blood=False) == []


def test_unlikely_ages_are_flagged() -> None:
    assert codes(person("A", born=1958), person("B", born=1965)) == ["parent_too_young"]
    assert codes(person("A", born=1990), person("B", born=1965)) == ["parent_younger"]


def test_a_father_may_die_before_his_child_is_born_but_a_mother_cannot() -> None:
    child = person("C", born=1950)
    assert codes(person("Father", born=1920, died=1949), child) == []
    assert codes(person("Father", born=1920, died=1948), child) == ["born_after_parent_died"]
    mother = person("Mother", Gender.FEMALE, born=1920, died=1949)
    assert codes(mother, child) == ["born_after_parent_died"]


def test_dying_before_being_born_is_flagged() -> None:
    assert [n.code for n in life_notices(person("X", born=1950, died=1940))] == ["died_before_born"]
