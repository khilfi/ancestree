"""The configurable relationship kinds."""

from collections.abc import Mapping
from typing import Any

from neo4j import AsyncDriver, AsyncManagedTransaction, RoutingControl

from ancestree.domain.relationship import GenderedLabel, KindWords, RelationshipKind

Tx = AsyncManagedTransaction


async def list_relationship_kinds(driver: AsyncDriver, database: str) -> list[RelationshipKind]:
    records, _, _ = await driver.execute_query(
        "MATCH (k:RelationshipKind) RETURN properties(k) AS kind ORDER BY k.sort_order, k.key",
        database_=database,
        routing_=RoutingControl.READ,
    )
    return [kind_from_props(record["kind"]) for record in records]


async def fetch_kinds(tx: Tx) -> dict[str, RelationshipKind]:
    result = await tx.run("MATCH (k:RelationshipKind) RETURN properties(k) AS kind")
    return {row["kind"]["key"]: kind_from_props(row["kind"]) for row in await result.data()}


async def kinds_with_usage(tx: Tx) -> list[tuple[RelationshipKind, int]]:
    result = await tx.run(
        """
        MATCH (k:RelationshipKind)
        OPTIONAL MATCH ()-[link:PARENT_OF]->() WHERE link.kind = k.key
        WITH k, count(link) AS usage
        ORDER BY k.sort_order, k.key
        RETURN properties(k) AS kind, usage
        """
    )
    return [(kind_from_props(row["kind"]), int(row["usage"])) for row in await result.data()]


async def save_kind(tx: Tx, kind: RelationshipKind) -> None:
    await tx.run(
        "MERGE (k:RelationshipKind {key: $key}) SET k += $props",
        key=kind.key,
        props=kind_props(kind),
    )


async def delete_kind(tx: Tx, key: str) -> None:
    await tx.run("MATCH (k:RelationshipKind {key: $key}) DELETE k", key=key)


WORD_LANGUAGES = ("ms", "jv")  # a kind's words beside the English ones


def kind_props(kind: RelationshipKind) -> dict[str, Any]:
    props = {
        "key": kind.key,
        "label": kind.label,
        "builtin": kind.builtin,
        "blood": kind.blood,
        "active": kind.active,
        "in_layout": kind.in_layout,
        "sort_order": kind.sort_order,
        **_label_props(kind.label, kind.parent_label, kind.child_label, ""),
    }
    # Neo4j properties can't be maps: the same fields per language, suffixed (label_ms...).
    # None removes a language's words that are no longer given.
    for code in WORD_LANGUAGES:
        words = kind.words.get(code)
        if words is None:
            props |= dict.fromkeys(_label_props("", None, None, f"_{code}"))
        else:
            props |= _label_props(words.label, words.parent_label, words.child_label, f"_{code}")
    return props


def _label_props(
    label: str, parent: GenderedLabel | None, child: GenderedLabel | None, suffix: str
) -> dict[str, Any]:
    fields: dict[str, Any] = {} if not suffix else {f"label{suffix}": label or None}
    for side, labels in (("parent", parent), ("child", child)):
        fields[f"{side}_label{suffix}"] = labels.neutral if labels else None
        fields[f"{side}_label_male{suffix}"] = labels.male if labels else None
        fields[f"{side}_label_female{suffix}"] = labels.female if labels else None
    return fields


def kind_from_props(props: Mapping[str, Any]) -> RelationshipKind:
    words = {
        code: KindWords(
            label=props[f"label_{code}"],
            parent_label=_labels(props, "parent", f"_{code}"),
            child_label=_labels(props, "child", f"_{code}"),
        )
        for code in WORD_LANGUAGES
        if props.get(f"label_{code}")
        and props.get(f"parent_label_{code}")
        and props.get(f"child_label_{code}")
    }
    return RelationshipKind(
        key=props["key"],
        label=props["label"],
        builtin=props["builtin"],
        blood=props["blood"],
        active=props["active"],
        in_layout=props["in_layout"],
        sort_order=props["sort_order"],
        parent_label=_labels(props, "parent", ""),
        child_label=_labels(props, "child", ""),
        words=words,
    )


def _labels(props: Mapping[str, Any], side: str, suffix: str) -> GenderedLabel:
    return GenderedLabel(
        neutral=props[f"{side}_label{suffix}"],
        male=props.get(f"{side}_label_male{suffix}"),
        female=props.get(f"{side}_label_female{suffix}"),
    )
