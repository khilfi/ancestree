"""Importing a spreadsheet, and the earlier imports: of
spreadsheets, and of changes from relatives."""

import json
from pathlib import PurePath
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.imports import ImportDone, ImportPreview, ImportSummary, ImportTakenBack
from ancestree.exchange.spreadsheet import ENCODING
from ancestree.importing.sheet import MAX_BYTES
from ancestree.importing.template import template_csv
from ancestree.services import imports

router = APIRouter(prefix="/imports", tags=["import"])

_CSV = "text/csv; charset=utf-8"
Spreadsheet = Annotated[UploadFile, File(description="A spreadsheet saved as CSV")]
Answers = Annotated[
    str, Form(description="Your answers so far, as JSON: each question's id -> an option's id")
]
Chosen = Annotated[
    str | None,
    Form(
        description="The changes ticked, as a JSON list of their ids. Left out: those "
        "ticked to begin with."
    ),
]


def _bad(code: str, message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": code, "message": message}
    )


async def _upload(file: UploadFile) -> tuple[bytes, str]:
    data = await file.read(MAX_BYTES + 1)  # one byte more says it's too big
    name = PurePath((file.filename or "").replace("\\", "/")).name[:120]
    return data, name or "spreadsheet.csv"


def _answers(text: str) -> dict[str, str]:
    try:
        value = json.loads(text or "{}")
    except ValueError:
        value = None
    if not isinstance(value, dict) or not all(
        isinstance(key, str) and isinstance(answer, str) for key, answer in value.items()
    ):
        raise _bad("bad_answers", "The answers aren't in a form I can read.")
    return value


def _chosen(text: str | None) -> list[str] | None:
    if text is None:
        return None
    try:
        value = json.loads(text)
    except ValueError:
        value = None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise _bad("bad_chosen", "The changes ticked aren't in a form I can read.")
    return value


@router.get("/template", response_class=Response, responses={200: {"content": {_CSV: {}}}})
async def import_template(example: bool = False) -> Response:
    """The columns an import reads, as a CSV that Excel opens. With example=true, filled in
    with the fictional test family."""
    name = "ancestree-import-example.csv" if example else "ancestree-import-template.csv"
    return Response(
        template_csv(example=example).encode(ENCODING),
        media_type=_CSV,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/preview")
async def preview_import(ctx: Ctx, file: Spreadsheet, answers: Answers = "{}") -> ImportPreview:
    """What an import would change, for you to tick, its questions, and what it would leave
    out. The import runs inside the database and is rolled back: nothing is written."""
    data, name = await _upload(file)
    return await imports.preview_import(ctx, data, name, _answers(answers))


@router.post("", status_code=status.HTTP_201_CREATED)
async def run_import(
    ctx: Ctx, history: Hist, file: Spreadsheet, answers: Answers = "{}", chosen: Chosen = None
) -> ImportDone:
    """Import the file with these answers and the changes ticked: a backup first, then one
    Undo step."""
    data, name = await _upload(file)
    return await imports.run_import(ctx, history, data, name, _answers(answers), _chosen(chosen))


@router.get("")
async def list_imports(ctx: Ctx) -> list[ImportSummary]:
    """Earlier imports, newest first: of spreadsheets, and of changes from relatives, from a
    copy to edit as it once was, or from their computers."""
    return await imports.list_imports(ctx)


@router.get("/{import_id}/report", response_class=FileResponse)
async def import_report(ctx: Ctx, import_id: str) -> FileResponse:
    """What an import left out or found different, as a CSV."""
    path = imports.report_path(ctx, import_id)
    return FileResponse(path, media_type=_CSV, filename=f"ancestree-import-{import_id}.csv")


@router.post("/{import_id}/take-back")
async def take_back_import(ctx: Ctx, history: Hist, import_id: str) -> ImportTakenBack:
    """Undo an import: everyone it added goes to the Trash, with their links; its other links
    go; the details it changed go back, and the people it removed come back."""
    return await imports.take_back(ctx, history, import_id)
