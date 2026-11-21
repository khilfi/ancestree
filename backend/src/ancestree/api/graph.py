import asyncio

from fastapi import APIRouter, status

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.graph import Graph, Positions, TreeSettings
from ancestree.repo import graph as graph_repo
from ancestree.repo import people as people_repo
from ancestree.services.context import read
from ancestree.services.graph import load_graph, with_story_marks
from ancestree.storage.biography import with_stories
from ancestree.storage.settings import read_tree_settings, write_tree_settings

router = APIRouter(tags=["tree"])

_COLOURS = {
    "branch": "Colour by branch",
    "generation": "Colour by generation",
    "closeness": "Colour by closeness to me",
    "off": "No colours",
}
_MARRIED_IN = {
    "fans": "Married-in families as fans",
    "discs": "Married-in families as discs",
    "tucked": "Married-in families tucked in",
}


@router.get("/graph")
async def get_graph(ctx: Ctx) -> Graph:
    """Everyone, every link, and where each person sits on the lineage rings; and who has a
    life story, for its book mark on their photo."""
    settings = await asyncio.to_thread(read_tree_settings, ctx.data_dir)
    graph = await load_graph(ctx.driver, ctx.database, settings.centre)
    ids = [str(person.id) for person in graph.people if not person.placeholder]
    told = await asyncio.to_thread(with_stories, ctx.data_dir, ids)
    return with_story_marks(graph, told)


@router.put("/layout/positions", status_code=status.HTTP_204_NO_CONTENT)
async def save_positions(ctx: Ctx, history: Hist, body: Positions) -> None:
    """Remember where people were dragged to; a null position puts them back on the rings."""
    rows = [{"id": str(p.id), "x": p.x, "y": p.y} for p in body.positions]
    async with history.moves(ctx, [p.id for p in body.positions]) as change:
        await graph_repo.save_positions(ctx.driver, ctx.database, rows)
        moved = [change.name(p.id) for p in body.positions]
        change.label = f"Move {moved[0]}" if len(moved) == 1 else f"Move {len(moved)} people"


@router.delete("/layout/positions", status_code=status.HTTP_204_NO_CONTENT)
async def clear_positions(ctx: Ctx, history: Hist) -> None:
    """Rearrange: everyone goes back to their place on the rings."""
    async with history.moves(ctx, everyone=True) as change:
        await graph_repo.clear_positions(ctx.driver, ctx.database)
        change.label = "Rearrange"


@router.get("/settings")
async def read_settings(ctx: Ctx) -> TreeSettings:
    return await asyncio.to_thread(read_tree_settings, ctx.data_dir)


@router.put("/settings")
async def save_settings(ctx: Ctx, history: Hist, body: TreeSettings) -> TreeSettings:
    """The centre of the tree (none: the oldest ancestor), how the rings are coloured, and how
    married-in families are placed on them."""
    async with history.settings_change(ctx) as step:
        before = await asyncio.to_thread(read_tree_settings, ctx.data_dir)
        await asyncio.to_thread(write_tree_settings, ctx.data_dir, body)
        if body.centre != before.centre:
            if body.centre is None:
                step.label = "Put the oldest ancestor back at the centre"
            else:
                person = await read(ctx, lambda tx: people_repo.fetch_person(tx, str(body.centre)))
                step.label = f"Centre the tree on {(person or {}).get('full_name', 'someone')}"
        elif body.married_in != before.married_in:
            step.label = _MARRIED_IN[body.married_in]
        else:
            step.label = _COLOURS.get(body.colours, "Change the colours")
    return body
