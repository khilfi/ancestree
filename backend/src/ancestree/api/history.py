from fastapi import APIRouter

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.views import HistoryMove, HistoryView

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
async def get_history(history: Hist) -> HistoryView:
    """What Undo and Redo would do next."""
    return history.view()


@router.post("/undo")
async def undo(ctx: Ctx, history: Hist, step: str | None = None) -> HistoryMove:
    """Undo the latest change; with `step`, only if that's still the latest ("not_latest").
    Refused (409, "cant_undo") if what it changed has since been changed another way: the
    history is then cleared, so nothing made meanwhile is overwritten."""
    done = await history.undo(ctx, step)
    return HistoryMove(done=done.view(), history=history.view())


@router.post("/redo")
async def redo(ctx: Ctx, history: Hist, step: str | None = None) -> HistoryMove:
    """Redo the change undone last."""
    done = await history.redo(ctx, step)
    return HistoryMove(done=done.view(), history=history.view())
