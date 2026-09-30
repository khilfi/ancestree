import httpx
import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.main import create_app
from ancestree.seed.family import load_seed_family, seed_id
from ancestree.seed.loader import load_seed

pytestmark = [pytest.mark.integration, pytest.mark.anyio]


async def test_health_graph_and_kinds_are_served(driver: AsyncDriver, settings: Settings) -> None:
    app = create_app(settings)
    async with app.router.lifespan_context(app):  # runs migrations and prepares DATA_DIR
        await load_seed(driver, settings.neo4j_database)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            health = (await client.get("/api/health")).json()
            graph = (await client.get("/api/graph")).json()
            kinds = (await client.get("/api/relationship-kinds")).json()

    assert health["status"] == "ok"
    assert health["database"] == "up"
    assert health["schema_version"] == 3
    assert health["database_version"].startswith("Neo4j/")
    assert health["data_folder"] == str(settings.data_dir)
    assert len(graph["people"]) == len(load_seed_family().people)
    hassan = next(p for p in graph["people"] if p["id"] == str(seed_id("person:hassan")))
    assert hassan == {
        "id": str(seed_id("person:hassan")),
        "full_name": "Hassan bin Ismail",
        "nickname": "Acan",
        "gender": "male",
        "birth_year": 1938,
        "death_year": 2011,
        "birth_order": None,
        "placeholder": False,
        "photo_version": None,
        "birthplace": "Kota Bharu, Kelantan",
        "born_in": "Kelantan",
        "x": None,
        "y": None,
        "born": {
            "year": 1938,
            "month": 3,
            "day": 14,
            "qualifier": "exact",
            "year_to": None,
            "original_text": None,
        },
        "died": {
            "year": 2011,
            "month": None,
            "day": None,
            "qualifier": "exact",
            "year_to": None,
            "original_text": None,
        },
        "is_living": False,
        "birth_text": None,
    }
    # The rings: Tok Ismail's couple at the centre, generations by lineage.
    main = graph["layout"]["units"][0]
    assert main["centre"] == [str(seed_id("person:ismail")), str(seed_id("person:fatimah"))]
    seats = graph["layout"]["seats"]
    assert seats[str(seed_id("person:hassan"))]["generation"] == 2
    assert seats[str(seed_id("person:hassan"))]["order"] == 0  # the eldest
    assert seats[str(seed_id("person:zul"))]["generation"] == 3  # Ali's uncle, born the
    assert seats[str(seed_id("person:ali"))]["generation"] == 4  # same year as Ali
    assert [kind["key"] for kind in kinds] == ["biological", "adoptive", "foster"]
    assert (settings.data_dir / "people").is_dir()
