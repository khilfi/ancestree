"""Golden files for a view-only copy's kinship engine.

The Python engine answers pairs of people in a few made-up families, and its answers are
written down in frontend/src/kinship/golden/. The copy's TypeScript engine must give the same
answers, word for word (src/kinship/golden.test.ts), and tests/unit/test_kinship_golden_files.py
fails while a file is out of date. After a change to the engine, write them again, in backend/:

    uv run python -m tests.kinship_golden

Each file holds a family as a copy has it (the graph's people and links, and the kinds), the
word lists as a copy carries them, and the answers exactly as the API gives them.
"""

import gzip
import json
import random
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import permutations
from pathlib import Path
from typing import Any
from uuid import UUID, uuid5

from ancestree.config import REPO_ROOT
from ancestree.domain.person import Gender, PartialDate, Person
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind
from ancestree.kinship.terms import Titles
from ancestree.repo.mapping import person_to_props
from ancestree.seed.family import load_seed_family
from ancestree.seed.generated import generated_family
from ancestree.services.graph import build_graph
from ancestree.services.kinship import Finder, term_books, twin_inputs
from tests.kinship_fixtures import KINDS

GOLDEN = REPO_ROOT / "frontend" / "src" / "kinship" / "golden"
_NAMESPACE = UUID("0b8e6a1c-5f47-4d2b-9c3e-7a1d2f6b8e40")
_GENDERS = {"m": Gender.MALE, "f": Gender.FEMALE, "?": Gender.UNKNOWN}
# What read_family returns for each person (repo/graph.py), in its order.
_ROW = ("id", "full_name", "nickname", "gender", "birth_year", "birth_month", "birth_day",
        "birth_qualifier", "birth_year_to", "death_year", "death_month", "death_day",
        "death_qualifier", "death_year_to", "living", "birth_order", "placeholder",
        "photo_version", "birth_town", "birth_state", "birth_country", "x", "y",
        "birth_original_text")  # fmt: skip
# What the copy's engine reads of the graph (src/kinship/family.ts).
_PERSON = {"id", "full_name", "nickname", "gender", "born", "birth_order", "placeholder",
           "photo_version"}  # fmt: skip
_LINK = {"id", "type", "source", "target", "kind", "status"}


def row_of(person: Person) -> dict[str, Any]:
    """A person as the database returns them for the tree and the finder (read_family)."""
    props = person_to_props(person)
    return {name: props.get(name) for name in _ROW} | {
        "gender": props.get("gender") or "unknown",
        "placeholder": bool(props.get("placeholder")),
        "photo_version": props.get("photo_version") if props.get("has_photo") else None,
        "x": None,
        "y": None,
    }


def link_row(
    link_id: UUID | str,
    type_: str,
    source: UUID | str,
    target: UUID | str,
    kind: str | None = None,
    status: str | None = None,
    order: int | None = None,
) -> dict[str, Any]:
    return {
        "id": str(link_id),
        "type": type_,
        "source": str(source),
        "target": str(target),
        "kind": kind,
        "status": status,
        "order": order,
    }


def in_read_order(
    people: list[dict[str, Any]], links: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """In the order read_family gives them: people by birth year, then name; links by type,
    then id. The finder takes a person's marriages in that order."""
    people = sorted(
        people,
        key=lambda row: (row["birth_year"] is None, row["birth_year"] or 0, row["full_name"]),
    )
    return people, sorted(links, key=lambda link: (link["type"], link["id"]))


@dataclass
class Sketch:
    """A made-up family, a few lines each: people by key, then who is whose child and who
    married whom."""

    name: str
    people: list[Person] = field(default_factory=list)
    ids: dict[str, str] = field(default_factory=dict)
    links: list[dict[str, Any]] = field(default_factory=list)

    def person(
        self,
        key: str,
        full_name: str,
        gender: str = "?",
        *,
        born: int | tuple[int, int] | tuple[int, int, int] | None = None,
        died: int | None = None,
        order: int | None = None,
        nickname: str | None = None,
        unknown: bool = False,
        photo: bool = False,
    ) -> str:
        person_id = uuid5(_NAMESPACE, f"{self.name}:person:{key}")
        birth = None
        if isinstance(born, int):
            birth = PartialDate(year=born)
        elif born is not None:
            birth = PartialDate(year=born[0], month=born[1], day=born[2] if len(born) > 2 else None)
        self.people.append(
            Person(
                id=person_id,
                full_name="Unknown parent" if unknown else full_name,
                nickname=nickname,
                gender=_GENDERS[gender],
                birth_date=birth,
                death_date=PartialDate(year=died) if died else None,
                birth_order=order,
                placeholder=unknown,
                has_photo=photo,
                photo_version=1 if photo else 0,
            )
        )
        self.ids[key] = str(person_id)
        return key

    def child(self, parent: str, *children: str, kind: str = BIOLOGICAL) -> None:
        for child in children:
            link_id = uuid5(_NAMESPACE, f"{self.name}:parent:{parent}>{child}")
            self.links.append(
                link_row(link_id, "parent", self.ids[parent], self.ids[child], kind=kind)
            )

    def parents(self, both: tuple[str, str], *children: str, kind: str = BIOLOGICAL) -> None:
        for parent in both:
            self.child(parent, *children, kind=kind)

    def marry(self, a: str, b: str, *, divorced: bool = False, order: int | None = None) -> None:
        link_id = uuid5(_NAMESPACE, f"{self.name}:spouse:{a}={b}")
        status = "divorced" if divorced else "married"
        self.links.append(
            link_row(link_id, "spouse", self.ids[a], self.ids[b], status=status, order=order)
        )

    def rows(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return in_read_order([row_of(person) for person in self.people], list(self.links))


@dataclass(frozen=True)
class Golden:
    name: str
    about: str
    people: list[dict[str, Any]]  # rows, as read_family returns them
    links: list[dict[str, Any]]
    pairs: list[tuple[str, str]]
    titles: Titles | None = None  # the family's Malay birth-order titles (Settings, D14)
    kinds: dict[str, RelationshipKind] = field(default_factory=lambda: dict(KINDS))


def every_pair(people: Sequence[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(a["id"], b["id"]) for a, b in permutations(people, 2)]


# --- The families ---------------------------------------------------------------------------


def seed() -> Golden:
    family = load_seed_family()
    everyone = family.people_as_domain()
    people = [row_of(person) for person in everyone]
    links = [
        link_row(link.id, "parent", link.parent_id, link.child_id, kind=link.kind)
        for link in family.parent_links()
    ] + [
        link_row(
            link.id,
            "spouse",
            link.person_a,
            link.person_b,
            status=link.status.value,
            order=link.order,
        )
        for link in family.spouse_links()
    ]
    people, links = in_read_order(people, links)
    return Golden(
        "seed",
        "Keluarga Contoh, the fictional test family (backend/src/ancestree/seed): every pair.",
        people,
        links,
        every_pair(people),
    )


def tables() -> Golden:
    """Every row of the kinship tables, both genders and ways round, and the edge
    cases."""
    s = Sketch("tables")
    genders = "mmf?fm"
    # A line of 21 generations, with a brother's line beside it: every generation's word up and
    # down, far great-uncles and grandnephews, and cousins to the 19th, removed up to 19 times.
    line = [s.person(f"g{n}", f"Ali {n}", genders[n % 6], born=1500 + 25 * n) for n in range(21)]
    for n in range(1, 21):
        s.child(line[n - 1], line[n])
    # Line 1's brothers and sisters, eldest first: an elder aunt, younger uncles, and the
    # youngest, born after his nephew.
    s.person("cik", "Cik 1", "f", born=1520)
    s.person("dol", "Dol 1", "m", born=1530)
    side = [s.person("b1", "Bakar 1", "m", born=1560)]
    s.child(line[0], "cik", "dol", "b1")
    for n in range(2, 21):
        side.append(s.person(f"b{n}", f"Bakar {n}", genders[(n + 3) % 6], born=1535 + 25 * n))
        s.child(side[-2], side[-1])

    # A household: two wives, a divorce, half- and step-family, in-laws of every shape, an
    # adoption, a foster child, a guardian, and twins ordered by hand.
    s.person("daud", "Daud bin Musa", "m", born=1930, died=2000, nickname="Tok Daud", photo=True)
    s.person("salmah", "Salmah binti Omar", "f", born=1935)
    s.person("wati", "Wati binti Idris", "f", born=1945)
    s.person("jamil", "Jamil bin Zaki", "m", born=1928)
    s.person("fauzi", "Fauzi bin Amir", "m", born=1940)
    s.marry("daud", "salmah", order=1)
    s.marry("daud", "wati", order=2)
    s.marry("jamil", "salmah", divorced=True)
    s.marry("fauzi", "wati", divorced=True)
    s.person("kamal", "Kamal bin Daud", "m", born=(1955, 3, 1))
    s.person("aminah", "Aminah binti Daud", "f", born=1957)
    s.person("hamdan", "Hamdan bin Daud", "m", born=(1957, 6))
    s.person("laila", "Laila binti Daud", "f")
    s.person("hana", "Hana binti Daud", "f", born=(1962, 5, 5), order=1)
    s.person("aida", "Aida binti Daud", "f", born=(1962, 5, 5), order=2)
    s.parents(("daud", "salmah"), "kamal", "aminah", "hamdan", "laila", "hana", "aida")
    s.person("rahman", "Rahman bin Jamil", "m", born=1950)
    s.parents(("jamil", "salmah"), "rahman")
    s.person("zainab", "Zainab binti Daud", "f", born=1968)
    s.parents(("daud", "wati"), "zainab")
    s.person("ismail", "Ismail bin Fauzi", "m", born=1966)
    s.parents(("fauzi", "wati"), "ismail")
    s.person("idris", "Idris bin Ahmad", "m", born=1915)
    s.person("fatimah", "Fatimah binti Ali", "f", born=1920)
    s.person("yusof", "Yusof bin Idris", "m", born=1950)
    s.parents(("idris", "fatimah"), "wati", "yusof")
    # Kamal's wife's family, and his sisters' and brother's spouses.
    s.person("siti", "Siti binti Hassan", "f", born=1958)
    s.person("hassan", "Hassan bin Salleh", "m", born=1925)
    s.person("mariam", "Mariam binti Bakar", "f", born=1930)
    s.person("azman", "Azman bin Hassan", "m", born=1952)
    s.person("nora", "Nora binti Hassan", "f", born=1961)
    s.parents(("hassan", "mariam"), "azman", "siti", "nora")
    s.person("halimah", "Halimah binti Rosli", "f", born=1955)
    s.marry("kamal", "siti")
    s.marry("azman", "halimah")
    s.person("omar", "Omar bin Kamal", "m", born=1955)
    s.marry("omar", "aminah")
    s.person("normah", "Normah binti Musa", "f", born=1960)
    s.marry("hamdan", "normah")
    # Kamal's children, a grandson's wife and her father.
    s.person("ali", "Ali bin Kamal", "m", born=1980)
    s.person("khadijah", "Khadijah binti Kamal", "f", born=1983)
    s.parents(("kamal", "siti"), "ali", "khadijah")
    s.person("ramlah", "Ramlah binti Zaki", "f", born=1982)
    s.person("zaki", "Zaki bin Rosli", "m", born=1950)
    s.child("zaki", "ramlah")
    s.marry("ali", "ramlah")
    # Other kinds of parent.
    s.person("amir", "Amir bin Daud", "m", born=1964)
    s.parents(("daud", "salmah"), "amir", kind="adoptive")
    s.person("musa", "Musa bin Kamal", "m", born=1990)
    s.child("kamal", "musa", kind="foster")
    s.person("idris2", "Idris bin Omar", "m", born=1995)
    s.child("daud", "idris2", kind="guardian")
    # Brother and sister whose parents aren't recorded, and their children: cousins through
    # an unknown parent.
    s.person("unknown", "", unknown=True)
    s.person("salleh", "Salleh", "m", born=1940)
    s.person("rokiah", "Rokiah", "f", born=1943)
    s.child("unknown", "salleh", "rokiah")
    s.person("aisyah", "Aisyah binti Salleh", "f", born=1970)
    s.person("bakar", "Bakar bin Rokiah", "?", born=1972)
    s.child("salleh", "aisyah")
    s.child("rokiah", "bakar")
    # A chain too long to name: marriages and guardians, one after another.
    chain = [s.person(f"c{n}", f"Chain {n}", "mf"[n % 2], born=1900 + n) for n in range(8)]
    for n in range(0, 8, 2):
        s.marry(chain[n], chain[n + 1])
    for n in range(1, 7, 2):
        s.child(chain[n + 1], chain[n], kind="guardian")
    s.person("alone", "Wati binti Salleh", "f")  # linked to no one

    people, links = s.rows()
    ids = s.ids
    apart = {ids[key] for key in (*line, *side, "cik", "dol", *chain)}
    pairs = every_pair([row for row in people if row["id"] not in apart])
    # The line: every generation up and down, and uncles and nephews at every distance.
    pairs += [(ids["g20"], ids[f"g{n}"]) for n in range(20)]
    pairs += [(ids["g0"], ids[f"g{n}"]) for n in range(1, 21)]
    for n in range(2, 21):
        pairs += [(ids[f"g{n}"], ids["b1"]), (ids["b1"], ids[f"g{n}"])]
    pairs += [(ids["g2"], ids["cik"]), (ids["g2"], ids["dol"]), (ids["cik"], ids["g2"])]
    reach = (2, 3, 4, 5, 7, 11, 12, 20)
    pairs += [(ids[f"g{i}"], ids[f"b{j}"]) for i in reach for j in reach]
    pairs += [(ids["c0"], ids["c7"]), (ids["c7"], ids["c0"]), (ids["c0"], ids["c3"])]
    return Golden(
        "tables",
        "Made up for the kinship tables and their edge cases, with the family's own Malay titles.",
        people,
        links,
        pairs,
        Titles(("long", "ngah", "alang", "andak"), "busu"),
    )


def notes() -> Golden:
    """The shape of the golden test from the notes (tests/unit/test_kinship_golden.py), with
    made-up names: two brothers in birth order, and their lines down."""
    s = Sketch("notes")
    s.person("unknown", "", unknown=True)
    s.person("elder", "Haji Osman", "m", order=1)
    s.person("younger", "Salleh bin Musa", "m", order=2)
    s.person("daughter", "Nenek Rokiah", "f")
    s.person("granddaughter", "Nenek Zainab", "f")
    s.person("niece", "Halimah", "f")
    s.person("grandnephew", "Karim bin Yusof", "m")
    s.child("unknown", "elder", "younger")
    s.child("elder", "daughter")
    s.child("daughter", "granddaughter")
    s.child("younger", "niece")
    s.child("niece", "grandnephew")
    people, links = s.rows()
    return Golden(
        "notes",
        "The shape of the golden test from a family note, with made-up names: every pair.",
        people,
        links,
        every_pair(people),
    )


def generated() -> Golden:
    people, links = generated_family(2000)
    people, links = in_read_order(list(people), list(links))
    rng = random.Random(15)  # noqa: S311 - picking people, not keeping secrets
    ids = [row["id"] for row in people]
    pairs: list[tuple[str, str]] = []
    while len(pairs) < 150:
        a, b = rng.choice(ids), rng.choice(ids)
        if a != b:
            pairs.append((a, b))
    return Golden(
        "generated",
        "The generated 2,000-person family (backend/src/ancestree/seed/generated.py): 150 "
        "pairs, and the family for timing the copy's engine.",
        people,
        links,
        pairs,
    )


FAMILIES = (seed, tables, notes, generated)


# --- Writing them down ----------------------------------------------------------------------


def content(golden: Golden) -> dict[str, Any]:
    """What a golden file holds: the family as a copy has it, and the answers."""
    books = term_books(golden.titles)
    finder = Finder(golden.people, golden.links, golden.kinds, books)
    in_layout = {key: kind.in_layout for key, kind in golden.kinds.items()}
    graph = build_graph(golden.people, golden.links, in_layout, None)
    return {
        "about": golden.about,
        "kinship": twin_inputs(books),
        "kinds": [kind.model_dump(mode="json") for kind in golden.kinds.values()],
        "people": [person.model_dump(mode="json", include=_PERSON) for person in graph.people],
        "links": [link.model_dump(mode="json", include=_LINK) for link in graph.links],
        "answers": [
            finder.answer(UUID(a), UUID(b)).model_dump(mode="json") for a, b in golden.pairs
        ],
    }


def path(name: str) -> Path:
    return GOLDEN / f"{name}.json.gz"


def read(name: str) -> dict[str, Any] | None:
    if not path(name).is_file():
        return None
    data: dict[str, Any] = json.loads(gzip.decompress(path(name).read_bytes()))
    return data


def write_all() -> list[str]:
    """Write every golden file whose answers changed; return their names."""
    GOLDEN.mkdir(parents=True, exist_ok=True)
    written = []
    for make in FAMILIES:
        golden = make()
        data = content(golden)
        if read(golden.name) == data:
            continue
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        path(golden.name).write_bytes(gzip.compress(text.encode("utf-8"), 9, mtime=0))
        written.append(golden.name)
    return written


if __name__ == "__main__":
    changed = write_all()
    print("Written again: " + ", ".join(changed) if changed else "All up to date.")
