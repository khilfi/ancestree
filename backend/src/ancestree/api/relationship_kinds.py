from fastapi import APIRouter, Response, status

from ancestree.api.deps import Ctx
from ancestree.domain.requests import KindInput, KindUpdate
from ancestree.domain.views import KindView
from ancestree.services import kinds

router = APIRouter(prefix="/relationship-kinds", tags=["settings"])


@router.get("")
async def list_relationship_kinds(ctx: Ctx) -> list[KindView]:
    """Kinds of parent-child link, with how many links use each."""
    return await kinds.list_kinds(ctx)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_relationship_kind(ctx: Ctx, data: KindInput) -> KindView:
    return await kinds.create_kind(ctx, data)


@router.patch("/{key}")
async def update_relationship_kind(ctx: Ctx, key: str, data: KindUpdate) -> KindView:
    """Rename, relabel, hide (active=false), reorder, or change ring placement."""
    return await kinds.update_kind(ctx, key, data)


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relationship_kind(ctx: Ctx, key: str) -> Response:
    """Only a kind that no link uses; hide it otherwise."""
    await kinds.delete_kind(ctx, key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
