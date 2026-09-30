"""Profile photos: check an upload, crop it to a square, make avatars.

An upload is trusted only after Pillow has decoded it. Everything the app serves is
re-encoded as WebP without EXIF data, so camera details and GPS never travel on.
"""

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
from pydantic import BaseModel, Field

register_heif_opener()  # iPhone photos (HEIC)
Image.MAX_IMAGE_PIXELS = 80_000_000  # refuse "decompression bombs" beyond ~80 megapixels

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
AVATAR_SIZES = (512, 128)
DISPLAY_SIZE = 1600  # the copy the browser crops against

_EXTENSIONS = {
    "JPEG": "jpg",
    "MPO": "jpg",
    "PNG": "png",
    "WEBP": "webp",
    "HEIF": "heic",
    "GIF": "gif",
    "BMP": "bmp",
    "TIFF": "tif",
}


class PhotoError(ValueError):
    """The upload can't be used as a photo."""


class Crop(BaseModel):
    """The kept square, in percent of the upright photo (react-easy-crop's `croppedArea`)."""

    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(gt=0, le=100)
    height: float = Field(gt=0, le=100)


@dataclass(frozen=True)
class ProcessedPhoto:
    extension: str
    crop: Crop
    avatars: dict[int, bytes]  # size in pixels -> WebP
    display: bytes  # upright WebP, at most DISPLAY_SIZE on each side


def process_photo(data: bytes, crop: Crop | None = None) -> ProcessedPhoto:
    """Decode, turn upright, crop (centred square by default) and encode the avatars."""
    image_format, upright = _decode(data)
    crop = crop or centred_square(*upright.size)
    face = upright.crop(crop_box(upright.size, crop))
    avatars = {
        size: _webp(face.resize((size, size), Image.Resampling.LANCZOS)) for size in AVATAR_SIZES
    }
    display = upright.copy()
    display.thumbnail((DISPLAY_SIZE, DISPLAY_SIZE), Image.Resampling.LANCZOS)
    return ProcessedPhoto(_EXTENSIONS[image_format], crop, avatars, _webp(display))


def process_picture(data: bytes) -> bytes:
    """A picture for a life story: upright, at most DISPLAY_SIZE on each side, WebP
    without EXIF. Only this copy is kept: the story is where it's used."""
    _, upright = _decode(data)
    upright.thumbnail((DISPLAY_SIZE, DISPLAY_SIZE), Image.Resampling.LANCZOS)
    return _webp(upright)


def thumbnail(data: bytes, size: int = 96) -> bytes:
    """A small square of a photo, made again from its pixels: for showing a picture that came
    in a file from elsewhere, such as a copy to edit's, never the bytes as they came."""
    _, upright = _decode(data)
    face = upright.crop(crop_box(upright.size, centred_square(*upright.size)))
    return _webp(face.resize((size, size), Image.Resampling.LANCZOS))


def _decode(data: bytes) -> tuple[str, Image.Image]:
    """An upload as an upright image, once Pillow has read it; its format too."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise PhotoError("That file is larger than 20 MB.")
    try:
        with Image.open(BytesIO(data)) as image:
            image_format = image.format or ""
            if image_format not in _EXTENSIONS:
                raise PhotoError("Use a JPEG, PNG, WebP, HEIC, GIF, BMP or TIFF photo.")
            upright = ImageOps.exif_transpose(image)  # also loads the pixels
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as error:
        raise PhotoError("That file isn't a photo AncesTree can read.") from error
    return image_format, upright.convert("RGBA" if _has_alpha(upright) else "RGB")


def centred_square(width: int, height: int) -> Crop:
    side = min(width, height)
    return Crop(
        x=(width - side) / 2 / width * 100,
        y=(height - side) / 2 / height * 100,
        width=side / width * 100,
        height=side / height * 100,
    )


def crop_box(size: tuple[int, int], crop: Crop) -> tuple[int, int, int, int]:
    """The crop in pixels, forced square and kept inside the photo."""
    width, height = size
    left = min(round(crop.x / 100 * width), width - 1)
    top = min(round(crop.y / 100 * height), height - 1)
    side = round(min(crop.width / 100 * width, crop.height / 100 * height))
    side = max(1, min(side, width - left, height - top))
    return left, top, left + side, top + side


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in {"RGBA", "LA", "PA"} or (
        image.mode == "P" and "transparency" in image.info
    )


def _webp(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, "WEBP", quality=85, method=4)  # no exif= argument: metadata is dropped
    return buffer.getvalue()
