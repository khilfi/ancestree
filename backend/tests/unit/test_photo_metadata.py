"""Photos' originals without what a camera writes into them, from 0.4.2: the place a
photo was taken, its camera and its time never travel in a backup, the family folder or a copy."""

from io import BytesIO
from pathlib import Path

import pillow_heif
import pytest
from PIL import Image, PngImagePlugin

from ancestree.media.metadata import ORIENTATION, without_metadata
from ancestree.media.photos import process_photo
from ancestree.storage import files

pillow_heif.register_heif_opener()

MAKE, GPS = 0x010F, 0x8825
WHERE = {1: "N", 2: (3.0, 8.0, 51.0), 3: "E", 4: (101.0, 41.0, 12.0)}  # made up


def camera(orientation: int = 1) -> Image.Exif:
    """What a camera writes: its make, and where it was; and how to turn the picture."""
    exif = Image.Exif()
    exif[MAKE] = "MadeUpCam"
    if orientation != 1:
        exif[ORIENTATION] = orientation
    exif.get_ifd(GPS).update(WHERE)
    return exif


def picture() -> Image.Image:
    image = Image.new("RGB", (64, 48), (200, 100, 50))
    image.paste((20, 60, 180), (0, 0, 32, 24))  # a corner, so a turn shows
    return image


def grainy() -> Image.Image:
    """A picture with a camera's grain: an encoding that loses some loses more each time."""
    return Image.merge("RGB", [Image.effect_noise((64, 48), 40 + 10 * band) for band in range(3)])


def saved(image: Image.Image, kind: str, **options: object) -> bytes:
    out = BytesIO()
    image.save(out, kind, **options)
    return out.getvalue()


def what_it_says(data: bytes) -> tuple[object, dict[int, object], int]:
    """A photo's camera, where it was, and its turn, as Pillow reads them."""
    with Image.open(BytesIO(data)) as image:
        exif = image.getexif()
        return exif.get(MAKE), dict(exif.get_ifd(GPS)), exif.get(ORIENTATION, 1)


def pixels(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as image:
        return image.convert("RGB").tobytes()


@pytest.mark.parametrize(
    ("kind", "extension", "options"),
    [
        ("JPEG", "jpg", {"quality": 90}),
        ("PNG", "png", {}),
        ("WEBP", "webp", {"lossless": True}),
    ],
)
@pytest.mark.parametrize("orientation", [1, 6])
def test_a_photo_loses_its_metadata_and_keeps_its_picture_and_turn(
    kind: str, extension: str, options: dict[str, object], orientation: int
) -> None:
    original = saved(picture(), kind, exif=camera(orientation).tobytes(), **options)
    assert what_it_says(original)[:2] == ("MadeUpCam", WHERE) or kind == "WEBP"

    cleaned = without_metadata(original, extension)

    assert what_it_says(cleaned) == (None, {}, orientation)
    assert b"MadeUpCam" not in cleaned
    assert pixels(cleaned) == pixels(original)  # the picture's own data, untouched


def test_a_pngs_text_goes_too() -> None:
    text = PngImagePlugin.PngInfo()
    text.add_text("Comment", "Taken at Kampung Laut")
    original = saved(picture(), "PNG", pnginfo=text)
    cleaned = without_metadata(original, "png")
    assert b"Kampung Laut" in original
    assert b"Kampung Laut" not in cleaned
    assert pixels(cleaned) == pixels(original)


def test_a_tiff_is_written_again_without_it_losing_nothing_of_the_picture() -> None:
    original = saved(picture(), "TIFF", exif=camera().tobytes())
    assert what_it_says(original)[1] == WHERE
    cleaned = without_metadata(original, "tif")
    assert what_it_says(cleaned) == (None, {}, 1)
    assert pixels(cleaned) == pixels(original)


def test_a_heic_is_encoded_again_upright_and_without_it() -> None:
    original = saved(picture(), "HEIF", quality=90, exif=camera(6).tobytes())
    cleaned = without_metadata(original, "heic")
    with Image.open(BytesIO(cleaned)) as image:
        assert not image.info.get("exif")
        assert image.size == (48, 64)  # upright, as it showed before, and turned once only


def test_another_picture_after_the_first_goes_too() -> None:
    """A multi-picture JPEG (MPO), or anything appended: only the photo itself is kept."""
    first = saved(picture(), "JPEG", exif=camera().tobytes())
    second = saved(picture(), "JPEG", exif=camera().tobytes())
    cleaned = without_metadata(first + second, "jpg")
    assert cleaned.endswith(b"\xff\xd9")
    assert b"MadeUpCam" not in cleaned
    assert pixels(cleaned) == pixels(first)


def test_one_that_cant_be_taken_apart_is_encoded_again_without_it() -> None:
    original = saved(picture(), "JPEG", exif=camera().tobytes())
    at = original.index(b"\xff\xda")  # the picture's data, with nothing before it in order
    broken = original[:at] + b"\x00" + original[at:]  # a stray byte between two segments
    cleaned = without_metadata(broken, "jpg")
    assert what_it_says(cleaned) == (None, {}, 1)


@pytest.mark.parametrize(
    ("kind", "extension", "options"),
    [
        ("JPEG", "jpg", {"quality": 90}),
        ("PNG", "png", {}),
        ("WEBP", "webp", {"lossless": True}),
        ("TIFF", "tif", {}),
        ("HEIF", "heic", {"quality": 90}),
    ],
)
def test_a_photo_cleaned_once_is_left_as_it_is(
    kind: str, extension: str, options: dict[str, object]
) -> None:
    """A restore cleans every photo again, and so does each change the family folder brings:
    one cleaned already comes out the same, and a HEIC is never encoded again, losing more."""
    original = saved(grainy(), kind, exif=camera(6).tobytes(), **options)
    once = without_metadata(original, extension)
    assert once != original
    assert without_metadata(once, extension) == once


def test_gifs_and_bmps_which_no_camera_writes_stay_as_they_are() -> None:
    for kind, extension in (("GIF", "gif"), ("BMP", "bmp")):
        original = saved(picture(), kind)
        assert without_metadata(original, extension) == original


def test_a_photo_is_kept_without_it_as_it_comes_in(tmp_path: Path) -> None:
    original = saved(picture(), "JPEG", exif=camera(6).tobytes())
    someone = "00000000-0000-4000-8000-000000000001"
    files.store_photo(tmp_path, someone, original, process_photo(original))
    [kept] = files.photo_originals(tmp_path)
    assert what_it_says(kept.read_bytes()) == (None, {}, 6)


def test_photos_kept_from_before_lose_it_once(tmp_path: Path) -> None:
    """People's photos, their earlier ones and the Trash's, as a backup holds them too."""
    original = saved(picture(), "JPEG", exif=camera().tobytes())
    places = [
        tmp_path / "people" / "a" / "profile" / "original.jpg",
        tmp_path / "people" / "a" / "profile" / "previous" / "2026-10-01T10-00-00-original.jpg",
        tmp_path / "trash" / "2026-10-02T10-00-00_x" / "files" / "profile" / "original.jpg",
    ]
    for place in places:
        place.parent.mkdir(parents=True, exist_ok=True)
        place.write_bytes(original)
    story = tmp_path / "people" / "a" / "pictures" / "original.jpg"  # not a profile's: left
    story.parent.mkdir(parents=True)
    story.write_bytes(b"not looked at")
    assert not files.photos_cleaned(tmp_path)

    assert files.clean_photos(tmp_path) == 3

    assert all(what_it_says(place.read_bytes())[:2] == (None, {}) for place in places)
    assert story.read_bytes() == b"not looked at"
    assert files.photos_cleaned(tmp_path)
    marker = (tmp_path / "settings" / files.PHOTOS_CLEANED).read_bytes()
    assert files.clean_photos(tmp_path) == 0  # once they're clean, nothing more to do
    assert (tmp_path / "settings" / files.PHOTOS_CLEANED).read_bytes() == marker


def test_one_that_cant_be_read_is_left_as_it_is(tmp_path: Path) -> None:
    place = tmp_path / "people" / "a" / "profile" / "original.jpg"
    place.parent.mkdir(parents=True)
    place.write_bytes(b"not a photo at all")
    assert files.clean_photos(tmp_path) == 0
    assert place.read_bytes() == b"not a photo at all"
