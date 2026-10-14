"""Pictures drawn for the example family: a portrait for
each of its people, and a few scenes for their stories. Drawn here, flat and simple, from
shapes alone: no real faces, nothing from elsewhere, free to use. The same person draws the
same every time."""

import hashlib
import io
import math
from dataclasses import dataclass
from typing import Literal

from PIL import Image, ImageDraw

SIZE = 1024  # the units a portrait is drawn in
PORTRAIT = 768  # its side, as kept: the app makes its own copies from it
_SCALE = 2  # drawn larger, then made smaller, for smooth edges

type Colour = tuple[int, int, int]
Headwear = Literal["none", "tudung", "songkok", "kopiah", "bun", "long"]

# Skin, from the lightest; each with the shade beneath it (the neck, the ears).
SKINS: list[tuple[Colour, Colour]] = [
    ((246, 214, 186), (226, 188, 158)),
    ((232, 190, 150), (210, 164, 124)),
    ((214, 166, 122), (190, 140, 98)),
    ((188, 136, 96), (162, 112, 76)),
    ((150, 104, 70), (126, 84, 54)),
]
BACKGROUNDS: list[Colour] = [
    (204, 228, 222),
    (232, 222, 200),
    (214, 222, 240),
    (238, 214, 214),
    (222, 232, 204),
    (236, 226, 240),
    (246, 230, 206),
    (206, 226, 236),
]
CLOTHES: list[Colour] = [
    (28, 94, 110),
    (122, 42, 64),
    (44, 84, 150),
    (70, 110, 60),
    (150, 96, 40),
    (90, 60, 120),
    (180, 70, 70),
    (40, 120, 120),
]
SCARVES: list[Colour] = [
    (232, 196, 200),
    (176, 206, 226),
    (214, 196, 238),
    (240, 222, 170),
    (182, 214, 190),
    (120, 70, 90),
    (60, 80, 120),
    (236, 236, 228),
]


@dataclass(frozen=True)
class Look:
    """How someone is drawn: as their age shows, their skin, what they wear on their head."""

    key: str  # who: the same key draws the same
    female: bool
    age: int  # as drawn: now, or late in their life
    skin: int  # into SKINS
    headwear: Headwear
    glasses: bool = False
    beard: bool = False


def _pick[T](key: str, what: str, options: list[T]) -> T:
    digest = hashlib.sha256(f"{key}:{what}".encode()).digest()
    return options[digest[0] % len(options)]


def _mix(a: Colour, b: Colour, share: float) -> Colour:
    return (
        round(a[0] + (b[0] - a[0]) * share),
        round(a[1] + (b[1] - a[1]) * share),
        round(a[2] + (b[2] - a[2]) * share),
    )


def _hair(look: Look) -> Colour:
    black: Colour = (34, 28, 26)
    if look.age >= 70:
        return (222, 220, 216)
    if look.age >= 55:
        return _mix(black, (200, 198, 194), 0.6)
    if look.age >= 45:
        return _mix(black, (180, 178, 174), 0.25)
    return _pick(look.key, "hair", [black, (52, 36, 28), (40, 32, 30)])


class _Pen:
    """Draws in a portrait's own units (0 to SIZE), on a canvas _SCALE times larger."""

    def __init__(self, image: Image.Image) -> None:
        self.draw = ImageDraw.Draw(image)

    @staticmethod
    def _box(cx: float, cy: float, rx: float, ry: float) -> list[float]:
        return [(cx - rx) * _SCALE, (cy - ry) * _SCALE, (cx + rx) * _SCALE, (cy + ry) * _SCALE]

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, fill: Colour) -> None:
        self.draw.ellipse(self._box(cx, cy, rx, ry), fill=fill)

    def chord(
        self, cx: float, cy: float, rx: float, ry: float, start: float, end: float, fill: Colour
    ) -> None:
        self.draw.chord(self._box(cx, cy, rx, ry), start, end, fill=fill)

    def arc(
        self,
        cx: float,
        cy: float,
        rx: float,
        ry: float,
        start: float,
        end: float,
        colour: Colour,
        width: float,
    ) -> None:
        self.draw.arc(
            self._box(cx, cy, rx, ry), start, end, fill=colour, width=round(width * _SCALE)
        )

    def polygon(self, points: list[tuple[float, float]], fill: Colour) -> None:
        self.draw.polygon([(x * _SCALE, y * _SCALE) for x, y in points], fill=fill)

    def rounded(
        self, left: float, top: float, right: float, bottom: float, radius: float, fill: Colour
    ) -> None:
        self.draw.rounded_rectangle(
            [left * _SCALE, top * _SCALE, right * _SCALE, bottom * _SCALE],
            radius=radius * _SCALE,
            fill=fill,
        )

    def line(self, points: list[tuple[float, float]], colour: Colour, width: float) -> None:
        self.draw.line(
            [(x * _SCALE, y * _SCALE) for x, y in points],
            fill=colour,
            width=round(width * _SCALE),
            joint="curve",
        )


def portrait(look: Look) -> bytes:
    """Their portrait, as a PNG, PORTRAIT pixels square; drawn in units of SIZE."""
    background = _pick(look.key, "bg", BACKGROUNDS)
    canvas = Image.new("RGB", (SIZE * _SCALE, SIZE * _SCALE), background)
    pen = _Pen(canvas)
    skin, shade = SKINS[look.skin % len(SKINS)]
    hair = _hair(look)
    child = look.age < 13
    old = look.age >= 60
    clothes = _pick(look.key, "clothes", CLOTHES)
    scarf = _pick(look.key, "scarf", SCARVES)

    # A lighter round behind the head.
    pen.ellipse(512, 470, 380, 380, _mix(background, (255, 255, 255), 0.35))

    head_y = 470 if child else 440
    rx, ry = (172, 176) if child else (160, 196)
    shoulders = 800 if child else 760

    # Long hair falls behind the shoulders.
    if look.headwear == "long":
        pen.rounded(512 - rx - 34, head_y - 110, 512 + rx + 34, shoulders + 40, 130, hair)

    # The body, and the neck.
    width = 320 if child else 350
    pen.rounded(512 - width, shoulders - 30, 512 + width, SIZE + 260, 230, clothes)
    pen.rounded(512 - 58, head_y + ry - 70, 512 + 58, shoulders + 10, 30, shade)
    if look.female:
        pen.chord(512, shoulders - 30, 104, 70, 0, 180, shade)  # a round neckline
    else:
        pen.polygon(
            [(512 - 64, shoulders - 30), (512, shoulders + 60), (512 + 64, shoulders - 30)], shade
        )
        # The standing collar of a baju Melayu.
        pen.arc(512, shoulders - 26, 76, 26, 0, 180, _mix(clothes, (255, 255, 255), 0.3), 16)

    # A tudung frames the face, and falls over the shoulders.
    if look.headwear == "tudung":
        side = rx + 58
        pen.polygon(
            [
                (512 - side, head_y + 40),
                (512 - 280, shoulders + 70),
                (512 + 280, shoulders + 70),
                (512 + side, head_y + 40),
            ],
            scarf,
        )
        pen.ellipse(512, shoulders + 70, 280, 80, scarf)
        pen.ellipse(512, head_y - 6, side, ry + 56, scarf)
        pen.arc(512, head_y + 4, rx + 18, ry + 22, 200, 340, _mix(scarf, (0, 0, 0), 0.08), 10)

    # The ears, where they show.
    if look.headwear not in ("tudung", "long"):
        pen.ellipse(512 - rx + 4, head_y + 22, 26, 44, shade)
        pen.ellipse(512 + rx - 4, head_y + 22, 26, 44, shade)

    # The face: inside a tudung, a little smaller, its edge framed by it.
    if look.headwear == "tudung":
        pen.ellipse(512, head_y + 14, rx - 8, ry - 18, skin)
    else:
        pen.ellipse(512, head_y, rx, ry, skin)

    # Hair, or what covers it: hair over the crown, its line arched over the forehead.
    bald = not look.female and look.age >= 68 and look.headwear == "none"
    if bald:  # hair at the sides alone
        for side in (-1, 1):
            pen.ellipse(512 + side * (rx - 10), head_y - 34, 30, 56, hair)
    elif look.headwear in ("none", "songkok", "kopiah", "bun", "long"):
        pen.chord(512, head_y - 14, rx + 8, ry + 8, 180, 360, hair)
        pen.chord(512, head_y - 12, rx - 26, 112 if look.female else 96, 180, 360, skin)
    if look.headwear == "bun":
        pen.ellipse(512, head_y - ry - 18, 72, 58, hair)
    if look.headwear == "songkok":
        pen.rounded(
            512 - rx - 2, head_y - ry - 14, 512 + rx + 2, head_y - ry + 112, 22, (26, 24, 28)
        )
        pen.line(
            [(512 - rx + 10, head_y - ry + 30), (512 + rx - 10, head_y - ry + 30)], (44, 42, 48), 5
        )
    elif look.headwear == "kopiah":
        pen.chord(512, head_y - ry + 112, rx + 2, 130, 180, 360, (246, 246, 240))

    # Eyebrows and eyes.
    brow = (200, 198, 194) if look.age >= 70 else _mix(hair, (0, 0, 0), 0.2)
    eye_y = head_y + (10 if child else 0)
    for side in (-1, 1):
        x = 512 + side * 70
        pen.arc(x, eye_y - 52, 44, 18, 200, 340, brow, 9)
        if old:
            pen.arc(x, eye_y + 4, 22, 12, 200, 340, (40, 30, 28), 7)  # eyes kind with age
        else:
            pen.ellipse(x, eye_y, 15 if not child else 18, 19 if not child else 22, (40, 30, 28))
            pen.ellipse(x + 5, eye_y - 6, 5, 5, (255, 255, 255))
    if look.glasses:
        frame = (60, 50, 46)
        for side in (-1, 1):
            x = 512 + side * 70
            pen.draw.rounded_rectangle(
                [
                    (x - 48) * _SCALE,
                    (eye_y - 34) * _SCALE,
                    (x + 48) * _SCALE,
                    (eye_y + 30) * _SCALE,
                ],
                radius=22 * _SCALE,
                outline=frame,
                width=7 * _SCALE,
            )
        pen.line([(512 - 22, eye_y - 8), (512 + 22, eye_y - 8)], frame, 7)

    # Nose, cheeks, mouth.
    pen.arc(512, eye_y + 70, 20, 16, 20, 160, shade, 7)
    if look.female or child:
        blush = _mix(skin, (236, 140, 140), 0.35)
        pen.ellipse(512 - 105, eye_y + 92, 34, 20, blush)
        pen.ellipse(512 + 105, eye_y + 92, 34, 20, blush)
    lips = (176, 84, 84) if look.female else _mix(shade, (120, 50, 50), 0.4)
    pen.arc(512, eye_y + 118, 52, 30, 20, 160, lips, 9)
    if old:
        lines = _mix(skin, shade, 0.9)
        pen.arc(512 - 88, eye_y + 104, 30, 40, 100, 200, lines, 5)
        pen.arc(512 + 88, eye_y + 104, 30, 40, 340, 80, lines, 5)
        pen.arc(512, head_y - ry + 70, 50, 10, 200, 340, lines, 4)
    if look.beard:
        beard = (236, 234, 230) if look.age >= 60 else hair
        pen.chord(512, head_y + 4, rx - 4, ry + 8, 48, 132, beard)  # on the chin
        pen.ellipse(512, eye_y + 122, 50, 22, skin)  # the mouth's own space
        pen.arc(512, eye_y + 100, 56, 16, 195, 345, beard, 12)  # and a moustache
        pen.arc(512, eye_y + 118, 44, 22, 20, 160, lips, 9)

    out = io.BytesIO()
    canvas.resize((PORTRAIT, PORTRAIT), Image.Resampling.LANCZOS).save(out, "PNG")
    return out.getvalue()


Scene = Literal["river", "station", "garden", "city"]
_WIDE = (1600, 1000)


def scene(name: Scene) -> bytes:
    """A picture for a story, drawn: the river by a kampung, a railway station, a garden, or a
    city across the sea. A PNG, 1600 by 1000."""
    width, height = _WIDE
    canvas = Image.new("RGB", (width * _SCALE, height * _SCALE))
    draw = ImageDraw.Draw(canvas)
    top, bottom = {
        "river": ((120, 196, 236), (214, 238, 246)),
        "station": ((246, 200, 150), (252, 236, 210)),
        "garden": ((150, 210, 240), (226, 244, 250)),
        "city": ((60, 70, 120), (220, 140, 120)),
    }[name]
    for y in range(height * _SCALE):  # the sky, lighter towards the ground
        draw.line([(0, y), (width * _SCALE, y)], fill=_mix(top, bottom, y / (height * _SCALE)))

    def s(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        return [(x * _SCALE, y * _SCALE) for x, y in points]

    def box(left: float, upper: float, right: float, lower: float) -> list[float]:
        return [left * _SCALE, upper * _SCALE, right * _SCALE, lower * _SCALE]

    if name == "river":
        draw.ellipse(box(1240, 120, 1380, 260), fill=(255, 236, 170))  # the sun
        draw.polygon(
            s(
                [
                    (0, 620),
                    (400, 470),
                    (800, 600),
                    (1200, 450),
                    (1600, 590),
                    (1600, 1000),
                    (0, 1000),
                ]
            ),
            fill=(84, 150, 92),
        )
        draw.polygon(
            s([(0, 760), (1600, 700), (1600, 860), (0, 900)]), fill=(70, 140, 190)
        )  # the river
        for x in (180, 1350):  # coconut palms
            draw.line(s([(x, 720), (x + 30, 430)]), fill=(110, 80, 50), width=18 * _SCALE)
            for angle in range(0, 360, 60):
                end = (
                    x + 30 + 120 * math.cos(math.radians(angle)),
                    430 + 60 * math.sin(math.radians(angle)) + 20,
                )
                draw.line(s([(x + 30, 430), end]), fill=(56, 120, 60), width=22 * _SCALE)
        # A kampung house on its posts.
        for x in (620, 700, 860, 940):
            draw.rectangle(box(x, 600, x + 14, 700), fill=(110, 80, 50))
        draw.rectangle(box(600, 470, 980, 610), fill=(170, 120, 70))
        draw.polygon(s([(570, 480), (790, 330), (1010, 480)]), fill=(140, 60, 40))
        draw.rectangle(box(660, 510, 730, 570), fill=(70, 50, 40))
        draw.rectangle(box(850, 510, 920, 570), fill=(70, 50, 40))
    elif name == "station":
        draw.rectangle(box(0, 700, 1600, 1000), fill=(150, 140, 130))  # the platform
        draw.rectangle(box(0, 640, 1600, 700), fill=(110, 100, 96))  # the line
        draw.rectangle(box(160, 380, 900, 640), fill=(232, 220, 196))  # the station
        draw.polygon(s([(120, 390), (530, 250), (940, 390)]), fill=(150, 70, 50))
        for x in range(220, 860, 140):
            draw.rectangle(box(x, 450, x + 80, 560), fill=(90, 120, 140))
        draw.rectangle(box(980, 470, 1600, 650), fill=(200, 60, 50))  # the train
        for x in range(1020, 1600, 130):
            draw.rectangle(box(x, 500, x + 90, 560), fill=(230, 236, 240))
        draw.rectangle(box(980, 610, 1600, 630), fill=(60, 50, 50))
    elif name == "garden":
        draw.rectangle(box(0, 640, 1600, 1000), fill=(110, 170, 90))
        for x, colour in (
            (200, (230, 80, 90)),
            (420, (250, 200, 70)),
            (640, (240, 140, 180)),
            (980, (250, 120, 60)),
            (1220, (200, 90, 200)),
            (1440, (240, 230, 90)),
        ):
            draw.line(s([(x, 900), (x, 700)]), fill=(60, 120, 60), width=10 * _SCALE)
            for angle in range(0, 360, 72):
                cx, cy = (
                    x + 28 * math.cos(math.radians(angle)),
                    690 + 28 * math.sin(math.radians(angle)),
                )
                draw.ellipse(box(cx - 24, cy - 24, cx + 24, cy + 24), fill=colour)
            draw.ellipse(box(x - 16, 674, x + 16, 706), fill=(250, 230, 120))
        draw.ellipse(box(1260, 110, 1400, 250), fill=(255, 240, 180))
    else:  # a city across the sea, in the evening
        draw.rectangle(box(0, 720, 1600, 1000), fill=(40, 60, 110))
        x = 80
        for index in range(14):
            tall = 180 + (index * 97) % 300
            draw.rectangle(box(x, 720 - tall, x + 90, 720), fill=(36, 40, 70))
            for wy in range(720 - tall + 30, 700, 50):
                for wx in (x + 18, x + 52):
                    if (wx + wy) % 3:
                        draw.rectangle(box(wx, wy, wx + 18, wy + 22), fill=(250, 220, 140))
            x += 105
        draw.ellipse(box(1260, 140, 1360, 240), fill=(250, 240, 220))  # the moon

    out = io.BytesIO()
    canvas.resize(_WIDE, Image.Resampling.LANCZOS).save(out, "PNG")
    return out.getvalue()
