"""The family as a relative's computer sends it to the keeper,
in the shape the copy to edit carried it: everyone's stored properties, under the
database's own names, leaving out whatever isn't set, and every link.
"""

from collections.abc import Iterable, Mapping
from typing import Any

# Everything sent for someone: what the person form edits, and what the tree, the timeline and
# the person panel read.
FIELDS = (
    "id", "full_name", "nickname", "title", "name_jawi", "gender",
    *(f"{event}_{part}" for event in ("birth", "death")
      for part in ("year", "month", "day", "qualifier", "year_to", "original_text")),
    *(f"{place}_{part}" for place in ("birth", "death", "residence")
      for part in ("town", "state", "country")),
    "burial_place", "living", "occupation", "notes", "birth_order", "placeholder",
    "has_photo", "photo_version", "layout_x", "layout_y", "created_at", "updated_at",
)  # fmt: skip


def _json(value: Any) -> Any:
    """A database date-time as the API writes it; anything else as it is."""
    to_native = getattr(value, "to_native", None)
    return to_native().isoformat() if callable(to_native) else value


def person_record(props: Mapping[str, Any]) -> dict[str, Any]:
    """Someone as their family is sent: their stored properties, those not set left out."""
    record = {name: _json(props[name]) for name in FIELDS if props.get(name) is not None}
    return record | {
        "id": str(props["id"]),
        "full_name": props["full_name"],
        "gender": props.get("gender") or "unknown",
        "placeholder": bool(props.get("placeholder")),
        "has_photo": bool(props.get("has_photo")),
    }


def link_record(link: Mapping[str, Any]) -> dict[str, Any]:
    """A link as the family is sent, as read_family gives it: {id, type ("parent" or "spouse"),
    source (the parent), target, kind, status, order}, null where not set."""
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
    """By type, then id: the order read_family gives links in."""
    records = (link_record(link) for link in links)
    return sorted(records, key=lambda record: (record["type"], record["id"]))
