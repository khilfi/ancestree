"""Who is who in an imported spreadsheet, and what it changes."""

import csv
import io
from collections.abc import Mapping

from ancestree.domain.person import DateQualifier, PartialDate
from ancestree.exchange.family import FamilyData
from ancestree.exchange.spreadsheet import ENCODING, write_people_csv
from ancestree.importing.matching import (
    PlannedLink,
    SheetPlan,
    Tree,
    dates_agree,
    name_key,
    plan_sheet,
    skeleton,
)
from ancestree.importing.sheet import read_sheet
from ancestree.repo.mapping import person_to_props
from tests.unit.export_family import KINDS, sample_family

HEADER = "ID,Full name,Gender,Born,Parents,Spouses,Children,Nickname"


def tree_of(family: FamilyData, since: Mapping[str, Mapping[str, object]] | None = None) -> Tree:
    """The family as the tree an import meets; `since`: details changed in the tree since the
    file was exported, by person id."""
    since = since or {}
    people = [
        person_to_props(member.person.model_copy(update=since.get(member.id, {})))
        for member in family.members.values()
    ]
    links = [{"type": "parent", "source": r.parent, "target": r.child} for r in family.parents]
    links += [{"type": "spouse", "source": s.a, "target": s.b} for s in family.spouses]
    return Tree(people, links, KINDS)


def edited(
    family: FamilyData,
    cells: Mapping[tuple[str, str], str] | None = None,
    *,
    without: tuple[str, ...] = (),
    more: tuple[Mapping[str, str], ...] = (),
) -> bytes:
    """The family's spreadsheet export, edited as in Excel: cells by (full name, column),
    columns taken out, and rows added at the end."""
    rows = list(csv.DictReader(io.StringIO(write_people_csv(family))))
    for (name, column), text in (cells or {}).items():
        next(row for row in rows if row["Full name"] == name)[column] = text
    columns = [column for column in rows[0] if column not in without]
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows([*rows, *more])
    return buffer.getvalue().encode(ENCODING)


def planned(
    family: FamilyData, data: bytes, since: Mapping[str, Mapping[str, object]] | None = None
) -> SheetPlan:
    return plan_sheet(read_sheet(data), tree_of(family, since), {})


def sample_tree() -> tuple[Tree, dict[str, str]]:
    """The export tests' family as the tree an import meets; everyone's id by first name.
    Its ids are new each time, so build it once per test."""
    family, ids = sample_family()
    return tree_of(family), ids


EMPTY = Tree([], [], KINDS)


def plan(*rows: str, tree: Tree = EMPTY, answers: Mapping[str, str] | None = None) -> SheetPlan:
    text = "\r\n".join([HEADER, *rows]) + "\r\n"
    return plan_sheet(read_sheet(text.encode()), tree, answers or {})


def ends(link: PlannedLink) -> tuple[str, str, str]:
    return link.type, link.a[1], link.b[1]


def test_names_compare_without_titles_or_the_spelling_of_bin() -> None:
    assert name_key("Haji  Hassan b. Ismail") == "hassan bin ismail"
    assert name_key("Aminah bte Hassan") == "aminah binti hassan"
    assert skeleton(name_key("Hassan bin Ismail")) == skeleton(name_key("Hasan bin Ismael"))
    assert skeleton(name_key("Ali")) == "al"  # too short to go by


def test_birth_dates_agree_unless_they_cant_be_the_same() -> None:
    assert dates_agree(
        PartialDate(year=1950, qualifier=DateQualifier.ABOUT), PartialDate(year=1953)
    )
    assert not dates_agree(PartialDate(year=1950), PartialDate(year=1960))
    assert dates_agree(None, PartialDate(year=1960))
    assert dates_agree(
        PartialDate(year=1940, qualifier=DateQualifier.BEFORE), PartialDate(year=1935)
    )


def test_new_people_are_linked_among_themselves() -> None:
    result = plan(
        "P1,Ahmad bin Ali,Male,1950,,Zainab binti Omar,,",
        "P2,Zainab binti Omar,Female,1952,,,,",
        "P3,Hafiz bin Ahmad,Male,1975,P1; P2,,,",
    )
    assert [person.key for person in result.people] == ["row:2", "row:3", "row:4"]
    assert sorted(ends(link) for link in result.links) == [
        ("parent", "row:2", "row:4"),
        ("parent", "row:3", "row:4"),
        ("spouse", "row:2", "row:3"),
    ]
    assert result.questions == []
    assert result.left_out == []


def test_a_name_that_matches_nobody_becomes_someone_new() -> None:
    result = plan(
        "P1,Hafiz bin Ahmad,Male,1975,Ahmad bin Ali,,,",
        "P2,Salmah binti Ahmad,Female,1977,Ahmad Bin Ali,,,",
    )
    named = [person for person in result.people if person.row is None]
    assert [(p.data.full_name, p.named_in) for p in named] == [("Ahmad bin Ali", [2, 3])]
    assert {ends(link) for link in result.links} == {
        ("parent", "named:ahmad bin ali", "row:2"),
        ("parent", "named:ahmad bin ali", "row:3"),
    }


def test_names_in_the_tree_are_found_and_linked() -> None:
    tree, ids = sample_tree()
    result = plan(",Danial bin Yusof,Male,1990,Yusof bin Hassan,,,", tree=tree)
    assert [ends(link) for link in result.links] == [("parent", ids["Yusof"], "row:2")]


def test_an_id_from_the_tree_is_that_person() -> None:
    tree, ids = sample_tree()
    hassan = ids["Hassan"]
    result = plan(
        # Hassan's own row: the parents it lists are there already, as is his nickname. The
        # file has no Version, so it doesn't say which of the rest it changed.
        f"{hassan},Hassan bin Ismail,x,1939,Ismail bin Abu (father),,P9,Acan",
        "P9,Adam bin Hassan,Male,1975,,,,",
        tree=tree,
    )
    assert result.matched == {2: hassan}
    assert [person.key for person in result.people] == ["row:3"]
    assert [ends(link) for link in result.links] == [("parent", hassan, "row:3")]
    [gender] = result.left_out
    assert (gender.row, gender.column, gender.written) == (2, "Gender", "x")
    assert gender.why.endswith("Hassan bin Ismail's stays as it is.")
    [born, adam, link] = result.changes
    assert (born.id, born.before, born.after) == (f"set:{hassan}:birth_date", "12/3/1938", "1939")
    assert (born.unsure, born.ticked) == (True, False)  # without a Version: only by your tick
    assert (adam.id, adam.kind, adam.detail, adam.ticked) == (
        "add:row:3",
        "add_person",
        "b. 1975",
        True,
    )
    assert (link.kind, link.name, link.detail) == (
        "add_link",
        "Hassan bin Ismail",
        "father of Adam bin Hassan",
    )
    assert link.needs == ["add:row:3"]
    assert result.differences == []


def test_a_look_alike_in_the_tree_is_asked_about() -> None:
    tree, ids = sample_tree()
    hassan = ids["Hassan"]

    spelled = plan(",Hasan bin Ismail,Male,1938,,,,", tree=tree)
    [question] = spelled.questions
    assert question.id == "same:2"
    assert question.kind == "same_person"
    assert question.answer == "new"  # the names differ: someone new unless you say
    assert [o.id for o in question.options] == [f"person:{hassan}", "new"]
    assert question.options[0].detail == "b. 1938 · child of Ismail & Fatimah"
    assert [person.key for person in spelled.people] == ["row:2"]

    answered = plan(
        ",Hasan bin Ismail,Male,1938,,,,", tree=tree, answers={"same:2": f"person:{hassan}"}
    )
    assert answered.matched == {2: hassan}
    assert answered.people == []


def test_the_same_person_is_the_default_only_for_the_same_name_and_year() -> None:
    tree, ids = sample_tree()
    same = plan(",Haji Hassan b. Ismail,Male,1938,,,,", tree=tree)
    assert same.questions[0].answer == f"person:{ids['Hassan']}"
    assert same.people == []

    no_year = plan(",Hassan bin Ismail,,,,,,", tree=tree)
    assert no_year.questions[0].answer == "new"

    other_year = plan(",Hassan bin Ismail,,1970,,,,", tree=tree)  # can't be him
    assert other_year.questions == []


def test_a_name_several_rows_share_is_a_question() -> None:
    rows = (
        "P1,Karim bin Ali,Male,1940,,,,",
        "P2,Karim bin Ali,Male,1960,,,,",
        "P3,Faizal bin Karim,Male,1985,Karim bin Ali,,,",
    )
    asked = plan(*rows)
    question = next(q for q in asked.questions if q.id == "who:4:Parents:0")
    assert [o.id for o in question.options] == ["row:2", "row:3", "out"]
    assert question.answer == "out"
    assert asked.links == []
    assert [item.written for item in asked.chosen_out] == ["Karim bin Ali"]

    answered = plan(*rows, answers={"who:4:Parents:0": "row:3"})
    assert [ends(link) for link in answered.links] == [("parent", "row:3", "row:4")]


def test_only_part_of_a_name_is_a_question() -> None:
    tree, ids = sample_tree()
    asked = plan(",Adam bin Hassan,Male,1975,Hassan,,,", tree=tree)
    [question] = asked.questions
    assert question.text == "Only part of a name: did you mean Hassan bin Ismail?"
    assert [o.id for o in question.options] == [f"person:{ids['Hassan']}", "new", "out"]
    assert asked.links == []

    new = plan(",Adam bin Hassan,Male,1975,Hassan,,,", tree=tree, answers={question.id: "new"})
    assert [p.data.full_name for p in new.people] == ["Adam bin Hassan", "Hassan"]


def test_what_cant_be_read_is_left_out_and_the_rest_comes_in() -> None:
    result = plan(
        "P1,Hafiz bin Ahmad,x,31/2/1950,Ahmad bin Ali (step-father); Zainab binti Omar,,,",
        ",,Male,1950,,,,",
    )
    assert [(i.row, i.column, i.written) for i in result.left_out] == [
        (2, "Gender", "x"),
        (2, "Born", "31/2/1950"),
        (2, "Parents", "Ahmad bin Ali (step-father)"),
        (3, "Full name", ""),
    ]
    hafiz = result.people[0].data
    assert hafiz.birth_date == PartialDate(original_text="31/2/1950")  # for What's missing
    assert result.people[0].view().born is None  # the preview doesn't pass it off as a date
    assert [p.data.full_name for p in result.people] == ["Hafiz bin Ahmad", "Zainab binti Omar"]


def test_a_link_given_twice_is_made_once_and_a_kind_in_brackets_wins() -> None:
    result = plan(
        "P1,Ahmad bin Ali,Male,1950,,,P2 (adopted child),",
        "P2,Hafiz bin Ahmad,Male,1975,P1,,,",
    )
    [link] = result.links
    assert (link.a[1], link.b[1], link.kind) == ("row:2", "row:3", "adoptive")


def test_someone_as_their_own_parent_is_left_out() -> None:
    result = plan("P1,Ahmad bin Ali,Male,1950,P1,,,")
    assert result.links == []
    assert result.left_out[0].why == "Someone can't be their own parent."


def test_an_id_used_twice_is_found_only_the_first_time() -> None:
    result = plan(
        "P1,Ahmad bin Ali,Male,1950,,,,",
        "P1,Hafiz bin Ahmad,Male,1975,,,,",
        "P3,Adam bin Hafiz,Male,2000,P1,,,",
    )
    assert (result.left_out[0].row, result.left_out[0].column) == (3, "ID")
    assert [ends(link) for link in result.links] == [("parent", "row:2", "row:4")]


def test_an_exported_spreadsheet_brings_in_nobody_twice_and_changes_nothing() -> None:
    family, _ = sample_family()
    data = write_people_csv(family).encode(ENCODING)

    result = plan_sheet(read_sheet(data), tree_of(family), {})

    assert result.people == []
    assert result.links == []
    assert result.questions == []
    assert result.left_out == []  # Siti's "in the war" is hers already
    assert len(result.matched) == result.rows == 12
    assert result.differences == []
    assert result.changes == []


# --- What an exported file changes ---


def test_a_detail_changed_in_the_file_is_offered_and_ticked() -> None:
    family, ids = sample_family()
    data = edited(family, {("Hassan bin Ismail", "Occupation"): "Teacher"})

    [change] = planned(family, data).changes

    assert change.id == f"set:{ids['Hassan']}:occupation"
    assert (change.kind, change.column, change.before, change.after) == (
        "set",
        "Occupation",
        "Station master",
        "Teacher",
    )
    assert (change.ticked, change.clash, change.unsure) == (True, False, False)


def test_a_detail_changed_in_the_tree_since_stays_and_is_listed_as_newer() -> None:
    family, ids = sample_family()
    data = write_people_csv(family).encode(ENCODING)
    since = {ids["Hassan"]: {"occupation": "Teacher"}}

    result = planned(family, data, since)

    assert result.changes == []
    [newer] = result.differences
    assert (newer.column, newer.written, newer.in_tree) == (
        "Occupation",
        "Station master",
        "Teacher",
    )


def test_a_detail_changed_in_both_is_a_clash_that_waits_for_a_tick() -> None:
    family, ids = sample_family()
    data = edited(family, {("Hassan bin Ismail", "Occupation"): "Teacher"})

    [clash] = planned(family, data, {ids["Hassan"]: {"occupation": "Clerk"}}).changes
    assert (clash.before, clash.after, clash.clash, clash.ticked) == (
        "Clerk",
        "Teacher",
        True,
        False,
    )

    alike = planned(family, data, {ids["Hassan"]: {"occupation": "Teacher"}})
    assert alike.changes == []  # both changed it the same way


def test_a_cell_emptied_in_the_file_clears_the_detail() -> None:
    family, _ = sample_family()
    data = edited(family, {("Hassan bin Ismail", "Nickname"): ""})

    [change] = planned(family, data).changes

    assert (change.column, change.before, change.after, change.ticked) == (
        "Nickname",
        "Acan",
        "",
        True,
    )


def test_a_column_taken_out_of_the_file_says_nothing() -> None:
    family, _ = sample_family()
    data = edited(family, without=("Nickname", "Occupation", "Notes"))

    assert planned(family, data).changes == []


def test_what_excel_rewrites_is_the_same_value() -> None:
    family, _ = sample_family()
    data = edited(
        family,
        {
            ("Hassan bin Ismail", "Born"): "12/03/1938",
            ("Hassan bin Ismail", "Birthplace"): "Kota Bharu,  Kelantan",
            ("Hassan bin Ismail", "Title"): "HAJI",
        },
    )

    assert planned(family, data).changes == []


def test_a_detail_that_cant_be_read_stays_as_it_is() -> None:
    family, _ = sample_family()
    data = edited(family, {("Hassan bin Ismail", "Gender"): "x"})

    result = planned(family, data)

    assert result.changes == []
    [gender] = result.left_out
    assert (gender.column, gender.written) == ("Gender", "x")


def test_a_date_that_cant_be_read_is_offered_as_written_and_waits() -> None:
    family, _ = sample_family()
    data = edited(family, {("Hassan bin Ismail", "Born"): "31/2/1938"})

    [change] = planned(family, data).changes

    assert (change.before, change.after, change.ticked) == ("12/3/1938", "31/2/1938", False)
    assert change.detail is not None
    assert change.detail.endswith("Kept as written, to pick the date later.")


def test_without_a_version_what_differs_waits_and_an_empty_cell_says_nothing() -> None:
    family, ids = sample_family()
    data = edited(
        family,
        {
            ("Hassan bin Ismail", "Version"): "",
            ("Hassan bin Ismail", "Nickname"): "",
            ("Hassan bin Ismail", "Occupation"): "Teacher",
        },
    )

    [change] = planned(family, data).changes

    assert change.id == f"set:{ids['Hassan']}:occupation"
    assert (change.unsure, change.ticked) == (True, False)


def test_remove_marks_someone_to_take_out_and_only_your_tick_does() -> None:
    family, ids = sample_family()
    latif = ids["Latif"]
    data = edited(
        family,
        {("Latif bin Omar", "Remove"): "yes", ("Latif bin Omar", "Occupation"): "Driver"},
        more=({"Full name": "Aishah binti Latif", "Parents": latif},),
    )

    result = planned(family, data)

    added, link, removal = result.changes  # Latif's other cells are passed over
    assert (removal.id, removal.kind, removal.ticked) == (f"remove:{latif}", "remove_person", False)
    assert removal.detail == "parent of Nor"
    assert link.blocked_by == [f"remove:{latif}"]
    everything = [change.id for change in result.changes]
    # No link to someone taken out.
    assert result.carried_out(everything) == {added.id, removal.id}
    assert result.carried_out(None) == {added.id, link.id}
    assert result.reached({added.id, link.id}) == {latif}


def test_remove_on_someone_new_skips_the_row_and_its_links() -> None:
    marked = plan_sheet(
        read_sheet(
            b"ID,Full name,Parents,Remove\r\n"
            b"P1,Ahmad bin Ali,,yes\r\n"
            b"P2,Hafiz bin Ahmad,P1; Ahmad bin Ali,\r\n"
        ),
        EMPTY,
        {},
    )
    assert [person.key for person in marked.people] == ["row:3"]
    assert marked.links == []
    assert [(item.row, item.column) for item in marked.left_out] == [
        (2, "Remove"),
        (3, "Parents"),
        (3, "Parents"),
    ]


def test_a_link_needs_the_new_people_it_joins() -> None:
    result = plan(
        "P1,Ahmad bin Ali,Male,1950,,Zainab binti Omar,,",
        "P2,Zainab binti Omar,Female,1952,,,,",
    )
    [ahmad, zainab, marriage] = result.changes
    assert sorted(marriage.needs) == [ahmad.id, zainab.id]
    assert result.carried_out([marriage.id, ahmad.id]) == {ahmad.id}


def test_a_version_ancestree_didnt_write_is_a_second_look() -> None:
    family, _ = sample_family()
    data = edited(family, {("Hassan bin Ismail", "Version"): "v1.nonsense"})

    [look] = planned(family, data).second_look

    assert "Version isn't one AncesTree wrote" in look.message
