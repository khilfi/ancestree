"""Apply numbered Cypher migrations, each exactly once.

A migration is a file named `NNNN_name.cypher` in this package: statements separated by
semicolons, with `//` line comments. Statements must not contain semicolons in strings.
"""

import re
from dataclasses import dataclass
from importlib import resources

from neo4j import AsyncDriver

_FILE_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.cypher$")


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    statements: tuple[str, ...]


def split_statements(text: str) -> tuple[str, ...]:
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("//"))
    return tuple(statement.strip() for statement in code.split(";") if statement.strip())


def load_migrations() -> list[Migration]:
    migrations = []
    for entry in resources.files("ancestree.migrations").iterdir():
        match = _FILE_NAME.match(entry.name)
        if match:
            statements = split_statements(entry.read_text(encoding="utf-8"))
            migrations.append(Migration(int(match[1]), match[2], statements))
    migrations.sort(key=lambda migration: migration.version)
    versions = [migration.version for migration in migrations]
    if len(versions) != len(set(versions)):
        raise ValueError(f"duplicate migration versions: {versions}")
    return migrations


async def apply_migrations(driver: AsyncDriver, database: str) -> list[Migration]:
    """Apply pending migrations in order; return the ones applied by this call."""
    await driver.execute_query(
        "CREATE CONSTRAINT migration_version IF NOT EXISTS "
        "FOR (m:Migration) REQUIRE m.version IS UNIQUE",
        database_=database,
    )
    records, _, _ = await driver.execute_query(
        "MATCH (m:Migration) RETURN m.version AS version", database_=database
    )
    applied = {record["version"] for record in records}
    newly_applied = []
    for migration in load_migrations():
        if migration.version in applied:
            continue
        for statement in migration.statements:
            # Trusted text from this package's own migration files, never user input.
            await driver.execute_query(statement, database_=database)
        await driver.execute_query(
            "CREATE (:Migration {version: $version, name: $name, applied_at: datetime()})",
            version=migration.version,
            name=migration.name,
            database_=database,
        )
        newly_applied.append(migration)
    return newly_applied
