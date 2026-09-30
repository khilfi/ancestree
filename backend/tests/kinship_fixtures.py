"""Families for the relationship finder's tests, each built in a few lines."""

from ancestree.domain.person import Gender, PartialDate
from ancestree.domain.relationship import (
    GenderedLabel,
    KindWords,
    RelationshipKind,
    SpouseStatus,
)
from ancestree.kinship.family import Family, Marriage, Member, ParentLink, short_name
from ancestree.kinship.finder import Relation, relate
from ancestree.kinship.terms import TermBook
from ancestree.seed.family import load_seed_family, seed_id

ENGLISH = TermBook.load("en")
MALAY = TermBook.load("ms")
JAVANESE = TermBook.load("jv")
BOOKS = {"en": ENGLISH, "ms": MALAY, "jv": JAVANESE}


type Labels = tuple[str, str | None, str | None]  # neutral, male, female


def _label(labels: Labels) -> GenderedLabel:
    return GenderedLabel(neutral=labels[0], male=labels[1], female=labels[2])


def _kind(
    key: str,
    *,
    blood: bool = False,
    in_layout: bool = True,
    parent: Labels,
    child: Labels,
    words: dict[str, tuple[str, Labels, Labels]] | None = None,
) -> RelationshipKind:
    return RelationshipKind(
        key=key,
        label=key.capitalize(),
        builtin=blood,
        blood=blood,
        active=True,
        in_layout=in_layout,
        sort_order=1,
        parent_label=_label(parent),
        child_label=_label(child),
        words={
            code: KindWords(label=label, parent_label=_label(p), child_label=_label(c))
            for code, (label, p, c) in (words or {}).items()
        },
    )


# As the migrations define them, plus a guardian, a kind that doesn't place the child.
KINDS = {
    kind.key: kind
    for kind in (
        _kind(
            "biological",
            blood=True,
            parent=("parent", "father", "mother"),
            child=("child", "son", "daughter"),
        ),
        _kind(
            "adoptive",
            parent=("adoptive parent", "adoptive father", "adoptive mother"),
            child=("adopted child", "adopted son", "adopted daughter"),
            words={  # as the M9 migration gives them
                "ms": (
                    "angkat",
                    ("bapa atau emak angkat", "bapa angkat", "emak angkat"),
                    ("anak angkat", None, None),
                ),
                "jv": (
                    "angkat",
                    ("wong tuwa angkat", "bapak angkat", "ibu angkat"),
                    ("anak pupon", None, None),
                ),
            },
        ),
        _kind(
            "foster",
            parent=("foster parent", "foster father", "foster mother"),
            child=("foster child", "foster son", "foster daughter"),
            words={
                "ms": (
                    "angkat",
                    ("bapa atau emak angkat", "bapa angkat", "emak angkat"),
                    ("anak angkat", None, None),
                ),
                "jv": (
                    "asuh",
                    ("wong tuwa asuh", "bapak asuh", "ibu asuh"),
                    ("anak asuh", None, None),
                ),
            },
        ),
        _kind(
            "guardian", in_layout=False, parent=("guardian", None, None), child=("ward", None, None)
        ),
    )
}

GENDERS = {"m": Gender.MALE, "f": Gender.FEMALE, "?": Gender.UNKNOWN}


class Builder:
    """A family by hand: people by name, then who is whose child and who married whom.

    b = Builder(); b.person("Tok", "m"); b.person("Ali", "m", born=1980); b.child("Tok", "Ali")
    """

    def __init__(self) -> None:
        self.members: dict[str, Member] = {}
        self.links: list[ParentLink] = []
        self.marriages: list[Marriage] = []

    def person(
        self,
        name: str,
        gender: str = "?",
        *,
        born: int | tuple[int, int, int] | None = None,
        order: int | None = None,
        unknown_parent: bool = False,
    ) -> str:
        birth = None
        if isinstance(born, tuple):
            birth = PartialDate(year=born[0], month=born[1], day=born[2])
        elif born is not None:
            birth = PartialDate(year=born)
        self.members[name] = Member(
            name, name, GENDERS[gender], birth, order, placeholder=unknown_parent
        )
        return name

    def people(self, spec: str) -> None:
        """ "Tok:m Nek:f Ali:m" -> three people."""
        for item in spec.split():
            name, gender = item.split(":")
            self.person(name, gender)

    def child(self, parent: str, *children: str, kind: str = "biological") -> None:
        for child in children:
            self.links.append(ParentLink(f"{parent}>{child}", parent, child, kind))

    def parents(self, parents: tuple[str, ...], *children: str, kind: str = "biological") -> None:
        for parent in parents:
            self.child(parent, *children, kind=kind)

    def marry(self, a: str, b: str, status: SpouseStatus = SpouseStatus.MARRIED) -> None:
        self.marriages.append(Marriage(f"{a}={b}", a, b, status))

    def family(self) -> Family:
        return Family(self.members.values(), self.links, self.marriages, KINDS)

    def relate(self, a: str, b: str) -> list[Relation]:
        return relate(self.family(), a, b, ENGLISH, BOOKS)

    def says(self, a: str, b: str) -> str:
        """The main answer: "Zul is Ali's uncle"."""
        relations = self.relate(a, b)
        return relations[0].forward.sentence if relations else ""

    def word(self, a: str, b: str, language: str) -> str:
        """The main answer's word in a language: "pak long" (ms), "pakdhé" (jv)."""
        relations = self.relate(a, b)
        return relations[0].forward.words[language].term if relations else ""


def seed() -> tuple[Family, dict[str, str]]:
    """The fictional test family "Keluarga Contoh", and each person's id by key."""
    family = load_seed_family()
    ids = {p.key: str(seed_id(f"person:{p.key}")) for p in family.people}
    members = [
        Member(
            ids[p.key],
            "an unknown parent" if p.placeholder else short_name(p.full_name, p.nickname),
            p.gender,
            p.birth,
            p.birth_order,
            p.placeholder,
        )
        for p in family.people
    ]
    parent_links = [
        ParentLink(str(link.id), str(link.parent_id), str(link.child_id), link.kind)
        for link in family.parent_links()
    ]
    marriages = [
        Marriage(str(link.id), str(link.person_a), str(link.person_b), link.status)
        for link in family.spouse_links()
    ]
    return Family(members, parent_links, marriages, KINDS), ids
