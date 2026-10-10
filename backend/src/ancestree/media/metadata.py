"""Photos' originals without what a camera writes into them, from 0.4.2.

A camera writes its make and model, the time, and where it was if it knew (GPS) into a photo.
Kept in the original, that would travel with it: in backups, the family folder and view-only
copies. So it's taken out as a photo comes in, and from the photos kept already, once, and from
those a backup brings back.

The picture itself stays as it was, and upright:
- JPEG, PNG and WebP lose their metadata alone, the picture's own data untouched; a photo turned
  by its metadata keeps that one setting, its orientation;
- TIFF is written again, losslessly, upright;
- HEIC, whose metadata can't be lifted out on its own, is encoded again, upright, at high quality;
- TIFF and HEIC only when they hold some, so a photo is encoded again once at most;
- GIF and BMP, which no camera writes, stay as they are.

Each is the same after a second time through: a photo cleaned already is left as it is.
"""

from __future__ import annotations

import logging
import zlib
from io import BytesIO

from PIL import Image, ImageOps

log = logging.getLogger(__name__)

ORIENTATION = 0x0112
_JPEG = b"\xff\xd8"
_PNG = b"\x89PNG\r\n\x1a\n"
# JPEG's segments that hold metadata: APP1 (Exif, XMP), APP13 (IPTC), and comments.
_JPEG_DROPPED = {0xE1, 0xED, 0xFE}
_MPF = b"MPF\x00"  # APP2's index of a multi-picture file's other pictures, gone with them
_PNG_DROPPED = {b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME"}
_WEBP_DROPPED = {b"EXIF", b"XMP "}
_WEBP_EXIF, _WEBP_XMP = 0x08, 0x04  # VP8X's flags for them
# A TIFF's tags that describe its picture alone, its colour profile included: any other is
# metadata, such as the camera's make (271), the time (306) or where it was (34853).
_TIFF_PICTURE = {
    *(254, 255, 256, 257, 258, 259, 262, 266, 273, 274, 277, 278, 279, 282, 283, 284, 296),
    *(317, 318, 319, 320, 322, 323, 324, 325, 338, 339, 340, 341, 347, 529, 530, 531, 532),
    34675,
}


class MetadataError(ValueError):
    """A file whose parts can't be told apart, to take its metadata out."""


def without_metadata(data: bytes, extension: str) -> bytes:
    """`data`, a photo's original saved as `extension`, without its camera's metadata. One that
    can't be taken apart as its kind is encoded again, upright, without any."""
    orientation = _orientation(data)
    try:
        if extension == "jpg":
            return _jpeg(data, orientation)
        if extension == "png":
            return _png(data, orientation)
        if extension == "webp":
            return _webp(data, orientation)
        if extension in ("tif", "heic"):
            return _again(data, extension) if _holds_metadata(data, extension) else data
    except MetadataError as error:
        log.warning("A photo's metadata was taken out by encoding it again: %s", error)
        return _again(data, extension)
    return data  # GIF, BMP: no camera writes them


def _holds_metadata(data: bytes, extension: str) -> bool:
    """Whether a TIFF or HEIC holds more than its picture, upright. Only then is it written
    again: one without any already, as every photo is once cleaned, is never encoded again."""
    with Image.open(BytesIO(data)) as image:
        if getattr(image, "n_frames", 1) > 1:  # other pictures, each with metadata of its own
            return True
        if extension == "tif":
            tags = getattr(image, "tag_v2", {})
            return bool(set(tags) - _TIFF_PICTURE) or tags.get(ORIENTATION, 1) != 1
        return any(image.info.get(key) for key in ("exif", "xmp", "metadata"))


def _orientation(data: bytes) -> int:
    """The way the camera says to turn the picture, 1 (as it is) to 8."""
    try:
        with Image.open(BytesIO(data)) as image:
            found = image.getexif().get(ORIENTATION, 1)
    except OSError, ValueError, SyntaxError:
        return 1
    return found if isinstance(found, int) and 1 <= found <= 8 else 1


def _tiff_orientation(orientation: int) -> bytes:
    """Exif's own TIFF holding the orientation alone: what a turned picture keeps."""
    entry = b"\x12\x01" + b"\x03\x00" + b"\x01\x00\x00\x00" + orientation.to_bytes(2, "little")
    return b"II*\x00" + b"\x08\x00\x00\x00" + b"\x01\x00" + entry + b"\x00\x00" + bytes(4)


def _jpeg(data: bytes, orientation: int) -> bytes:
    if not data.startswith(_JPEG):
        raise MetadataError("not a JPEG")
    kept = bytearray(_JPEG)
    turned = b"Exif\x00\x00" + _tiff_orientation(orientation) if orientation != 1 else b""
    at = 2
    while at < len(data):
        if data[at] != 0xFF:
            raise MetadataError("a JPEG segment that doesn't start as one")
        marker = data[at + 1]
        if marker == 0xFF:  # padding before a marker
            at += 1
            continue
        if turned and marker != 0xE0:  # after JFIF's own segment, the orientation
            kept += b"\xff\xe1" + (len(turned) + 2).to_bytes(2, "big") + turned
            turned = b""
        if marker == 0xDA:  # the picture's data, kept whole, to the end of this picture
            end = data.find(b"\xff\xd9", at)
            if end < 0:
                raise MetadataError("a JPEG with no end")
            kept += data[at : end + 2]  # what follows is another picture's, or nothing's
            return bytes(kept)
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            kept += data[at : at + 2]
            at += 2
            continue
        if at + 4 > len(data):
            raise MetadataError("a JPEG cut short")
        length = int.from_bytes(data[at + 2 : at + 4], "big")
        segment = data[at : at + 2 + length]
        if length < 2 or len(segment) != 2 + length:
            raise MetadataError("a JPEG segment cut short")
        if marker not in _JPEG_DROPPED and not (marker == 0xE2 and segment[4:8] == _MPF):
            kept += segment
        at += 2 + length
    raise MetadataError("a JPEG with no picture")


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    check = zlib.crc32(kind + payload).to_bytes(4, "big")
    return len(payload).to_bytes(4, "big") + kind + payload + check


def _png(data: bytes, orientation: int) -> bytes:
    if not data.startswith(_PNG):
        raise MetadataError("not a PNG")
    kept = bytearray(_PNG)
    turned = _tiff_orientation(orientation) if orientation != 1 else b""
    at = len(_PNG)
    while at + 12 <= len(data):
        length = int.from_bytes(data[at : at + 4], "big")
        kind = data[at + 4 : at + 8]
        chunk = data[at : at + 12 + length]
        if len(chunk) != 12 + length:
            raise MetadataError("a PNG chunk cut short")
        if turned and kind == b"IDAT":  # before the picture, where readers look for it
            kept += _png_chunk(b"eXIf", turned)
            turned = b""
        if kind not in _PNG_DROPPED:
            kept += chunk
        at += 12 + length
        if kind == b"IEND":
            return bytes(kept)
    raise MetadataError("a PNG with no end")


def _webp(data: bytes, orientation: int) -> bytes:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise MetadataError("not a WebP")
    chunks: list[tuple[bytes, bytes]] = []
    at = 12
    while at + 8 <= len(data):
        kind = data[at : at + 4]
        size = int.from_bytes(data[at + 4 : at + 8], "little")
        payload = data[at + 8 : at + 8 + size]
        if len(payload) != size:
            raise MetadataError("a WebP chunk cut short")
        chunks.append((kind, payload))
        at += 8 + size + (size & 1)
    extended = any(kind == b"VP8X" for kind, _ in chunks)
    turned = orientation != 1 and extended  # only the extended kind can say so
    kept = [(kind, payload) for kind, payload in chunks if kind not in _WEBP_DROPPED]
    if turned:
        kept.append((b"EXIF", _tiff_orientation(orientation)))
    body = bytearray(b"WEBP")
    for kind, payload in kept:
        if kind == b"VP8X":
            flags = payload[0] & ~(_WEBP_EXIF | _WEBP_XMP) | (_WEBP_EXIF if turned else 0)
            payload = bytes([flags]) + payload[1:]
        body += kind + len(payload).to_bytes(4, "little") + payload
        if len(payload) & 1:
            body += b"\x00"
    return b"RIFF" + len(body).to_bytes(4, "little") + bytes(body)


def _again(data: bytes, extension: str) -> bytes:
    """The picture encoded again, upright, without metadata: its colour profile kept."""
    with Image.open(BytesIO(data)) as opened:
        image = ImageOps.exif_transpose(opened)
    icc = image.info.get("icc_profile")
    for key in ("exif", "xmp", "XML:com.adobe.xmp", "comment"):
        image.info.pop(key, None)
    out = BytesIO()
    if extension == "heic":
        image.save(out, format="HEIF", quality=92, icc_profile=icc, exif=None, xmp=None)
    elif extension == "tif":
        image.save(out, format="TIFF", compression="tiff_adobe_deflate", icc_profile=icc)
    elif extension == "jpg":
        if image.mode not in ("RGB", "L", "CMYK"):
            image = image.convert("RGB")
        image.save(out, format="JPEG", quality=95, icc_profile=icc)
    elif extension == "png":
        image.save(out, format="PNG", icc_profile=icc)
    elif extension == "webp":
        image.save(out, format="WEBP", lossless=True, icc_profile=icc)
    else:
        return data
    return out.getvalue()
