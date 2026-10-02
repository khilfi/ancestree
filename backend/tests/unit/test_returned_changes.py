"""What a relative's computer sends back: read strictly,
and compared three ways with the family their changes were made on and the tree now. The
fictional family's names; each case built in a few lines."""

import base64
import io
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import pytest
from PIL import Image

from ancestree.domain.imports import ImportChange
from ancestree.domain.relationship import SpouseStatus
from ancestree.exchange.returned import (
    DamagedError,
    Returned,
    ReturnedLink,
    ReturnedPerson,
    ReturnedPhoto,
    ReturnedStory,
    sent_family,
)
from ancestree.importing.returned import (
    AddLink,
    Base,
    FillIn,
    Order,
    Photo,
    Relink,
    Remove,
    ReturnedPlan,
    SetDetail,
    Siblings,
    Story,
    TreeNow,
    Unlink,
    plan_returned,
)
from tests.kinship_fixtures import KINDS

SENDER = "5e4d3c2b1a090807"  # Mak Long's laptop, by its id in the family folder


def pid(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"person:{name}"))


def lid(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"link:{name}"))


def person(name: str, **props: Any) -> dict[str, Any]:
    return {
        "id": pid(name),
        "full_name": name,
        "gender": props.pop("gender", "unknown"),
        "placeholder": props.pop("placeholder", False),
        "has_photo": props.pop("has_photo", False),
        **props,
    }


def parent(key: str, a: str, b: str, kind: str = "biological") -> dict[str, Any]:
    return {
        "id": lid(key),
        "type": "parent",
        "source": pid(a),
        "target": pid(b),
        "kind": kind,
        "status": None,
    }


def spouse(key: str, a: str, b: str, status: str = "married") -> dict[str, Any]:
    return {
        "id": lid(key),
        "type": "spouse",
        "source": pid(a),
        "target": pid(b),
        "kind": None,
        "status": status,
    }


HASSAN = person(
    "Hassan bin Ismail",
    gender="male",
    birth_year=1938,
    birth_month=3,
    birth_day=14,
    birth_town="Kota Bharu",
    birth_state="Kelantan",
    birth_country="Malaysia",
    death_year=2011,
)
FATIMAH = person("Fatimah binti Yusof", gender="female", birth_year=1941)
AMINAH = person(
    "Aminah binti Hassan", gender="female", birth_year=1962, birth_order=1, occupation="Cikgu"
)
ZUL = person("Zulkifli bin Hassan", gender="male", birth_year=1965, birth_order=2)
PEOPLE = [HASSAN, FATIMAH, AMINAH, ZUL]
LINKS = [
    spouse("hassan+fatimah", "Hassan bin Ismail", "Fatimah binti Yusof"),
    parent("hassan>aminah", "Hassan bin Ismail", "Aminah binti Hassan"),
    parent("fatimah>aminah", "Fatimah binti Yusof", "Aminah binti Hassan"),
    parent("hassan>zul", "Hassan bin Ismail", "Zulkifli bin Hassan"),
    parent("fatimah>zul", "Fatimah binti Yusof", "Zulkifli bin Hassan"),
]


def base(
    people: list[dict[str, Any]] = PEOPLE,
    links: list[dict[str, Any]] = LINKS,
    stories: dict[str, Any] | None = None,
) -> Base:
    return Base(
        people={p["id"]: dict(p) for p in people},
        links={link["id"]: dict(link) for link in links},
        stories=stories or {},
        ids={},
    )


def tree(
    people: list[dict[str, Any]] = PEOPLE,
    links: list[dict[str, Any]] = LINKS,
    stories: dict[str, str | None] | None = None,
) -> TreeNow:
    return TreeNow(
        people={p["id"]: dict(p) for p in people},
        links=[dict(link) for link in links],
        kinds=dict(KINDS),
        stories=stories or {},
    )


def came_back(
    people: list[dict[str, Any]] = PEOPLE,
    links: list[dict[str, Any]] = LINKS,
    stories: dict[str, dict[str, Any]] | None = None,
    files: dict[str, str] | None = None,
    photos: dict[str, Any] | None = None,
) -> Returned:
    return Returned(
        sender=SENDER,
        people={p["id"]: ReturnedPerson.model_validate(p) for p in people},
        links={link["id"]: ReturnedLink.model_validate(link) for link in links},
        stories={k: ReturnedStory.model_validate(v) for k, v in (stories or {}).items()},
        files=files or {},
        photos={k: ReturnedPhoto.model_validate(v) for k, v in (photos or {}).items()},
    )


def changed(people: list[dict[str, Any]], name: str, **props: Any) -> list[dict[str, Any]]:
    return [{**p, **props} if p["full_name"] == name else p for p in people]


def without(people: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [p for p in people if p["full_name"] != name]


def by_kind(plan: ReturnedPlan, kind: str) -> list[ImportChange]:
    return [change for change in plan.changes if change.kind == kind]


def webp(colour: tuple[int, int, int] = (200, 150, 90), size: int = 64) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), colour).save(buffer, "WEBP")
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


# --- Details ------------------------------------------------------------------------------------


def test_a_detail_only_they_changed_is_offered_ticked() -> None:
    back = came_back(changed(PEOPLE, "Aminah binti Hassan", occupation="Guru besar"))

    plan = plan_returned(base(), back, tree(), {})

    [change] = plan.changes
    assert (change.kind, change.column, change.before, change.after) == (
        "set",
        "Occupation",
        "Cikgu",
        "Guru besar",
    )
    assert (change.ticked, change.clash, change.unsure) == (True, False, False)
    assert plan.operations[change.id] == SetDetail(
        pid("Aminah binti Hassan"), "occupation", {"occupation": "Guru besar"}
    )


def test_what_both_changed_differently_is_a_clash_and_the_tree_keeps_it_unless_ticked() -> None:
    back = came_back(changed(PEOPLE, "Aminah binti Hassan", occupation="Guru besar"))
    now = tree(changed(PEOPLE, "Aminah binti Hassan", occupation="Pengetua"))

    [change] = plan_returned(base(), back, now, {}).changes

    assert (change.before, change.after, change.clash, change.ticked) == (
        "Pengetua",
        "Guru besar",
        True,
        False,
    )


def test_what_only_the_tree_changed_since_isnt_offered() -> None:
    now = tree(changed(PEOPLE, "Aminah binti Hassan", occupation="Pengetua"))
    both = changed(PEOPLE, "Zulkifli bin Hassan", nickname="Zul")

    assert plan_returned(base(), came_back(), now, {}).changes == []
    # Nor what both changed the same way.
    assert plan_returned(base(), came_back(both), tree(both), {}).changes == []


def test_the_same_file_again_brings_nothing_new() -> None:
    back = came_back(changed(PEOPLE, "Aminah binti Hassan", occupation="Guru besar"))
    brought = base(
        [{**p, **{}} for p in changed(PEOPLE, "Aminah binti Hassan", occupation="Guru besar")]
    )

    assert plan_returned(brought, back, tree(), {}).changes == []


def test_a_date_the_app_cant_read_is_left_out_and_the_rest_comes_in() -> None:
    back = came_back(
        changed(PEOPLE, "Zulkifli bin Hassan", birth_month=2, birth_day=30, nickname="Zul")
    )

    plan = plan_returned(base(), back, tree(), {})

    assert [(c.column, c.after) for c in plan.changes] == [("Nickname", "Zul")]
    assert [(item.column, item.written) for item in plan.left_out] == [
        ("Zulkifli bin Hassan", "Born")
    ]


# --- People -------------------------------------------------------------------------------------


def test_someone_new_is_offered_and_their_links_need_them() -> None:
    siti = person("Siti binti Zulkifli", gender="female", birth_year=1992)
    link = parent("zul>siti", "Zulkifli bin Hassan", "Siti binti Zulkifli")

    plan = plan_returned(base(), came_back([*PEOPLE, siti], [*LINKS, link]), tree(), {})

    added, linked = plan.changes
    assert (added.kind, added.name, added.detail, added.ticked) == (
        "add_person",
        "Siti binti Zulkifli",
        "b. 1992",
        True,
    )
    assert (linked.kind, linked.name, linked.detail) == (
        "add_link",
        "Zulkifli bin Hassan",
        "father of Siti binti Zulkifli",
    )
    assert (linked.needs, linked.ticked) == ([added.id], True)
    assert plan.operations[linked.id] == AddLink(
        "parent",
        pid("Zulkifli bin Hassan"),
        siti["id"],
        "biological",
        SpouseStatus.MARRIED,
        link["id"],
    )
    assert plan.carried_out([linked.id]) == set()  # not without her
    assert plan.carried_out(None) == {added.id, linked.id}


def test_someone_new_who_looks_like_someone_in_the_tree_is_asked_about() -> None:
    # Added in the app since their changes started, and by them too, with more in it.
    siti_here = person("Siti binti Zulkifli", gender="female", birth_year=1992)
    siti_there = {
        **person("Siti binti Zulkifli", gender="female", birth_year=1992, occupation="Jururawat"),
        "id": pid("Siti, as they sent her"),
    }
    link = parent("zul>siti", "Zulkifli bin Hassan", "Siti, as they sent her")
    link["target"] = siti_there["id"]
    back = came_back([*PEOPLE, siti_there], [*LINKS, link])
    now = tree([*PEOPLE, siti_here])

    plan = plan_returned(base(), back, now, {})

    [question] = plan.questions
    assert question.kind == "same_person"
    assert question.answer == f"person:{siti_here['id']}"  # the same name and birth year
    [detail, linked] = plan.changes
    assert (detail.kind, detail.column, detail.after, detail.unsure, detail.ticked) == (
        "set",
        "Occupation",
        "Jururawat",
        True,
        False,
    )
    assert linked.needs == []  # she's in the tree already
    assert plan.operations[linked.id].b == siti_here["id"]  # type: ignore[union-attr]
    assert plan.ids == {siti_there["id"]: siti_here["id"]}

    someone_else = plan_returned(base(), back, now, {question.id: "new"})
    assert [c.kind for c in someone_else.changes] == ["add_person", "add_link"]


def test_someone_they_took_out_waits_for_their_own_tick() -> None:
    links = [
        link
        for link in LINKS
        if "zul" not in link["id"]
        and pid("Zulkifli bin Hassan") not in (link["source"], link["target"])
    ]

    plan = plan_returned(
        base(), came_back(without(PEOPLE, "Zulkifli bin Hassan"), links), tree(), {}
    )

    [removal] = plan.changes  # their links go with them
    assert (removal.kind, removal.removes, removal.ticked) == ("remove_person", True, False)
    assert plan.operations[removal.id] == Remove(pid("Zulkifli bin Hassan"))


# --- Links --------------------------------------------------------------------------------------


def test_links_taken_out_and_changed_come_back() -> None:
    links = [
        spouse("hassan+fatimah", "Hassan bin Ismail", "Fatimah binti Yusof", "widowed"),
        parent("hassan>aminah", "Hassan bin Ismail", "Aminah binti Hassan", "adoptive"),
        parent("fatimah>aminah", "Fatimah binti Yusof", "Aminah binti Hassan"),
        parent("hassan>zul", "Hassan bin Ismail", "Zulkifli bin Hassan"),
    ]

    plan = plan_returned(base(), came_back(PEOPLE, links), tree(), {})

    kind, marriage, gone = sorted(plan.changes, key=lambda c: (c.kind, c.column or ""))
    assert [(c.kind, c.column, c.before, c.after) for c in (kind, marriage, gone)] == [
        ("change_link", "Kind of link", "biological", "adoptive"),
        ("change_link", "Marriage", "married", "widowed"),
        ("remove_link", None, None, None),
    ]
    assert gone.detail == "no longer mother of Zulkifli bin Hassan"
    assert (gone.removes, gone.ticked) == (True, False)
    assert plan.operations[gone.id] == Unlink(lid("fatimah>zul"))
    assert plan.operations[kind.id] == Relink(lid("hassan>aminah"), "adoptive", None, swap=False)


def test_a_parent_link_turned_round_comes_back() -> None:
    wrong = parent("zul>fatimah", "Zulkifli bin Hassan", "Fatimah binti Yusof")
    right = {**wrong, "source": wrong["target"], "target": wrong["source"]}

    plan = plan_returned(
        base(links=[*LINKS, wrong]),
        came_back(links=[*LINKS, right]),
        tree(links=[*LINKS, wrong]),
        {},
    )

    [change] = plan.changes
    assert (change.kind, change.column) == ("change_link", "Which is the parent")
    assert plan.operations[change.id] == Relink(wrong["id"], None, None, swap=True)


def test_brothers_and_sisters_joined_under_an_unknown_parent_come_back_as_one_change() -> None:
    ali = person("Ali bin Rosli", gender="male", birth_year=1980)
    nora = person("Nora binti Rosli", gender="female", birth_year=1983)
    unknown = person("Unknown parent", placeholder=True)
    links = [
        parent("?>ali", "Unknown parent", "Ali bin Rosli"),
        parent("?>nora", "Unknown parent", "Nora binti Rosli"),
    ]
    start = [*PEOPLE, ali, nora]

    plan = plan_returned(
        base(start), came_back([*start, unknown], [*LINKS, *links]), tree(start), {}
    )

    [change] = plan.changes
    assert (change.kind, change.name, change.detail) == (
        "add_link",
        "Ali bin Rosli and Nora binti Rosli",
        "brothers and sisters, their parents not known yet",
    )
    assert plan.operations[change.id] == Siblings(
        unknown["id"], (ali["id"], nora["id"]), (links[0]["id"], links[1]["id"])
    )


def test_an_unknown_parent_filled_in_comes_back_as_a_fill_in() -> None:
    ali = person("Ali bin Rosli", gender="male", birth_year=1980)
    nora = person("Nora binti Rosli", gender="female", birth_year=1983)
    unknown = person("Unknown parent", placeholder=True)
    rosli = person("Rosli bin Ahmad", gender="male", birth_year=1950)
    joined = [
        parent("?>ali", "Unknown parent", "Ali bin Rosli"),
        parent("?>nora", "Unknown parent", "Nora binti Rosli"),
    ]
    filled = [
        parent("rosli>ali", "Rosli bin Ahmad", "Ali bin Rosli"),
        parent("rosli>nora", "Rosli bin Ahmad", "Nora binti Rosli"),
    ]
    start = [*PEOPLE, ali, nora, unknown]

    plan = plan_returned(
        base(start, [*LINKS, *joined]),
        came_back([*PEOPLE, ali, nora, rosli], [*LINKS, *filled]),
        tree(start, [*LINKS, *joined]),
        {},
    )

    added, fill = plan.changes
    assert (added.kind, fill.kind) == ("add_person", "fill_in")
    assert fill.detail == "fills in the unknown parent of Ali bin Rosli and Nora binti Rosli"
    assert fill.needs == [added.id]
    assert plan.operations[fill.id] == FillIn(unknown["id"], rosli["id"], (ali["id"], nora["id"]))


def test_a_new_birth_order_comes_back_for_the_whole_family() -> None:
    swapped = changed(
        changed(PEOPLE, "Aminah binti Hassan", birth_order=2), "Zulkifli bin Hassan", birth_order=1
    )

    plan = plan_returned(base(), came_back(swapped), tree(), {})

    [change] = plan.changes
    assert (change.kind, change.before, change.after, change.ticked) == (
        "order",
        "Aminah binti Hassan, Zulkifli bin Hassan",
        "Zulkifli bin Hassan, Aminah binti Hassan",
        True,
    )
    assert change.name == "The children of Hassan bin Ismail & Fatimah binti Yusof"
    assert plan.operations[change.id] == Order(
        frozenset({pid("Hassan bin Ismail"), pid("Fatimah binti Yusof")}),
        (pid("Zulkifli bin Hassan"), pid("Aminah binti Hassan")),
    )


# --- Stories and photos --------------------------------------------------------------------------


def test_a_story_comes_back_with_its_new_pictures() -> None:
    hassan = pid("Hassan bin Ismail")
    then = {hassan: {"story": "He worked on the railway.", "sources": []}}
    now = {
        hassan: {
            "story": "He worked on the railway for thirty years.\n\n"
            "![At Gemas](media/2026-10-01-abc123.webp)",
            "sources": ["Talk with Nor, 2019"],
        }
    }
    picture = webp()
    files = {f"/api/persons/{hassan}/media/2026-10-01-abc123.webp": picture}
    in_tree: dict[str, str | None] = {hassan: "He worked on the railway.\n"}

    plan = plan_returned(
        base(stories=then), came_back(stories=now, files=files), tree(stories=in_tree), {}
    )

    [change] = plan.changes
    assert (change.kind, change.detail, change.ticked) == ("story", "changed", True)
    assert change.before == "He worked on the railway."
    story = plan.operations[change.id]
    assert isinstance(story, Story)
    assert story.pictures == {
        "2026-10-01-abc123.webp": f"/api/persons/{hassan}/media/2026-10-01-abc123.webp"
    }
    assert story.text.endswith("## Sources\n\n- Talk with Nor, 2019\n")

    # Written in the app too since: a clash, the tree's kept unless ticked.
    other = plan_returned(
        base(stories=then),
        came_back(stories=now, files=files),
        tree(stories={hassan: "Kerja di KTM.\n"}),
        {},
    )
    assert (other.changes[0].clash, other.changes[0].ticked) == (True, False)


def test_photos_come_back_added_and_taken_out() -> None:
    picture = webp()
    with_photo = changed(
        changed(PEOPLE, "Aminah binti Hassan", has_photo=True, photo_version=1),
        "Hassan bin Ismail",
        has_photo=False,
    )
    had_photo = changed(PEOPLE, "Hassan bin Ismail", has_photo=True, photo_version=3)

    plan = plan_returned(
        base(had_photo),
        came_back(
            with_photo,
            photos={
                pid("Aminah binti Hassan"): {
                    "display": picture,
                    "crop": {"x": 0, "y": 0, "width": 100, "height": 100},
                }
            },
        ),
        tree(had_photo),
        {},
    )

    added, gone = plan.changes
    assert (added.kind, added.name, added.detail, added.ticked) == (
        "photo",
        "Aminah binti Hassan",
        "added",
        True,
    )
    assert (gone.name, gone.detail, gone.removes, gone.ticked) == (
        "Hassan bin Ismail",
        "taken out",
        True,
        False,
    )
    photo = plan.operations[added.id]
    assert isinstance(photo, Photo)
    assert (photo.display, photo.version) == (picture, None)


# --- Reading what was sent ---------------------------------------------------------------------


def sent(**family: Any) -> dict[str, Any]:
    return {
        "family": {"people": PEOPLE, "links": LINKS, **family},
        "stories": {},
        "files": {},
        "photos": {},
    }


def test_what_a_computer_sent_is_read_by_who_sent_it() -> None:
    back = sent_family(sent(), SENDER)
    assert back.sender == SENDER
    assert back.people[pid("Hassan bin Ismail")].birth_town == "Kota Bharu"
    assert back.links[lid("hassan>zul")].type == "parent"


def test_a_record_out_of_shape_is_refused_whole() -> None:
    with pytest.raises(DamagedError, match=r"family\.people"):
        sent_family(sent(people=[{**HASSAN, "birth_month": 13}, *PEOPLE[1:]]), SENDER)
    with pytest.raises(DamagedError):
        sent_family(sent(links=[{**LINKS[0], "type": "cousin"}]), SENDER)
    with pytest.raises(DamagedError):
        sent_family(["not", "a", "family"], SENDER)
    assert sent_family(sent(), SENDER).people  # the good one stays good
