"""Settings, read from environment variables and the repository's .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/ancestree/config.py: the repository root is three levels above this package.
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    neo4j_uri: str = "bolt://127.0.0.1:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: SecretStr
    neo4j_database: str = "neo4j"
    data_dir: Path
    # Where backup archives go: best on another disk. Unset: DATA_DIR/exports.
    backup_dir: Path | None = None
    # A backup each day while the app runs, the last 30 kept. The desktop app turns it on.
    automatic_backups: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()  # required values come from the environment or .env
