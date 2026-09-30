from uuid import UUID

from fastapi import APIRouter, Response, status

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.requests import RelationshipCreate, RelationshipUpdate
from ancestree.domain.views import RelationshipResult
from ancestree.services import relationships

router = APIRouter(prefix="/relationships", tags=["relationships"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_relationship(
    ctx: Ctx, history: Hist, request: RelationshipCreate
) -> RelationshipResult:
    """Link two people. Refused with 409 and the reason when a rule would break."""
    people = [request.person_a, request.person_b, *(request.shared_parents or [])]
    async with history.change(ctx, people) as change:
        result = await relationships.create_relationship(ctx, request)
        change.label = f"Link {change.name(request.person_a)} and {change.name(request.person_b)}"
    return result


@router.patch("/{link_id}")
async def update_relationship(
    ctx: Ctx, history: Hist, link_id: UUID, request: RelationshipUpdate
) -> RelationshipResult:
    async with history.change(ctx, links=[link_id]) as change:
        result = await relationships.update_relationship(ctx, link_id, request)
        change.label = f"Change the link between {change.between(link_id)}"
    return result


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relationship(ctx: Ctx, history: Hist, link_id: UUID) -> Response:
    async with history.change(ctx, links=[link_id]) as change:
        await relationships.delete_relationship(ctx, link_id)
        change.label = f"Remove the link between {change.between(link_id)}"
    return Response(status_code=status.HTTP_204_NO_CONTENT)
