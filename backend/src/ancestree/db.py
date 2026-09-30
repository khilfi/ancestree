"""Opening the Neo4j driver."""

import asyncio
import logging

from neo4j import AsyncDriver, AsyncGraphDatabase, NotificationDisabledClassification
from neo4j.exceptions import ServiceUnavailable

from ancestree.config import Settings

log = logging.getLogger(__name__)


async def connect(settings: Settings, *, attempts: int = 30, delay: float = 2.0) -> AsyncDriver:
    """Return a connected driver, retrying while Neo4j is still starting up.

    A wrong password fails immediately; only "not reachable yet" is retried.
    """
    driver = AsyncGraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password.get_secret_value()),
        # "Property/label not seen yet" notices are normal on a young database; keep the rest.
        notifications_disabled_classifications=[NotificationDisabledClassification.UNRECOGNIZED],
    )
    attempt = 1
    while True:
        try:
            await driver.verify_connectivity()
            return driver
        except ServiceUnavailable:
            if attempt >= attempts:
                await driver.close()
                raise
            log.info("Waiting for Neo4j at %s (%d/%d)", settings.neo4j_uri, attempt, attempts)
            attempt += 1
            await asyncio.sleep(delay)
