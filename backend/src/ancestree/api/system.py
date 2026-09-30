from typing import Literal

from fastapi import APIRouter
from neo4j import RoutingControl
from neo4j.exceptions import DriverError, Neo4jError
from pydantic import BaseModel

from ancestree import __version__
from ancestree.api.deps import AppSettings, Driver

router = APIRouter(tags=["system"])


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    database: Literal["up", "down"]
    schema_version: int | None
    # For Settings → About: which Neo4j answered, and where the files are kept.
    database_version: str | None = None
    data_folder: str
    backup_folder: str


@router.get("/health")
async def health(driver: Driver, settings: AppSettings) -> Health:
    """Is the app running, and can it reach Neo4j?"""
    data_folder = str(settings.data_dir)
    backup_folder = str(settings.backup_dir or settings.data_dir / "exports")
    try:
        records, summary, _ = await driver.execute_query(
            "MATCH (m:Migration) RETURN max(m.version) AS version",
            database_=settings.neo4j_database,
            routing_=RoutingControl.READ,
        )
    except DriverError, Neo4jError:
        return Health(
            status="degraded",
            version=__version__,
            database="down",
            schema_version=None,
            data_folder=data_folder,
            backup_folder=backup_folder,
        )
    return Health(
        status="ok",
        version=__version__,
        database="up",
        schema_version=records[0]["version"],
        database_version=summary.server.agent,
        data_folder=data_folder,
        backup_folder=backup_folder,
    )
