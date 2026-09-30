from fastapi import APIRouter

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.views import RestoreResult, TrashEntry
from ancestree.services import people

router = APIRouter(prefix="/trash", tags=["people"])


@router.get("")
async def list_trash(ctx: Ctx) -> list[TrashEntry]:
    """Deleted people, newest first. Each stays restorable for 30 days."""
    return await people.trash(ctx)


@router.post("/{entry}/restore")
async def restore_from_trash(ctx: Ctx, history: Hist, entry: str) -> RestoreResult:
    """Put someone back, with their files and every link to people still in the tree."""

    async def run() -> tuple[RestoreResult, str]:
        result = await people.restore(ctx, entry)
        return result, f"Restore {result.person.full_name}"

    # The person's id is only known once restored: read it from the entry first.
    person_id = (await people.trash_entry(ctx, entry)).person_id
    return await history.trash_step("in", person_id, run)
