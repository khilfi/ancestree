"""Integration tests run against a throwaway Neo4j, never the real database.

The Neo4j is in Docker, or, with ANCESTREE_TEST_NEO4J=own, the app's own: the
Neo4j and Java in ANCESTREE_NEO4J_RUNTIME, started as the desktop app starts them.
"""

import os
import socket
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any
from uuid import UUID

import docker
import httpx
import pytest
from neo4j import AsyncDriver
from pydantic import SecretStr
from testcontainers.community.neo4j import Neo4jContainer

from ancestree.config import Settings
from ancestree.db import connect
from ancestree.domain.person import Gender, PartialDate, Person
from ancestree.domain.relationship import ParentLink, SpouseLink
from ancestree.main import create_app
from ancestree.ownneo4j.runtime import Runtime
from ancestree.ownneo4j.server import OwnNeo4j
from ancestree.repo.people import add_parent_links, add_spouse_links, upsert_people
from ancestree.seed.generated import generated_family

# Keep in step with docker-compose.yml.
NEO4J_IMAGE = "neo4j:2026.08.1-community"
TEST_PASSWORD = "integration-tests-only"


def _docker_is_running() -> bool:
    try:
        docker.from_env().ping()
    except Exception:
        return False
    return True


def _own_neo4j(root: Path) -> Iterator[tuple[str, str]]:
    folder = os.environ.get("ANCESTREE_NEO4J_RUNTIME", "")
    runtime = Runtime(Path(folder))
    if not folder or not runtime.ready():
        pytest.skip("ANCESTREE_NEO4J_RUNTIME must name a folder with Neo4j and Java fetched")
    own = OwnNeo4j(root, runtime, [sys.executable, "-m", "ancestree.ownneo4j.server"])
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
    own.configure(port)
    own.start()
    try:
        own.wait_ready()
        yield own.uri, own.password()
    finally:
        own.stop()


@pytest.fixture(scope="session")
def neo4j_server(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[str, str]]:
    """A throwaway Neo4j's address and password."""
    if os.environ.get("ANCESTREE_TEST_NEO4J") == "own":
        yield from _own_neo4j(tmp_path_factory.mktemp("own-neo4j"))
        return
    if not _docker_is_running():
        pytest.skip("Docker is not running; integration tests need a throwaway Neo4j")
    neo4j = (
        Neo4jContainer(NEO4J_IMAGE, password=TEST_PASSWORD)
        # As in docker-compose.yml: nothing reported to Neo4j, nothing broadcast.
        .with_env("NEO4J_dbms_usage__report_enabled", "false")
        .with_env("NEO4J_client_allow__telemetry", "false")
        .with_env("NEO4J_server_fleet__discovery_enabled", "false")
        .with_env("NEO4J_dbms_fleet__manager_enabled", "false")
    )
    with neo4j as container:
        yield container.get_connection_url(), TEST_PASSWORD


@pytest.fixture
def settings(neo4j_server: tuple[str, str], tmp_path: Path) -> Settings:
    # Nothing from the real .env: its BACKUP_DIR would send test backups to the real disk.
    uri, password = neo4j_server
    return Settings(
        _env_file=None,
        neo4j_uri=uri,
        neo4j_user="neo4j",
        neo4j_password=SecretStr(password),
        neo4j_database="neo4j",
        data_dir=tmp_path / "data",
        backup_dir=None,
    )


@pytest.fixture
async def driver(settings: Settings) -> AsyncIterator[AsyncDriver]:
    """A driver on an emptied database (the schema's constraints survive)."""
    driver = await connect(settings)
    await driver.execute_query("MATCH (n) DETACH DELETE n", database_=settings.neo4j_database)
    try:
        yield driver
    finally:
        await driver.close()


@pytest.fixture
async def client(driver: AsyncDriver, settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    """The whole app, over HTTP, on the emptied test database."""
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


async def create_person(client: httpx.AsyncClient, full_name: str, **fields: Any) -> dict[str, Any]:
    response = await client.post("/api/persons", json={"full_name": full_name, **fields})
    assert response.status_code == 201, response.text
    person: dict[str, Any] = response.json()["person"]
    return person


async def link(
    client: httpx.AsyncClient, a: str, b: str, a_is: str, **fields: Any
) -> httpx.Response:
    return await client.post(
        "/api/relationships", json={"person_a": a, "person_b": b, "a_is": a_is, **fields}
    )


async def get_person(client: httpx.AsyncClient, person_id: str) -> dict[str, Any]:
    response = await client.get(f"/api/persons/{person_id}")
    assert response.status_code == 200, response.text
    person: dict[str, Any] = response.json()
    return person


async def load_generated_family(driver: AsyncDriver, database: str, size: int) -> list[str]:
    """Store a generated, fictional family and return everyone's id, oldest first."""
    rows, links = generated_family(size)
    people = [
        Person(
            id=UUID(row["id"]),
            full_name=row["full_name"],
            gender=Gender(row["gender"]),
            birth_date=PartialDate(
                year=row["birth_year"], month=row["birth_month"], day=row["birth_day"]
            ),
        )
        for row in rows
    ]
    await upsert_people(driver, database, people, source="test:generated")
    parents = [
        ParentLink(id=UUID(row["id"]), parent_id=UUID(row["source"]), child_id=UUID(row["target"]))
        for row in links
        if row["type"] == "parent"
    ]
    await add_parent_links(driver, database, parents)
    spouses = [
        SpouseLink(id=UUID(row["id"]), person_a=UUID(row["source"]), person_b=UUID(row["target"]))
        for row in links
        if row["type"] == "spouse"
    ]
    await add_spouse_links(driver, database, spouses)
    return [row["id"] for row in rows]
