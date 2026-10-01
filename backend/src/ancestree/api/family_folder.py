"""The family folder: signing in to Google, starting or joining the family's folder,
the keeper's answers to who asks to join, and to the changes relatives' computers send to the
keeper."""

from typing import Annotated, cast

from fastapi import APIRouter, Path, Request

from ancestree.domain.familyfolder import (
    Admit,
    BringIn,
    FamilyFolderStatus,
    Invite,
    JoinFamily,
    OneComputer,
    Recover,
    ReviewChanges,
    SharedFolder,
    SignInStarted,
    StartFamily,
    TurnDown,
)
from ancestree.domain.imports import CopyPreview, ImportDone
from ancestree.services.familyfolder import FamilyFolder

router = APIRouter(prefix="/family-folder", tags=["family folder"])
Device = Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")]  # a computer, as the family knows it


def _folder(request: Request) -> FamilyFolder:
    return cast(FamilyFolder, request.app.state.family_folder)


@router.get("")
async def get_family_folder(request: Request) -> FamilyFolderStatus:
    """Where this computer stands: signed in or not, its part in a family folder, who's in
    it, who's asking to join, and what's in the way, if anything."""
    return await _folder(request).status()


@router.post("/sign-in")
async def sign_in_to_google(request: Request) -> SignInStarted:
    """Start signing in to Google: open `url` in the browser, then watch the status."""
    return SignInStarted(url=await _folder(request).sign_in())


@router.post("/sign-out")
async def sign_out_of_google(request: Request) -> FamilyFolderStatus:
    """Forget the sign-in here and give it back to Google. The family folder waits."""
    folder = _folder(request)
    await folder.sign_out()
    return await folder.status()


@router.post("/start")
async def start_family_folder(request: Request, body: StartFamily) -> FamilyFolderStatus:
    """Start the family's folder in this Google account's Drive, as its keeper. The status
    carries the recovery code, this once."""
    folder = _folder(request)
    await folder.start(body)
    return await folder.status()


@router.post("/recovery-seen")
async def recovery_code_seen(request: Request) -> FamilyFolderStatus:
    """The recovery code is kept safe: it's never shown again."""
    folder = _folder(request)
    folder.recovery_seen()
    return await folder.status()


@router.get("/shared")
async def shared_family_folders(request: Request) -> list[SharedFolder]:
    """Family folders shared with this Google account, to join."""
    return await _folder(request).shared()


@router.post("/join")
async def join_family_folder(request: Request, body: JoinFamily) -> FamilyFolderStatus:
    """Ask to join the family in a shared folder. The status carries the code to read to the
    keeper."""
    folder = _folder(request)
    await folder.join(body)
    return await folder.status()


@router.post("/recover")
async def recover_family_folder(request: Request, body: Recover) -> FamilyFolderStatus:
    """Be the family's keeper again on this computer, from the recovery code."""
    folder = _folder(request)
    await folder.recover(body)
    return await folder.status()


@router.post("/invite")
async def invite_to_family_folder(request: Request, body: Invite) -> FamilyFolderStatus:
    """Share the family folder with a relative's Google account (the keeper's)."""
    folder = _folder(request)
    await folder.invite(body)
    return await folder.status()


@router.post("/admit")
async def admit_to_family_folder(request: Request, body: Admit) -> FamilyFolderStatus:
    """Let a computer in, with a role, once its code matches (the keeper's)."""
    folder = _folder(request)
    await folder.admit(body)
    return await folder.status()


@router.post("/refuse")
async def refuse_family_folder(request: Request, body: OneComputer) -> FamilyFolderStatus:
    """Turn away a computer asking to join (the keeper's)."""
    folder = _folder(request)
    await folder.refuse(body)
    return await folder.status()


@router.post("/remove")
async def remove_from_family_folder(request: Request, body: OneComputer) -> FamilyFolderStatus:
    """Remove a computer from the family: it can't read what comes after (the keeper's)."""
    folder = _folder(request)
    await folder.remove(body)
    return await folder.status()


@router.post("/sync")
async def sync_family_folder(request: Request) -> FamilyFolderStatus:
    """Keep in step now, rather than within the minute."""
    folder = _folder(request)
    await folder.sync()
    return await folder.status()


@router.post("/answers-seen")
async def family_folder_answers_seen(request: Request) -> FamilyFolderStatus:
    """The keeper's answers to this computer's changes, read: not shown again (a relative's)."""
    folder = _folder(request)
    folder.answers_seen()
    return await folder.status()


@router.post("/changes/{device}/{proposal}/review")
async def review_family_folder_changes(
    request: Request, device: Device, proposal: int, body: ReviewChanges
) -> CopyPreview:
    """What a relative's computer sent, compared with the family it was made on and with the
    tree now, for you to tick, as changes from a copy are (the keeper's). Nothing is written."""
    return await _folder(request).review(device, proposal, body)


@router.post("/changes/{device}/bring-in")
async def bring_in_family_folder_changes(
    request: Request, device: Device, body: BringIn
) -> ImportDone:
    """Bring in what's ticked of a relative's computer's changes: a backup first, one Undo step,
    and Take back later. It reaches everyone, and the computer hears what wasn't taken."""
    return await _folder(request).bring_in(device, body)


@router.post("/changes/{device}/turn-down")
async def turn_down_family_folder_changes(
    request: Request, device: Device, body: TurnDown
) -> FamilyFolderStatus:
    """Take none of a relative's computer's changes; it hears so, with your note."""
    folder = _folder(request)
    await folder.turn_down(device, body)
    return await folder.status()
