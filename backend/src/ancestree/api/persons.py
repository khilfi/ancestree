import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import ValidationError

from ancestree.api.deps import Ctx, Hist
from ancestree.domain.biography import Biography, BiographyUpdate, PictureAdded
from ancestree.domain.requests import (
    ChildrenOrder,
    FillIn,
    NewRelative,
    PersonInput,
    PersonPatch,
)
from ancestree.domain.views import (
    PersonDetail,
    PersonSaved,
    PersonSummary,
    RelativeAdded,
    TrashEntry,
)
from ancestree.media.photos import AVATAR_SIZES, MAX_UPLOAD_BYTES, Crop
from ancestree.services import biography, people, photos
from ancestree.services.context import RuleError

router = APIRouter(prefix="/persons", tags=["people"])

# The version in the URL changes with every new photo, so browsers may cache forever.
_FOREVER = {"Cache-Control": "public, max-age=31536000, immutable"}


@router.get("")
async def search_people(
    ctx: Ctx, q: str = "", limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[PersonSummary]:
    """Find people by name or nickname: every word matches the start of a word."""
    return await people.search(ctx, q, limit)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_person(ctx: Ctx, history: Hist, data: PersonInput) -> PersonSaved:
    async with history.change(ctx) as change:
        saved = await people.create_person(ctx, data)
        change.people.add(str(saved.person.id))
        change.label = f"Add {saved.person.full_name}"
    return saved


@router.get("/{person_id}")
async def get_person(ctx: Ctx, person_id: UUID) -> PersonDetail:
    return await people.get_person(ctx, person_id)


@router.put("/{person_id}")
async def update_person(ctx: Ctx, history: Hist, person_id: UUID, data: PersonInput) -> PersonSaved:
    """Replace everything the person form edits."""
    async with history.change(ctx, [person_id]) as change:
        saved = await people.update_person(ctx, person_id, data)
        change.label = f"Edit {saved.person.full_name}"
    return saved


# What a quick fix changed, for its Undo step: "Set Hassan bin Ismail's birthplace".
_PATCHED = {
    "gender": "gender",
    "birth_date": "date of birth",
    "residence": "place they live",
    "birth_place": "birthplace",
}


@router.patch("/{person_id}")
async def patch_person(ctx: Ctx, history: Hist, person_id: UUID, patch: PersonPatch) -> PersonSaved:
    """Change only what's given: a gender, a date of birth, where they live or where they
    were born, for the quick fixes in What's missing and on the map. One Undo
    step."""
    changes = patch.changes()
    if not changes:
        raise RuleError("nothing_to_change", "Give a gender, a date of birth or a place to change.")
    async with history.change(ctx, [person_id]) as change:
        saved = await people.patch_person(ctx, person_id, patch)
        what = _PATCHED[next(iter(changes))] if len(changes) == 1 else "details"
        change.label = f"Set {saved.person.full_name}'s {what}"
    return saved


@router.delete("/{person_id}")
async def delete_person(ctx: Ctx, history: Hist, person_id: UUID) -> TrashEntry:
    """Move to the Trash, restorable for 30 days."""

    async def run() -> tuple[TrashEntry, str]:
        entry = await people.delete_person(ctx, person_id)
        return entry, f"Move {entry.full_name} to the Trash"

    return await history.trash_step("out", person_id, run)


@router.post("/{person_id}/relatives", status_code=status.HTTP_201_CREATED)
async def add_relative(
    ctx: Ctx, history: Hist, person_id: UUID, request: NewRelative
) -> RelativeAdded:
    """Create a parent, spouse, child or sibling of this person, already linked."""
    others = [request.other_parent] if request.other_parent else []
    async with history.change(ctx, [person_id, *others]) as change:
        added = await people.add_relative(ctx, person_id, request)
        change.people.add(str(added.person.id))
        change.label = f"Add {added.person.full_name}"
    return added


@router.post("/{person_id}/fill-in")
async def fill_in_unknown_parent(
    ctx: Ctx, history: Hist, person_id: UUID, request: FillIn
) -> RelativeAdded:
    """Turn an unknown parent into someone new, or someone already in the tree."""
    existing = [request.existing] if request.existing else []
    async with history.change(ctx, [person_id, *existing]) as change:
        added = await people.fill_in(ctx, person_id, request)
        change.people.add(str(added.person.id))
        change.label = f"Fill in {added.person.full_name} as a parent"
    return added


@router.put("/{person_id}/children/order")
async def set_children_order(
    ctx: Ctx, history: Hist, person_id: UUID, order: ChildrenOrder
) -> PersonDetail:
    async with history.change(ctx, [person_id]) as change:
        detail = await people.set_children_order(ctx, person_id, order.child_ids)
        change.label = f"Order {detail.full_name}'s children"
    return detail


@router.put("/{person_id}/photo")
async def upload_photo(
    ctx: Ctx,
    person_id: UUID,
    file: Annotated[UploadFile, File(description="JPEG, PNG, WebP, HEIC, GIF, BMP or TIFF")],
    crop: Annotated[str | None, Form(description="JSON crop in percent; centred if absent")] = None,
) -> PersonDetail:
    return await photos.upload_photo(ctx, person_id, await _upload(file), _crop(crop))


@router.get("/{person_id}/photo/crop")
async def get_photo_crop(ctx: Ctx, person_id: UUID) -> Crop:
    """The square kept from the photo, so a new crop can start from it."""
    return await photos.current_crop(ctx, person_id)


@router.put("/{person_id}/photo/crop")
async def recrop_photo(ctx: Ctx, person_id: UUID, crop: Crop) -> PersonDetail:
    return await photos.recrop_photo(ctx, person_id, crop)


@router.delete("/{person_id}/photo")
async def remove_photo(ctx: Ctx, person_id: UUID) -> PersonDetail:
    """The photo moves to profile/previous/ in the person's folder; nothing is deleted."""
    return await photos.remove_photo(ctx, person_id)


@router.get("/{person_id}/photo/avatar", response_class=FileResponse)
async def get_avatar(
    ctx: Ctx, person_id: UUID, size: int = 128, v: int | None = None
) -> FileResponse:
    if size not in AVATAR_SIZES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="size must be 128 or 512")
    path = photos.photo_path(ctx, person_id, f"avatar-{size}.webp")
    return FileResponse(path, media_type="image/webp", headers=_cache(v))


@router.get("/{person_id}/photo/display", response_class=FileResponse)
async def get_display_photo(ctx: Ctx, person_id: UUID, v: int | None = None) -> FileResponse:
    """The whole photo, upright, for choosing a new crop."""
    path = photos.photo_path(ctx, person_id, "display.webp")
    return FileResponse(path, media_type="image/webp", headers=_cache(v))


@router.get("/{person_id}/biography")
async def get_biography(ctx: Ctx, person_id: UUID) -> Biography:
    """The life story (Markdown) and its Sources, from biography.md in the person's folder."""
    return await biography.read_biography(ctx, person_id)


@router.put("/{person_id}/biography")
async def save_biography(ctx: Ctx, person_id: UUID, update: BiographyUpdate) -> Biography:
    """Save the story. Refused (409, "changed_outside") if the file changed since
    `base_version`, e.g. in Obsidian; the answer carries the file as it is now."""
    return await biography.save_biography(ctx, person_id, update)


@router.post("/{person_id}/media", status_code=status.HTTP_201_CREATED)
async def add_picture(
    ctx: Ctx,
    person_id: UUID,
    file: Annotated[UploadFile, File(description="JPEG, PNG, WebP, HEIC, GIF, BMP or TIFF")],
) -> PictureAdded:
    """A picture for the story, kept in the person's media/ folder."""
    return await biography.add_picture(ctx, person_id, await _upload(file))


@router.get("/{person_id}/media/{name}", response_class=FileResponse)
async def get_picture(ctx: Ctx, person_id: UUID, name: str) -> FileResponse:
    # Every name is new, so a picture never changes: browsers may cache forever.
    path = biography.picture_path(ctx, person_id, name)
    return FileResponse(path, media_type="image/webp", headers=_FOREVER)


async def _upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail={"code": "too_large", "message": "That file is larger than 20 MB."},
        )
    return data


def _cache(version: int | None) -> dict[str, str]:
    return _FOREVER if version is not None else {"Cache-Control": "no-cache"}


def _crop(text: str | None) -> Crop | None:
    if not text:
        return None
    try:
        return Crop.model_validate(json.loads(text))
    except (ValueError, ValidationError) as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "bad_crop", "message": "The crop couldn't be read."},
        ) from error
