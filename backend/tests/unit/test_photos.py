from io import BytesIO

import pytest
from PIL import Image

from ancestree.media.photos import (
    AVATAR_SIZES,
    MAX_UPLOAD_BYTES,
    Crop,
    PhotoError,
    crop_box,
    process_photo,
)


def photo(
    size: tuple[int, int], *, fmt: str = "JPEG", mode: str = "RGB", orientation: int = 0
) -> bytes:
    image = Image.new(mode, size, (200, 60, 60, 128) if mode == "RGBA" else (200, 60, 60))
    exif = Image.Exif()
    exif[0x0110] = "Camera model"
    if orientation:
        exif[0x0112] = orientation
    buffer = BytesIO()
    image.save(buffer, fmt, **({"exif": exif.tobytes()} if fmt == "JPEG" else {}))
    return buffer.getvalue()


def opened(data: bytes) -> Image.Image:
    return Image.open(BytesIO(data))


def test_avatars_are_square_webp_with_no_camera_data() -> None:
    processed = process_photo(photo((400, 300)))

    assert processed.extension == "jpg"
    for size in AVATAR_SIZES:
        avatar = opened(processed.avatars[size])
        assert avatar.format == "WEBP"
        assert avatar.size == (size, size)
        assert not avatar.getexif()


def test_the_camera_orientation_is_applied() -> None:
    # Orientation 6: the camera was turned; the upright photo is portrait.
    display = opened(process_photo(photo((400, 200), orientation=6)).display)

    assert display.size == (200, 400)


def test_without_a_crop_the_centre_square_is_used() -> None:
    crop = process_photo(photo((400, 200))).crop

    assert (crop.x, crop.y, crop.width, crop.height) == (25, 0, 50, 100)


def test_a_crop_is_kept_square_and_inside_the_photo() -> None:
    assert crop_box((100, 100), Crop(x=90, y=90, width=50, height=50)) == (90, 90, 100, 100)
    assert crop_box((400, 200), Crop(x=0, y=0, width=50, height=100)) == (0, 0, 200, 200)


def test_transparent_pngs_stay_transparent() -> None:
    processed = process_photo(photo((64, 64), fmt="PNG", mode="RGBA"))

    assert opened(processed.avatars[128]).mode == "RGBA"


@pytest.mark.parametrize("data", [b"not a photo at all", b"%PDF-1.7 a document"])
def test_files_that_are_not_photos_are_refused(data: bytes) -> None:
    with pytest.raises(PhotoError, match="isn't a photo"):
        process_photo(data)


def test_files_over_the_size_limit_are_refused() -> None:
    with pytest.raises(PhotoError, match="larger than 20 MB"):
        process_photo(b"\0" * (MAX_UPLOAD_BYTES + 1))
