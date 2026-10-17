"""Reading one spreadsheet cell the way the person form reads it.

Each reader returns the value, or raises CellError with a sentence saying why the value was
left out. Nothing is guessed: a gender comes only from the Gender column, never from a name
or from "(father)".
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass

from annotated_types import MaxLen
from pydantic import ValidationError

from ancestree.domain.dates import DateParseError, parse_partial_date
from ancestree.domain.person import Gender, PartialDate, Place
from ancestree.domain.relationship import BIOLOGICAL, RelationshipKind, SpouseStatus
from ancestree.domain.requests import PersonInput
from ancestree.places.names import country_named, state_named


class CellError(ValueError):
    """A value that can't be read; the message says why, for the preview and the report."""


def limit(field: str) -> int:
    """The person form's length limit for a field, so an import can't store more."""
    for item in PersonInput.model_fields[field].metadata:
        if isinstance(item, MaxLen):
            return item.max_length
    raise KeyError(field)


def read_text(text: str, field: str, *, lines: bool = False) -> str | None:
    """Text as written; spaces tidied, unless it may hold lines (notes). Empty: None."""
    value = text.strip() if lines else " ".join(text.split())
    if not value:
        return None
    most = limit(field)
    if len(value) > most:
        raise CellError(f"Longer than the {most} characters the app keeps.")
    return value


_GENDERS = {
    **dict.fromkeys(("male", "m", "man", "lelaki", "l", "laki-laki"), Gender.MALE),
    **dict.fromkeys(("female", "f", "woman", "perempuan", "p", "wanita"), Gender.FEMALE),
    "unknown": Gender.UNKNOWN,
}


def read_gender(text: str) -> Gender:
    value = " ".join(text.split()).casefold()
    if not value:
        return Gender.UNKNOWN
    if value not in _GENDERS:
        raise CellError("Use Male or Female, or leave it empty.")
    return _GENDERS[value]


_YES = frozenset({"yes", "y", "ya", "true", "1"})
_NO = frozenset({"no", "n", "tidak", "false", "0"})


def read_living(text: str) -> bool | None:
    value = " ".join(text.split()).casefold()
    if not value:
        return None
    if value in _YES:
        return True
    if value in _NO:
        return False
    raise CellError("Use yes or no, or leave it empty to work it out from the dates.")


_REMOVE = _YES | {"x", "remove", "buang"}


def read_remove(text: str) -> bool:
    """Remove: yes, x or remove marks someone to take out of the tree; empty or no
    leaves them in."""
    value = " ".join(text.split()).casefold()
    if not value or value in _NO:
        return False
    if value in _REMOVE:
        return True
    raise CellError("Use yes to take them out of the tree, or leave it empty.")


def read_date(text: str) -> PartialDate | None:
    """A date as typed anywhere in the app. When it can't be read, the caller keeps the text
    as the date's `original_text`, so What's missing can show what was written."""
    try:
        return parse_partial_date(text)
    except DateParseError as error:
        raise CellError(str(error)) from error


def written_date(text: str) -> PartialDate:
    """A date that couldn't be read: nothing but what was written."""
    return PartialDate(original_text=" ".join(text.split())[:200])


def read_place(text: str) -> Place | None:
    """ "Town, state", with the country last when it isn't Malaysia: "Kota Bharu, Kelantan",
    "Jakarta, Indonesia", or the export's "Kota Bharu, Kelantan, Malaysia". A country written
    on its own ("Singapore") isn't taken for a town in Malaysia; with a town before it, the
    last part is taken as the country anyway."""
    parts = [" ".join(part.split()) for part in text.split(",")]
    parts = [part for part in parts if part]
    if not parts:
        return None
    country, state = "Malaysia", None
    if len(parts) == 1 and (alone := country_named(parts[0])) is not None:
        country = alone
        parts.pop()
    elif (named := state_named(parts[-1])) is not None:
        state = named
        parts.pop()
    elif parts[-1].casefold() == "malaysia":
        parts.pop()
        if parts and (named := state_named(parts[-1])) is not None:
            state = named
            parts.pop()
    elif len(parts) >= 2:
        country = country_named(parts[-1]) or parts[-1]
        parts.pop()
        if len(parts) >= 2:
            state = parts.pop()  # a region abroad: "Medan, Sumatera Utara, Indonesia"
    try:
        place = Place(town=", ".join(parts) or None, state=state, country=country)
    except ValidationError as error:
        raise CellError("Too long for a place: 100 characters at most in each part.") from error
    return None if place.is_empty else place


# A location as a phone's map gives it: Google Maps' "3.139003, 101.686855", Apple Maps'
# "3.13900° N, 101.68686° E", or degrees, minutes and seconds, "3°08'20.4"N 101°41'12.7"E".
_NUMBER = r"[+-]?\d{1,3}(?:\.\d+)?"
_DECIMAL = re.compile(
    rf"^(?P<lat>{_NUMBER})\s*°?\s*(?P<ns>[NS])?\s*[,;\s]\s*"
    rf"(?P<lon>{_NUMBER})\s*°?\s*(?P<ew>[EW])?$",
    re.IGNORECASE,
)
# Minutes after ' or a prime (U+2032), seconds before " or a double prime (U+2033).
_DMS_ONE = (
    r"(\d{1,3})\s*°\s*(\d{1,2})\s*['\N{PRIME}]\s*"
    r"(\d{1,2}(?:\.\d+)?)\s*(?:\"|\N{DOUBLE PRIME}|'')?\s*"
)
_DMS = re.compile(rf"^{_DMS_ONE}(?P<ns>[NS])\s*,?\s*{_DMS_ONE}(?P<ew>[EW])$", re.IGNORECASE)


def read_location(text: str) -> tuple[float, float]:
    """Where they live, as a phone's map gives it: latitude and longitude. One read from a
    spreadsheet counts as placed by hand, so they're a pin."""
    written = " ".join(text.split())
    if found := _DECIMAL.match(written):
        lat, lon = float(found["lat"]), float(found["lon"])
        if (found["ns"] or "").upper() == "S":
            lat = -abs(lat)
        if (found["ew"] or "").upper() == "W":
            lon = -abs(lon)
    elif found := _DMS.match(written):
        d1, m1, s1, d2, m2, s2 = (float(found[i]) for i in (1, 2, 3, 5, 6, 7))
        lat = (d1 + m1 / 60 + s1 / 3600) * (-1 if found["ns"].upper() == "S" else 1)
        lon = (d2 + m2 / 60 + s2 / 3600) * (-1 if found["ew"].upper() == "W" else 1)
    else:
        raise CellError(
            "Not a location: write it as a phone's map gives it, such as 3.139003, 101.686855."
        )
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise CellError("Not a place on Earth: the latitude comes first, then the longitude.")
    return round(lat, 6), round(lon, 6)


@dataclass(frozen=True)
class Mention:
    """Someone named in Parents, Spouses or Children: an ID or a name, and the word in
    brackets after it, if any: "Ismail bin Ahmad (adoptive)"."""

    who: str
    label: str | None = None

    @property
    def written(self) -> str:
        return f"{self.who} ({self.label})" if self.label else self.who


_LABELLED = re.compile(r"^(?P<who>.*?)\s*\((?P<label>[^()]*)\)$")


def read_mentions(text: str) -> list[Mention]:
    """People separated by semicolons (or commas, or lines), each maybe with a label."""
    mentions = []
    for part in re.split(r"[;,\n]", text):
        cleaned = " ".join(part.split())
        if not cleaned:
            continue
        match = _LABELLED.match(cleaned)
        if match and match["who"]:
            mentions.append(Mention(match["who"], " ".join(match["label"].split()) or None))
        else:
            mentions.append(Mention(cleaned))
    return mentions


def _words(kind: RelationshipKind, side: str) -> set[str]:
    """Every word a kind goes by on one side ("parent" or "child"), in every language."""
    labels = [getattr(kind, f"{side}_label")]
    labels += [getattr(words, f"{side}_label") for words in kind.words.values()]
    names = {kind.key, kind.label, *(words.label for words in kind.words.values())}
    for label in labels:
        names |= {label.neutral, label.male or "", label.female or ""}
    return {" ".join(name.split()).casefold() for name in names if name}


# Words for birth links that the kinds' own labels may not hold: the export writes
# "(father)" and "(mother)", and people add "birth" or Malay words.
_BIRTH = {
    "parent": frozenset({"birth", "birth parent", "bapa", "ayah", "abah", "emak", "mak", "ibu"}),
    "child": frozenset({"birth", "anak", "anak kandung"}),
}


def link_kind(label: str | None, kinds: Mapping[str, RelationshipKind], side: str) -> str:
    """The kind of parent link a label names, from a parent's side ("(adoptive father)") or a
    child's ("(adopted son)"). No label: a birth link."""
    if label is None:
        return BIOLOGICAL
    word = " ".join(label.split()).casefold()
    if word in _BIRTH[side]:
        return BIOLOGICAL
    for key, kind in kinds.items():
        if word in _words(kind, side):
            return key
    which = "parent" if side == "parent" else "child"
    raise CellError(
        f"'{label}' isn't a kind of {which}: use one in Settings → Kinship → Relationship kinds, "
        "such as adoptive, or no word for a birth link."
    )


_SPOUSE_WORDS = {
    SpouseStatus.MARRIED: frozenset(
        {"wife", "husband", "spouse", "married", "isteri", "istri", "suami"}
    ),
    SpouseStatus.DIVORCED: frozenset(
        {
            "former",
            "former wife",
            "former husband",
            "former spouse",
            "divorced",
            "ex",
            "ex-wife",
            "ex-husband",
            "bekas",
            "bekas isteri",
            "bekas suami",
            "cerai",
            "bercerai",
        }
    ),
    SpouseStatus.WIDOWED: frozenset({"widowed", "widow", "widower"}),
}


def spouse_status(label: str | None) -> SpouseStatus:
    """(former) for a divorce; (widowed) for a marriage ended by a death. No label: married."""
    if label is None:
        return SpouseStatus.MARRIED
    word = " ".join(label.split()).casefold()
    for status, words in _SPOUSE_WORDS.items():
        if word in words:
            return status
    raise CellError(f"'{label}' isn't said of a spouse: use (former) for a divorce, or no word.")
