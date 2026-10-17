import pytest

from ancestree.domain import exports, person


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def death_places(monkeypatch: pytest.MonkeyPatch) -> None:
    """The place of death shown and sent, as before 0.8.2: its own tests run with
    the switch on, so it doesn't decay. Without this, as it ships: kept, but shown nowhere."""
    monkeypatch.setattr(person, "DEATH_PLACES", True)


@pytest.fixture
def more_exports(monkeypatch: pytest.MonkeyPatch) -> None:
    """Export's spreadsheet, GEDCOM and full archive, in the app and in copies, as
    before 0.8.4: their tests run with the switch on, so they don't decay."""
    monkeypatch.setattr(exports, "MORE_EXPORTS", True)
