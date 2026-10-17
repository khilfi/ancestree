"""Settings, read from environment variables and the repository's .env file."""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/ancestree/config.py: the repository root is three levels above this package.
REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class WhichFamily:
    """The family the app opens, of those on the computer (0.4.0): its id and its name. Its
    backups carry both, so one family's can't be restored into another."""

    id: str
    name: str


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    neo4j_uri: str = "bolt://127.0.0.1:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: SecretStr
    neo4j_database: str = "neo4j"
    data_dir: Path
    # Where backup archives go: best on another disk. Unset: DATA_DIR/exports.
    backup_dir: Path | None = None
    # A backup each day while the app runs, and every backup kept 3 months. The
    # desktop app turns it on.
    automatic_backups: bool = False
    # In the desktop app (0.4.0), which family this is, of those on the computer; and a backup
    # to restore as it opens, for a family added from one.
    family_id: str | None = None
    family_name: str = ""
    restore_first: Path | None = None
    # The example family: filled with it as it opens, the first time; and, all along, made
    # up, so never kept in step through a family folder (0.8.0).
    example_first: bool = False
    example: bool = False
    # The map's packs: the app's own, shared by every family on the computer, which the
    # desktop app keeps beside Neo4j. Unset: DATA_DIR/maps, which no backup takes.
    maps_dir: Path | None = None
    # Where an address is looked up online, once and only when chosen: Photon, by komoot.
    # A stand-in's, in checks, so nothing leaves the computer.
    photon_url: str = "https://photon.komoot.io/api/"
    # Where downloads are saved, in the desktop app: the computer's Downloads folder, so the
    # page can say where each went. Unset, as in a browser, the browser saves them.
    downloads_dir: Path | None = None

    @property
    def family(self) -> WhichFamily | None:
        return WhichFamily(self.family_id, self.family_name) if self.family_id else None

    @property
    def maps(self) -> Path:
        return self.maps_dir or self.data_dir / "maps"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # required values come from the environment or .env
