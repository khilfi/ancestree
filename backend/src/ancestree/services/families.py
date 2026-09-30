"""Who counts as family: for siblings, birth order and groups of children.

Blood relations use biological links only. Other kinds (adoptive, foster, guardian...) are
kept apart and labelled with the kind; only those placed in the tree (`in_layout`) make
brothers and sisters, so a guardian's own children never become their ward's siblings.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from ancestree.domain.relationship import RelationshipKind

Kinds = Mapping[str, RelationshipKind]


def is_blood(kinds: Kinds, kind: str) -> bool:
    definition = kinds.get(kind)
    return definition is not None and definition.blood


def makes_family(kinds: Kinds, kind: str) -> bool:
    definition = kinds.get(kind)
    return definition is not None and definition.in_layout


def blood_parents(parents: Iterable[Mapping[str, Any]], kinds: Kinds) -> frozenset[str]:
    """The birth parents among rows of {id, kind}."""
    return frozenset(parent["id"] for parent in parents if is_blood(kinds, parent["kind"]))


def by_blood(parents: Mapping[str, str], kinds: Kinds) -> dict[str, str]:
    """Only the birth parents, from parent id -> kind."""
    return {pid: kind for pid, kind in parents.items() if is_blood(kinds, kind)}


def family_key(
    child: Mapping[str, Any], anchor: str, kinds: Kinds
) -> tuple[str | None, frozenset[str]]:
    """Which of `anchor`'s families a child row ({link, parents}) belongs to.

    A child by birth: (None, the other birth parents). Anyone else, e.g. an adopted
    daughter: (the kind, the other parents linked to her by that same kind).
    """
    kind = str(child["link"]["kind"])
    if is_blood(kinds, kind):
        return None, blood_parents(child["parents"], kinds) - {anchor}
    same_kind = frozenset(parent["id"] for parent in child["parents"] if parent["kind"] == kind)
    return kind, same_kind - {anchor}
