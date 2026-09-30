import asyncio

from fastapi import APIRouter

from ancestree.api.deps import Ctx
from ancestree.domain.facts import FamilyFacts
from ancestree.domain.graph import MeSettings
from ancestree.repo import people as people_repo
from ancestree.services.context import NotFoundError, RuleError, read
from ancestree.services.facts import family_facts
from ancestree.storage.settings import read_me, write_me

router = APIRouter(prefix="/family", tags=["family"])


@router.get("/facts")
async def get_family_facts(ctx: Ctx) -> FamilyFacts:
    """Family facts: the counts; the generations; the oldest, youngest and longest-lived;
    the biggest families; the longest chain; cousins who married; names, places and decades;
    this month's dates; and what's still to fill in. Each fact names its people by id."""
    return await family_facts(ctx)


@router.get("/me")
async def get_me(ctx: Ctx) -> MeSettings:
    """Which person you are, for "Me"; none until you've chosen."""
    return await asyncio.to_thread(read_me, ctx.data_dir)


@router.put("/me")
async def set_me(ctx: Ctx, body: MeSettings) -> MeSettings:
    """Choose which person you are, or none to forget. Not an Undo step: it isn't a change to
    the tree, like the kinship language."""
    if body.person is not None:
        person = await read(ctx, lambda tx: people_repo.fetch_person(tx, str(body.person)))
        if person is None:
            raise NotFoundError("That person isn't in the tree.")
        if person.get("placeholder"):
            raise RuleError("not_a_person", "An unknown parent can't be you. Fill them in first.")
    await asyncio.to_thread(write_me, ctx.data_dir, body)
    return body
