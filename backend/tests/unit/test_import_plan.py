from ancestree.domain.person import Gender, PartialDate, Place
from ancestree.importing.plan import Decisions
from tests.import_fixtures import couples, parents_of, people, plan_for


def test_people_in_both_files_become_one_person() -> None:
    plan = plan_for()

    assert plan.merged == 8
    assert (len(people(plan)), plan.placeholders) == (22, 2)
    rosli = people(plan)["Rosli Bin Kamal"]
    assert rosli.sources == ["keluarga.csv row 4", "the chart box 'Rosli Bin Kamal'"]
    assert (rosli.nickname, rosli.notes) == ("Li", ["Also called Tok Li."])
    # Idris is only named as a father in the spreadsheet; the chart has him in full.
    assert people(plan)["Idris Bin Musa"].gender is Gender.MALE


def test_answering_no_keeps_two_people_apart() -> None:
    plan = plan_for(Decisions(answers={"same person: Aiman Bin Rosli": "no"}))

    assert plan.merged == 7
    assert sorted(p.name for p in people(plan).values()).count("Aiman Bin Rosli") == 2


def test_a_birthday_shared_by_unrelated_people_becomes_unknown() -> None:
    plan = plan_for()

    assert plan.answers["stand-in birthday: 1/1/1960 in keluarga.csv"] == "unknown"
    assert people(plan)["Kamal Bin Daud"].birth_date is None
    # The same day and month in another year is asked about, and kept unless told otherwise.
    assert people(plan)["Rosli Bin Kamal"].birth_date == PartialDate(year=1950, month=1, day=1)
    year_only = plan_for(Decisions(answers={"birthday: Rosli Bin Kamal": "year"}))
    assert people(year_only)["Rosli Bin Kamal"].birth_date == PartialDate(year=1950)


def test_a_woman_given_as_a_father_is_left_out() -> None:
    plan = plan_for()

    assert parents_of(plan, "Rosli Bin Kamal") == {"Kamal Bin Daud", "Kalsom Binti Yusof"}
    # Keeping her gives him three parents, and the plan then proposes leaving her out.
    kept = plan_for(Decisions(answers={"father is a woman: Rosli Bin Kamal": "keep"}))
    assert kept.answers["too many parents: Rosli Bin Kamal"] == "without Wati Binti Omar"
    assert parents_of(kept, "Rosli Bin Kamal") == {"Kamal Bin Daud", "Kalsom Binti Yusof"}


def test_names_are_tidied_unless_told_not_to() -> None:
    plan = plan_for()

    assert {"Danial bin Aiman", "Nora binti Zakaria", "Ja'far"} <= set(people(plan))
    assert "Written as 'Ja`far*' in keluarga.drawio." in people(plan)["Ja'far"].notes
    assert people(plan)["Balqis Binti Rosli"].birth_date == PartialDate(
        year=1992, month=6, day=12
    )  # "12/6/92" in the chart
    as_written = plan_for(Decisions(answers={"capital letters": "no", "apostrophes": "no"}))
    assert {"Danial bin aiman", "Ja`far"} <= set(people(as_written))


def test_blank_boxes_become_unknown_parents_or_an_unnamed_child() -> None:
    plan = plan_for()

    assert parents_of(plan, "Umar") == {"Salmah", "Unknown parent"}
    assert parents_of(plan, "Unnamed child") == {"Salmah", "Unknown parent"}
    # A Kahwin circle with only one spouse drawn: the other parent is unknown.
    assert parents_of(plan, "Suraya Binti Hashim") == {"Hashim Bin Ali", "Unknown parent"}
    left_out = plan_for(Decisions(answers={"blank child 1: Salmah": "skip"}))
    assert "Unnamed child" not in people(left_out)


def test_marriages_come_from_the_chart_and_couples_from_the_spreadsheet() -> None:
    plan = plan_for()

    assert couples(plan) == {
        frozenset(("Kamal Bin Daud", "Kalsom Binti Yusof")),
        frozenset(("Rosli Bin Kamal", "Suraya Binti Hashim")),
        frozenset(("Idris Bin Musa", "Balqis Binti Rosli")),
        frozenset(("Ahmad (married to Ahmad) #1", "Ahmad (married to Ahmad) #2")),
        frozenset(("Aiman Bin Rosli", "Nora binti Zakaria")),
    }
    not_married = plan_for(
        Decisions(answers={"couple: Aiman Bin Rosli & Nora binti zakaria": "no"})
    )
    assert frozenset(("Aiman Bin Rosli", "Nora binti Zakaria")) not in couples(not_married)


def test_birth_order_comes_from_the_dates_or_else_the_chart() -> None:
    plan = plan_for()

    orders = {order.parents: (order.children, order.how) for order in plan.orders}
    assert orders["Rosli Bin Kamal & Suraya Binti Hashim"][1] == "dates"
    assert orders["Kamal Bin Daud & Kalsom Binti Yusof"] == (
        ("Rosli Bin Kamal", "Salmah", "Ja'far"),
        "chart",
    )
    assert orders["Aiman Bin Rosli & Nora binti Zakaria"][1] == "open"  # twins
    order = [people(plan)[name].birth_order for name in ("Rosli Bin Kamal", "Salmah", "Ja'far")]
    assert order == [1, 2, 3]
    assert people(plan)["Aiman Bin Rosli"].birth_order is None  # the dates decide
    no_chart = plan_for(Decisions(answers={"chart birth order": "no"}))
    assert people(no_chart)["Salmah"].birth_order is None


def test_places_that_look_like_defaults_can_be_left_out() -> None:
    plan = plan_for()

    [question] = [q for q in plan.questions if q.id == "spreadsheet places"]
    assert "Every one of the 8 rows gives Ipoh, Perak, Malaysia" in question.detail
    assert people(plan)["Kamal Bin Daud"].residence == Place(town="Ipoh", state="Perak")
    trimmed = plan_for(Decisions(answers={"spreadsheet places": "not-stand-ins"}))
    assert people(trimmed)["Kamal Bin Daud"].residence is None
    assert people(trimmed)["Aiman Bin Rosli"].residence == Place(town="Ipoh", state="Perak")


def test_genders_the_files_dont_give_are_listed_to_fill_in() -> None:
    plan = plan_for()

    labels = {choice.label for choice in plan.genders}
    assert {"Salmah", "Ahmad (married to Ahmad) #1", "Unnamed child"} <= labels
    given = plan_for(Decisions(genders={"Salmah": Gender.FEMALE}))
    assert people(given)["Salmah"].gender is Gender.FEMALE


def test_an_answer_that_isnt_offered_falls_back_to_the_proposal() -> None:
    plan = plan_for(Decisions(answers={"chart birth order": "maybe"}))

    assert plan.answers["chart birth order"] == "yes"
    assert any("'maybe' isn't an answer" in notice for notice in plan.notices)


def test_the_importer_explains_what_it_did() -> None:
    notices = " ".join(plan_for().notices)

    assert "'12/6/92' was read as 1992" in notices
    assert "Two different people named Ahmad are married to each other" in notices
    assert "names 'Idris Bin Musa' as father, but no row has that name" in notices
    assert "drag them into order in the app" in notices  # the twins
