from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from ancestree.api.deps import Ctx
from ancestree.domain.kinship import KinshipAnswer, KinshipDictionary, KinshipSettings
from ancestree.services import kinship

router = APIRouter(tags=["kinship"])


@router.get("/kinship")
async def find_relationship(
    ctx: Ctx, from_: Annotated[UUID, Query(alias="from")], to: UUID
) -> KinshipAnswer:
    """How two people are related, both ways round, with the path between them.
    Every statement comes in each kinship language, so switching needs no new answer."""
    return await kinship.find_relationship(ctx, from_, to)


@router.get("/kinship/dictionary")
async def kinship_dictionary(ctx: Ctx) -> KinshipDictionary:
    """Every relation's words in English, Malay and Javanese, as the answers say them."""
    return await kinship.kinship_dictionary(ctx)


@router.get("/kinship/settings")
async def kinship_settings(ctx: Ctx) -> KinshipSettings:
    """The kinship language and the Malay birth-order titles."""
    return await kinship.kinship_settings(ctx)


@router.put("/kinship/settings")
async def save_kinship_settings(ctx: Ctx, body: KinshipSettings) -> KinshipSettings:
    """Choose the kinship language; set the family's Malay birth-order titles. Not
    a change to the tree, so there's no Undo step for it."""
    return await kinship.save_kinship_settings(ctx, body)
