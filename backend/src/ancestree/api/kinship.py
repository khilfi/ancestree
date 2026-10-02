from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request

from ancestree.api.deps import Ctx
from ancestree.domain.kinship import KinshipAnswer, KinshipDictionary, KinshipSettings
from ancestree.services import kinship
from ancestree.services.context import RuleError

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
async def save_kinship_settings(
    ctx: Ctx, body: KinshipSettings, request: Request
) -> KinshipSettings:
    """Choose the kinship language; set the family's Malay birth-order titles. Not
    a change to the tree, so there's no Undo step for it. On a relative's computer, the
    language is its own, but the titles are the family's: they arrive from the keeper."""
    folder = getattr(request.app.state, "family_folder", None)
    if folder is not None and not folder.editing:
        now = await kinship.kinship_settings(ctx)
        if (body.titles, body.youngest) != (now.titles, now.youngest):
            raise RuleError(
                "kept_by_the_keeper",
                "The family's Malay titles are the keeper's to set: they arrive here from the "
                "family folder.",
            )
    return await kinship.save_kinship_settings(ctx, body)
