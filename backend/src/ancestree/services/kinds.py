"""Relationship kinds, configured in Settings."""

import re

from neo4j import AsyncManagedTransaction as Tx

from ancestree.domain.relationship import RelationshipKind
from ancestree.domain.requests import KindInput, KindUpdate
from ancestree.domain.views import KindView
from ancestree.repo import kinds as kinds_repo
from ancestree.services.context import Context, NotFoundError, RuleError, read, write


async def list_kinds(ctx: Context) -> list[KindView]:
    return await read(ctx, _views)


async def create_kind(ctx: Context, data: KindInput) -> KindView:
    async def work(tx: Tx) -> KindView:
        existing = {kind.key: kind for kind, _ in await kinds_repo.kinds_with_usage(tx)}
        if any(kind.label.casefold() == data.label.casefold() for kind in existing.values()):
            raise RuleError("duplicate_kind", f"There's already a kind called '{data.label}'.")
        kind = RelationshipKind(
            key=_unique_key(data.label, set(existing)),
            label=data.label,
            builtin=False,
            blood=False,  # only the built-in biological kind is blood lineage
            active=True,
            in_layout=data.in_layout,
            sort_order=max((k.sort_order for k in existing.values()), default=0) + 1,
            parent_label=data.parent_label,
            child_label=data.child_label,
            words={str(code): words for code, words in data.words.items()},
        )
        await kinds_repo.save_kind(tx, kind)
        return next(view for view in await _views(tx) if view.key == kind.key)

    return await write(ctx, work)


async def update_kind(ctx: Context, key: str, data: KindUpdate) -> KindView:
    async def work(tx: Tx) -> KindView:
        kind = await _kind(tx, key)
        changes = data.model_dump(exclude_none=True)
        if kind.builtin and changes:
            raise RuleError("builtin_kind", f"'{kind.label}' is built in and can't be changed.")
        await kinds_repo.save_kind(tx, RelationshipKind.model_validate(kind.model_dump() | changes))
        return next(view for view in await _views(tx) if view.key == key)

    return await write(ctx, work)


async def delete_kind(ctx: Context, key: str) -> None:
    async def work(tx: Tx) -> None:
        kind = await _kind(tx, key)
        if kind.builtin:
            raise RuleError("builtin_kind", f"'{kind.label}' is built in and can't be deleted.")
        usage = next(view.usage for view in await _views(tx) if view.key == key)
        if usage:
            raise RuleError(
                "kind_in_use",
                f"{usage} link{'s' if usage != 1 else ''} use '{kind.label}'. "
                "Hide it instead, or change those links first.",
            )
        await kinds_repo.delete_kind(tx, key)

    await write(ctx, work)


async def _views(tx: Tx) -> list[KindView]:
    return [
        KindView(**kind.model_dump(), usage=usage)
        for kind, usage in await kinds_repo.kinds_with_usage(tx)
    ]


async def _kind(tx: Tx, key: str) -> RelationshipKind:
    kinds = await kinds_repo.fetch_kinds(tx)
    if key not in kinds:
        raise NotFoundError("There's no such relationship kind.")
    return kinds[key]


def _unique_key(label: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_")
    if not base or not base[0].isalpha():
        base = f"kind_{base}".rstrip("_")
    key, number = base, 2
    while key in taken:
        key, number = f"{base}_{number}", number + 1
    return key
