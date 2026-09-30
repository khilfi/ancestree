"""The family as a copy to edit carries it.

A view-only copy carries the app's answers. A copy to edit carries the family itself instead:
everyone's stored properties and every link. It works out the tree, its seats and each person's
view from them with TypeScript twins of services/graph.py, lineage/seating.py and
services/detail.py, again after every change. So each record holds what those read, under the
database's own names, and leaves out whatever isn't set.
"""

from collections.abc import Iterable, Mapping
from typing import Any

# Everything a copy to edit may carry for someone: what the person form edits, and what the
# tree, the timeline and the person panel read.
FIELDS = (
    "id", "full_name", "nickname", "title", "name_jawi", "gender",
    *(f"{event}_{part}" for event in ("birth", "death")
      for part in ("year", "month", "day", "qualifier", "year_to", "original_text")),
    *(f"{place}_{part}" for place in ("birth", "death", "residence")
      for part in ("town", "state", "country")),
    "burial_place", "living", "occupation", "notes", "birth_order", "placeholder",
    "has_photo", "photo_version", "layout_x", "layout_y", "created_at", "updated_at",
)  # fmt: skip
_ALWAYS = ("id", "full_name", "gender", "placeholder", "has_photo")
# What read_family gives for someone (repo/graph.py), from their stored properties.
_ROW = (
    "id", "full_name", "nickname", "gender", "birth_year", "birth_month", "birth_day",
    "birth_qualifier", "birth_year_to", "death_year", "death_month", "death_day",
    "death_qualifier", "death_year_to", "living", "birth_order", "placeholder",
)  # fmt: skip


def _json(value: Any) -> Any:
    """A database date-time as the API writes it; anything else as it is."""
    to_native = getattr(value, "to_native", None)
    return to_native().isoformat() if callable(to_native) else value


def person_record(props: Mapping[str, Any]) -> dict[str, Any]:
    """Someone as a copy to edit carries them: their stored properties, those not set left out."""
    record = {name: _json(props[name]) for name in FIELDS if props.get(name) is not None}
    return record | {
        "id": str(props["id"]),
        "full_name": props["full_name"],
        "gender": props.get("gender") or "unknown",
        "placeholder": bool(props.get("placeholder")),
        "has_photo": bool(props.get("has_photo")),
    }


def link_record(link: Mapping[str, Any]) -> dict[str, Any]:
    """A link as a copy to edit carries it, as read_family gives it: {id, type ("parent" or
    "spouse"), source (the parent), target, kind, status, order}, null where not set."""
    return {
        "id": str(link["id"]),
        "type": link["type"],
        "source": str(link["source"]),
        "target": str(link["target"]),
        "kind": link.get("kind"),
        "status": link.get("status"),
        "order": link.get("order"),
    }


def in_link_order(links: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """By type, then id: the order read_family gives links in, which seating follows."""
    records = (link_record(link) for link in links)
    return sorted(records, key=lambda record: (record["type"], record["id"]))


def tree_row(record: Mapping[str, Any]) -> dict[str, Any]:
    """The row read_family gives for someone, from what a copy to edit carries."""
    return {name: record.get(name) for name in _ROW} | {
        "gender": record.get("gender") or "unknown",
        "placeholder": bool(record.get("placeholder")),
        "photo_version": record.get("photo_version") if record.get("has_photo") else None,
        "birth_town": record.get("birth_town"),
        "birth_state": record.get("birth_state"),
        "birth_country": record.get("birth_country"),
        "x": record.get("layout_x"),
        "y": record.get("layout_y"),
        "birth_original_text": record.get("birth_original_text"),
    }


def in_tree_order(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """read_family's order: by birth year, then name, and the id where both are the same."""
    return sorted(
        (dict(row) for row in rows),
        key=lambda row: (
            row["birth_year"] is None,
            row["birth_year"] or 0,
            row["full_name"],
            row["id"],
        ),
    )
