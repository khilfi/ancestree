"""Golden files for a copy to edit.

A copy to edit works out the tree, its seats and each person's view itself, from the family it
carries (exchange/records.py): it has TypeScript twins of services/graph.py, lineage/seating.py
and services/detail.py (FamilyRows). This writes down what Python works out for the made-up
families of tests/kinship_golden.py, in frontend/src/copyedit/golden/, and the twins must give
exactly the same (src/copyedit/golden.test.ts). tests/unit/test_copy_golden_files.py fails while
a file is out of date. After a change to any of them, write them again, in backend/:

    uv run python -m tests.copy_golden

Each file holds the family as a copy to edit carries it, the kinds and word lists, and what
Python makes of it: the graph with its seats, the seats around other centres, and people's views
in each language. The big family keeps only the seats of its graph, and fewer of everything.
"""

import gzip
import json
import random
from pathlib import Path
from typing import Any
from uuid import UUID

from ancestree.config import REPO_ROOT
from ancestree.domain.graph import Graph
from ancestree.exchange.records import in_link_order, in_tree_order, person_record, tree_row
from ancestree.services.detail import FamilyRows
from ancestree.services.graph import build_graph
from ancestree.services.kinship import term_books, twin_inputs
from tests.kinship_golden import FAMILIES, Golden

GOLDEN = REPO_ROOT / "frontend" / "src" / "copyedit" / "golden"
YEAR = 2026  # who is taken to be alive is worked out against this, so the files stay put
LANGUAGES = ("en", "ms", "jv")
_SMALL = 200  # a family this size or less has everything written down


def centres(graph: Graph) -> list[str]:
    """Whose seats to write down: everyone's in a small family; in the big one, the centre of
    the biggest family hanging off the rings."""
    seated = sorted(str(person) for person in graph.layout.seats)
    if len(seated) <= _SMALL:
        return seated
    return [str(max(graph.layout.units[1:], key=lambda unit: unit.size).centre[0])]


def whose_views(records: list[dict[str, Any]]) -> tuple[list[str], tuple[str, ...]]:
    """Everyone's view in every language in a small family; 20 people's in English in the
    big one."""
    ids = [record["id"] for record in records]
    if len(ids) <= _SMALL:
        return ids, LANGUAGES
    return random.Random(21).sample(ids, 20), ("en",)  # noqa: S311 - picking people


def content(golden: Golden) -> dict[str, Any]:
    """What a golden file holds: the family as a copy to edit carries it, and what Python makes
    of it."""
    books = term_books(golden.titles)
    records = [person_record(props) for props in golden.props]
    links = in_link_order(golden.links)
    rows = in_tree_order(tree_row(record) for record in records)
    in_layout = {key: kind.in_layout for key, kind in golden.kinds.items()}
    graph = build_graph(rows, links, in_layout, None, this_year=YEAR)
    family = FamilyRows(records, links)
    ids, languages = whose_views(records)
    small = len(records) <= _SMALL

    def seats(centre: str) -> dict[str, Any]:
        layout = build_graph(rows, links, in_layout, UUID(centre), this_year=YEAR).layout
        return layout.model_dump(mode="json")

    def views(pid: str) -> dict[str, Any]:
        return {
            language: family.detail(pid, golden.kinds, books[language], this_year=YEAR).model_dump(
                mode="json"
            )
            for language in languages
        }

    return {
        "about": golden.about,
        "year": YEAR,
        "kinship": twin_inputs(books),
        "kinds": [kind.model_dump(mode="json") for kind in golden.kinds.values()],
        "family": {"people": records, "links": links},
        "graph": graph.model_dump(mode="json", include=None if small else {"layout"}),
        "layouts": {centre: seats(centre) for centre in centres(graph)},
        "details": {pid: views(pid) for pid in ids},
    }


def path(name: str) -> Path:
    return GOLDEN / f"{name}.json.gz"


def read(name: str) -> dict[str, Any] | None:
    if not path(name).is_file():
        return None
    data: dict[str, Any] = json.loads(gzip.decompress(path(name).read_bytes()))
    return data


def write_all() -> list[str]:
    """Write every golden file whose content changed; return their names."""
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
