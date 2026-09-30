"""A small fictional family for the export tests: marriages, a divorce, an adoption, a
guardian, an unknown parent, notes, a story and its sources."""

from uuid import uuid7

from ancestree.domain.dates import parse_partial_date
from ancestree.domain.person import Gender, PartialDate, Person, Place
from ancestree.domain.relationship import GenderedLabel, RelationshipKind, SpouseStatus
from ancestree.exchange.family import FamilyData, Member, ParentRow, SpouseRow

M, F = Gender.MALE, Gender.FEMALE


def _kind(
    key: str, label: str, parent: str, child: str, *, blood: bool = False
) -> RelationshipKind:
    return RelationshipKind(
        key=key,
        label=label,
        builtin=blood,
        blood=blood,
        active=True,
        in_layout=key != "guardian",
        sort_order={"biological": 1, "adoptive": 2, "foster": 3}.get(key, 4),
        parent_label=GenderedLabel(neutral=parent),
        child_label=GenderedLabel(neutral=child),
    )


KINDS = {
    "biological": RelationshipKind(
        key="biological",
        label="Biological",
        builtin=True,
        blood=True,
        active=True,
        in_layout=True,
        sort_order=1,
        parent_label=GenderedLabel(neutral="parent", male="father", female="mother"),
        child_label=GenderedLabel(neutral="child", male="son", female="daughter"),
    ),
    "adoptive": _kind("adoptive", "Adoptive", "adoptive parent", "adopted child"),
    "foster": _kind("foster", "Foster", "foster parent", "foster child"),
    "guardian": _kind("guardian", "Guardian", "guardian", "ward"),
}

NOTES = "Worked at the station @ Gemas, then Kuala Krai.\nKept a diary, 1958 to 1988."
STORY = "## Early life\n\nHassan was born in Kota Bharu.\n\n- Station master\n- Then at Gemas"


def sample_family() -> tuple[FamilyData, dict[str, str]]:
    """The family, and everyone's id by first name."""
    people: dict[str, Member] = {}
    ids: dict[str, str] = {}

    def add(
        name: str, gender: Gender = Gender.UNKNOWN, born: str | None = None, **more: object
    ) -> None:
        person = Person.model_validate(
            {
                "id": uuid7(),
                "full_name": name,
                "gender": gender,
                "birth_date": parse_partial_date(born),
                **more,
            }
        )
        member = Member(person=person, added=f"{len(people):03d}")
        people[member.id] = member
        ids[name.split()[0]] = member.id

    add("Ismail bin Abu", M, "c. 1910")
    add("Fatimah binti Daud", F, "before 1920")
    # Added before his elder sister, so birth order has to come from the dates.
    add(
        "Hassan bin Ismail",
        M,
        "12/3/1938",
        nickname="Acan",
        title="Haji",
        name_jawi="حسن بن إسماعيل",
        birth_place=Place(town="Kota Bharu", state="Kelantan"),
        death_date=PartialDate(year=2011),
        occupation="Station master",
        notes=NOTES,
    )
    add("Aminah binti Ismail", F, "1935")
    add("Mariam binti Salleh", F, "3/1940")
    add("Yusof bin Hassan", M, "1965")
    add("Nor binti Hassan", F, "1968")
    add("Latif bin Omar", M)
    add("Rahman bin Yusof", M, "1910-1915")
    add("Siti binti Ali", F, death_date=PartialDate(original_text="in the war"))
    add("Unknown", placeholder=True)
    add("Umar", M, "1970")
    add("Hana", F, "1972")

    hassan = people[ids["Hassan"]]
    people[hassan.id] = Member(
        person=hassan.person,
        added=hassan.added,
        story=STORY,
        sources=("Birth certificate, 1938", "Talk with Nor, 2019"),
    )

    def parent(parent_name: str, child: str, kind: str = "biological") -> ParentRow:
        return ParentRow(ids[parent_name], ids[child], kind)

    parents = [
        parent("Ismail", "Hassan"),
        parent("Fatimah", "Hassan"),
        parent("Ismail", "Aminah"),
        parent("Fatimah", "Aminah"),
        parent("Hassan", "Yusof"),
        parent("Mariam", "Yusof"),
        parent("Hassan", "Nor", "adoptive"),
        parent("Mariam", "Nor", "adoptive"),
        parent("Latif", "Nor", "guardian"),
        parent("Unknown", "Umar"),
        parent("Unknown", "Hana"),
    ]
    spouses = [
        SpouseRow(ids["Ismail"], ids["Fatimah"], SpouseStatus.MARRIED, 1),
        SpouseRow(ids["Hassan"], ids["Mariam"], SpouseStatus.MARRIED, 1),
        SpouseRow(ids["Rahman"], ids["Siti"], SpouseStatus.DIVORCED, None),
    ]
    return FamilyData(people, parents, spouses, dict(KINDS)), ids
