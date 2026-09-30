"""The `ancestree` command. Run `uv run ancestree --help` inside backend/."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated

import typer
import uvicorn
from neo4j import AsyncDriver

from ancestree.config import Settings, get_settings
from ancestree.db import connect
from ancestree.domain.exports import BackupRestored, CopyPermissions, ExportFile, ExportFormat
from ancestree.exchange.backup import BackupResult, create_backup
from ancestree.exchange.copies import CopyOptions
from ancestree.exchange.restore import ArchiveError, read_info, restore_archive
from ancestree.importing.apply import (
    ImportRefusedError,
    ImportResult,
    apply_plan,
    latest_import,
    undo_import,
)
from ancestree.importing.plan import Decisions, ImportPlan, build_plan
from ancestree.importing.review import Review, ReviewError, read_review, render_report, write_review
from ancestree.importing.sources import Source, SourceError, read_csv, read_drawio
from ancestree.main import create_app
from ancestree.migrations.runner import apply_migrations
from ancestree.ownneo4j.runtime import JAVA_RELEASE, NEO4J_VERSION, Runtime
from ancestree.seed.loader import SeedRefusedError, SeedResult, load_seed, remove_seed
from ancestree.services.context import Context, RuleError
from ancestree.services.exports import make_export
from ancestree.storage.files import remove_bare_folders

app = typer.Typer(help="AncesTree: a private family-history app.", no_args_is_help=True)
import_app = typer.Typer(
    help="Bring in people from older files: a spreadsheet (CSV) and a draw.io chart.",
    no_args_is_help=True,
)
app.add_typer(import_app, name="import")


def _with_database[T](work: Callable[[AsyncDriver, Settings], Awaitable[T]]) -> T:
    """Connect to Neo4j, run `work`, and close the connection."""

    async def run() -> T:
        settings = get_settings()
        driver = await connect(settings)
        try:
            return await work(driver, settings)
        finally:
            await driver.close()

    return asyncio.run(run())


@app.command()
def serve(
    reload: Annotated[bool, typer.Option(help="Restart when the code changes.")] = False,
    port: Annotated[int, typer.Option(help="Port to listen on.")] = 8000,
) -> None:
    """Run the API on 127.0.0.1 only, so no other device can reach it."""
    uvicorn.run(
        "ancestree.main:create_app", factory=True, host="127.0.0.1", port=port, reload=reload
    )


@app.command()
def migrate() -> None:
    """Bring the database schema up to date."""
    applied = _with_database(lambda driver, s: apply_migrations(driver, s.neo4j_database))
    for migration in applied:
        typer.echo(f"Applied {migration.version:04d}_{migration.name}")
    typer.echo("Database schema is up to date.")


@app.command()
def seed() -> None:
    """Load (or reload) the fictional test family "Keluarga Contoh"."""

    async def work(driver: AsyncDriver, settings: Settings) -> SeedResult:
        await apply_migrations(driver, settings.neo4j_database)
        return await load_seed(driver, settings.neo4j_database)

    try:
        result = _with_database(work)
    except SeedRefusedError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(1) from error
    typer.echo(
        f"Loaded the test family: {result.people} people, "
        f"{result.parent_links} parent links, {result.spouse_links} marriages."
    )


@app.command()
def unseed() -> None:
    """Remove the fictional test family. Nobody else is touched."""
    removed = _with_database(lambda driver, s: remove_seed(driver, s.neo4j_database))
    folders = remove_bare_folders(get_settings().data_dir, removed)
    typer.echo(
        f"Removed {len(removed)} test-family people"
        + (f" and {folders} of their folders." if folders else ".")
    )


def _context(driver: AsyncDriver, settings: Settings) -> Context:
    return Context(driver, settings.neo4j_database, settings.data_dir, settings.backup_dir)


@app.command()
def backup(
    to: Annotated[
        Path | None,
        typer.Option(help="Folder for the archive. Default: BACKUP_DIR, else DATA_DIR/exports."),
    ] = None,
) -> None:
    """Write a full backup archive: every person, link and file."""

    async def work(driver: AsyncDriver, settings: Settings) -> BackupResult:
        await apply_migrations(driver, settings.neo4j_database)
        destination = to or _context(driver, settings).backups
        return await create_backup(driver, settings.neo4j_database, settings.data_dir, destination)

    result = _with_database(work)
    typer.echo(
        f"Backup written: {result.path}\n"
        f"  {result.people} people, {result.links} links, {result.files} files"
    )


@app.command()
def export(
    export_format: Annotated[
        ExportFormat,
        typer.Argument(
            metavar="FORMAT",
            help="gedcom (for other genealogy programs), csv (a spreadsheet) or archive.",
        ),
    ],
    to: Annotated[
        Path | None,
        typer.Option(
            help="Folder for the file. Default: DATA_DIR/exports; for an archive, the backups."
        ),
    ] = None,
) -> None:
    """Write a GEDCOM file, a spreadsheet, or the full archive (the same as `backup`)."""

    async def work(driver: AsyncDriver, settings: Settings) -> tuple[ExportFile, Path]:
        await apply_migrations(driver, settings.neo4j_database)
        ctx = _context(driver, settings)
        if to:
            to.mkdir(parents=True, exist_ok=True)
        made = await make_export(ctx, export_format, to)
        archive = export_format is ExportFormat.ARCHIVE
        return made, to or (ctx.backups if archive else settings.data_dir / "exports")

    result, folder = _with_database(work)
    typer.echo(f"Written: {folder / result.name} ({result.size:,} bytes)")


_MAY = tuple(CopyPermissions.model_fields)  # add, change, remove, stories, photos


@app.command("copy")
def copy_command(
    to: Annotated[
        Path | None, typer.Option(help="Folder for the copy. Default: DATA_DIR/exports.")
    ] = None,
    title: Annotated[
        str, typer.Option(help='Shown at the top of the copy, e.g. "Keluarga Contoh".')
    ] = "",
    hide_living: Annotated[
        bool,
        typer.Option(
            "--hide-living",
            help="Leave out living people's day and month of birth, places, notes and stories.",
        ),
    ] = False,
    password: Annotated[
        bool,
        typer.Option(
            "--password", help="Lock the copy with a password, asked for here (never typed in)."
        ),
    ] = False,
    archive: Annotated[
        bool, typer.Option(help="Put the full archive among the copy's exports.")
    ] = True,
    for_name: Annotated[
        str,
        typer.Option(
            "--for",
            help="Make a copy to edit, for this person: their changes come back under the name.",
        ),
    ] = "",
    may: Annotated[
        str,
        typer.Option(
            help="What they may do in a copy to edit, of: " + ", ".join(_MAY) + ". Default: all."
        ),
    ] = ",".join(_MAY),
) -> None:
    """Make a copy: one .html file with the app and the family inside, view-only, or
    with --for, a copy to edit, sent back with changes."""
    allowed = {part.strip() for part in may.split(",") if part.strip()}
    if allowed - set(_MAY):
        raise _fail(f"--may takes {', '.join(_MAY)}, not {', '.join(sorted(allowed - set(_MAY)))}.")
    secret = (
        typer.prompt("Password", hide_input=True, confirmation_prompt=True) if password else None
    )
    if secret is not None and len(secret) < 6:
        raise _fail("A password needs at least 6 characters.")
    whom = " ".join(for_name.split())[:60]
    options = CopyOptions(
        title=" ".join(title.split())[:60],
        hide_living=hide_living,
        password=secret,
        archive=archive and not whom,
        editable=bool(whom),
        for_name=whom,
        may=CopyPermissions(**{what: what in allowed for what in _MAY}),
    )

    async def work(driver: AsyncDriver, settings: Settings) -> tuple[ExportFile, Path]:
        await apply_migrations(driver, settings.neo4j_database)
        if to:
            to.mkdir(parents=True, exist_ok=True)
        made = await make_export(_context(driver, settings), ExportFormat.COPY, to, options)
        return made, to or settings.data_dir / "exports"

    try:
        result, folder = _with_database(work)
    except RuleError as error:
        raise _fail(error.message) from error
    typer.echo(f"Written: {folder / result.name} ({result.size:,} bytes)")


@app.command()
def restore(
    archive: Annotated[Path, typer.Argument(help="A backup archive made by AncesTree (.zip).")],
    yes: Annotated[bool, typer.Option("--yes", help="Don't ask for confirmation.")] = False,
) -> None:
    """Replace everything with a backup archive. Everything as it is now is backed up first."""
    try:
        info = read_info(archive)
    except ArchiveError as error:
        raise _fail(str(error)) from error
    if not yes:
        typer.confirm(
            f"Replace everything in AncesTree with the backup made {info.made_at:%d %b %Y %H:%M} "
            f"({info.people} people, {info.links} links, {info.files} files)? "
            "Everything as it is now is backed up first.",
            abort=True,
        )

    async def work(driver: AsyncDriver, settings: Settings) -> tuple[BackupRestored, Path]:
        await apply_migrations(driver, settings.neo4j_database)
        ctx = _context(driver, settings)
        return await restore_archive(ctx, archive), ctx.backups

    try:
        result, backups = _with_database(work)
    except ArchiveError as error:
        raise _fail(str(error)) from error
    typer.echo(
        f"Restored {result.people} people, {result.links} links and {result.files} files.\n"
        f"  Everything as it was before: {backups / result.backup}"
    )


def _fail(message: str) -> typer.Exit:
    typer.echo(message, err=True)
    return typer.Exit(1)


def _review_path(review: Path | None, settings: Settings) -> Path:
    return review or settings.data_dir / "imports" / "review.yaml"


def _read_sources(csv_file: Path | None, drawio_file: Path | None) -> list[Source]:
    try:
        sources = [read_csv(csv_file)] if csv_file else []
        return sources + ([read_drawio(drawio_file)] if drawio_file else [])
    except SourceError as error:
        raise _fail(str(error)) from error


def _plan(review_path: Path, review: Review) -> ImportPlan:
    if not review.csv and not review.drawio:
        raise _fail(f"{review_path.name} names no files. Run the check with --csv and --drawio.")
    return build_plan(_read_sources(review.csv, review.drawio), review.decisions)


ReviewOption = Annotated[
    Path | None,
    typer.Option(help="The review file. Default: DATA_DIR/imports/review.yaml."),
]


@import_app.command("check")
def import_check(
    csv_file: Annotated[
        Path | None, typer.Option("--csv", help="The spreadsheet, e.g. ini_record.csv.")
    ] = None,
    drawio_file: Annotated[
        Path | None, typer.Option("--drawio", help="The draw.io family chart.")
    ] = None,
    review: ReviewOption = None,
) -> None:
    """Read the files and write the review file with the proposed answers. Imports nothing."""
    settings = get_settings()
    review_path = _review_path(review, settings)
    try:
        saved = (
            read_review(review_path) if review_path.exists() else Review(None, None, Decisions())
        )
    except ReviewError as error:
        raise _fail(str(error)) from error
    chosen = Review(csv_file or saved.csv, drawio_file or saved.drawio, saved.decisions)
    plan = _plan(review_path, chosen)
    write_review(review_path, plan, chosen.csv, chosen.drawio)
    typer.echo(render_report(plan, review_path))
    dropped = sorted(set(saved.decisions.answers) - set(plan.answers))
    if dropped:
        typer.echo("\nThese answers no longer match a question and were dropped:")
        for question_id in dropped:
            typer.echo(f"  - {question_id}")


@import_app.command("apply")
def import_apply(review: ReviewOption = None) -> None:
    """Import what the review file says, into an empty tree. A backup is made first."""
    settings = get_settings()
    review_path = _review_path(review, settings)
    if not review_path.exists():
        raise _fail(
            "There's no review yet. Run: uv run ancestree import check --csv ... --drawio ..."
        )
    try:
        saved = read_review(review_path)
    except ReviewError as error:
        raise _fail(str(error)) from error
    plan = _plan(review_path, saved)
    unseen = [q.id for q in plan.questions if q.id not in saved.decisions.answers]
    if unseen:
        raise _fail(
            "The files have changed since the last check, which raised new questions:\n"
            + "\n".join(f"  - {question_id}" for question_id in unseen)
            + "\nRun `uv run ancestree import check` and look over the answers first."
        )
    report = render_report(plan, review_path)
    review_text = review_path.read_text(encoding="utf-8")

    async def work(driver: AsyncDriver, settings: Settings) -> ImportResult:
        await apply_migrations(driver, settings.neo4j_database)
        return await apply_plan(
            _context(driver, settings), plan, review_text=review_text, report=report
        )

    try:
        result = _with_database(work)
    except ImportRefusedError as error:
        raise _fail(str(error)) from error
    typer.echo(
        f"Imported {result.people} people and {result.placeholders} unknown parents, "
        f"{result.parent_links} parent links and {result.marriages} marriages.\n"
        f"  Backup from just before: {result.backup}\n"
        f"  Record of this import:   {result.record}\n"
        "To take it all back out: uv run ancestree import undo"
    )


@import_app.command("undo")
def import_undo(
    yes: Annotated[bool, typer.Option("--yes", help="Don't ask for confirmation.")] = False,
) -> None:
    """Take out everyone the last import added, as long as none has a photo yet."""
    settings = get_settings()
    record = latest_import(settings.data_dir)
    if record is None:
        typer.echo("There's no import to undo.")
        return
    if not yes:
        typer.confirm(
            f"Remove the {record['people']} people imported on {record['imported_at']}, "
            "with every link to them?",
            abort=True,
        )

    async def work(driver: AsyncDriver, settings: Settings) -> int:
        return await undo_import(_context(driver, settings), record)

    try:
        removed = _with_database(work)
    except ImportRefusedError as error:
        raise _fail(str(error)) from error
    typer.echo(f"Removed {removed} imported people. The tree is as it was before the import.")


@app.command()
def openapi(
    out: Annotated[Path, typer.Option(help="Where to write the schema.")] = Path(
        "../frontend/openapi.json"
    ),
) -> None:
    """Write the API schema that the frontend's types are generated from."""
    schema = create_app().openapi()
    out.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8", newline="\n")
    typer.echo(f"Wrote {out}")


@app.command("fetch-neo4j")
def fetch_neo4j(
    into: Annotated[Path, typer.Argument(help="The folder for them, e.g. for the tests.")],
) -> None:
    """Fetch the app's own Neo4j and its Java, once, checked against their fingerprints.

    The tests run on them with ANCESTREE_TEST_NEO4J=own and ANCESTREE_NEO4J_RUNTIME=<into>."""

    def progress(what: str, done: int, total: int | None) -> None:
        if total is not None and done == total:
            typer.echo(f"  {what}: {done // (1 << 20)} MB")

    fetched = Runtime(into).install(progress)
    state = "Fetched and checked" if fetched else "Already there"
    typer.echo(f"{state}: Neo4j {NEO4J_VERSION} and Java {JAVA_RELEASE}, in {into}")
