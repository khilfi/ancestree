"""The test pages' made-up families: only where the app is run from the code, never
in a release, as `create_app(samples=...)` says. Nothing here is stored."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile

from ancestree.domain.graph import Graph, SampleFamily
from ancestree.domain.map import FamilyMap
from ancestree.exchange.restore import read_graph
from ancestree.seed.clusters import clustered_families
from ancestree.seed.generated import generated_family
from ancestree.services import places as places_service
from ancestree.services.graph import build_graph, graph_from_archive

router = APIRouter(tags=["samples"])


@router.get("/sample/graph")
async def get_sample_graph(people: Annotated[int, Query(ge=10, le=5000)] = 2000) -> Graph:
    """A generated, fictional family, for trying the canvas at size. Nothing is stored."""
    rows, links = generated_family(people)
    return build_graph(rows, links, {"biological": True}, None)


@router.get("/sample/map")
async def get_sample_map(people: Annotated[int, Query(ge=10, le=5000)] = 2000) -> FamilyMap:
    """The made-up family on the map, spread over real towns. Nothing is stored."""
    return await asyncio.to_thread(places_service.sample_map, people)


@router.get("/sample/families")
async def get_sample_families() -> list[SampleFamily]:
    """Six made-up families whose married-in families hang off them in hard ways, each seated
    as the tree seats it, for trying ways of placing those families side by side.
    Nothing is stored."""
    return [
        SampleFamily(
            key=family.key,
            title=family.title,
            about=family.about,
            graph=build_graph(family.people, family.links, {"biological": True}, None),
        )
        for family in clustered_families()
    ]


@router.post("/sample/families/backup")
async def get_family_from_backup(
    file: Annotated[UploadFile, File(description="An AncesTree backup archive (.zip)")],
) -> Graph:
    """The family in a backup archive, seated as the tree seats it, to try the same ways on
    (S7). Read in memory and checked as a restore checks it: nothing is restored or kept.
    Refused (422, "bad_archive") if it isn't a backup that can be read."""
    archive = await asyncio.to_thread(read_graph, file.file, file.filename or "The file")
    return graph_from_archive(archive)
