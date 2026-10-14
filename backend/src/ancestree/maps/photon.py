"""Looking an address up online, once: Photon, komoot's
search of OpenStreetMap, asked for one address the person chose to look up, and never as it's
typed. Nominatim isn't used: its policy asks that no personal data be sent to it.

The engine asks, so the pages still reach nothing outside this computer. What Photon learns is
the line as typed, with its country, and this computer's internet address: nothing else of the
family. What it finds is a place to check, never a final answer: the person chooses one, and
sees it on the small map."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.client import HTTPException
from typing import Any

from ancestree import __version__
from ancestree.domain.person import Exactness

MOST = 5  # places Photon is asked for
MOST_BYTES = 1 << 20  # an answer's, at most: a few KB as it is


class PhotonError(Exception):
    """Photon couldn't be reached, or didn't answer as it does."""


@dataclass(frozen=True)
class Found:
    """A place Photon found: its parts as OpenStreetMap has them, where it is, and how exactly:
    a house, a street, a postcode or a town."""

    address: str  # "12 Jalan Melati 3", or ""
    town: str
    district: str
    state: str
    postcode: str
    country: str  # its ISO code in capitals: "MY"
    lat: float
    lon: float
    exact: Exactness


def query(line: str, country: str) -> str:
    """What's sent: the line as typed, with its country unless the line names it. Compared in
    small letters as the page compares them, so what it shows is what goes (0.8.0)."""
    named = country.strip() and country.strip().lower() not in line.lower()
    return f"{line.strip()}, {country.strip()}" if named else line.strip()


class _Unredirected(urllib.request.HTTPRedirectHandler):
    """Photon answers where it's asked, or not at all (0.8.0): sent on elsewhere, the address
    would go there too, perhaps unencrypted. A redirect is an error of Photon's instead."""

    def redirect_request(self, *_: object) -> None:
        return None


_OPENER = urllib.request.build_opener(_Unredirected)


def look_up(url: str, line: str, country: str) -> list[Found]:
    """Ask Photon at `url` for this address, once: the places it finds, best first."""
    asked = urllib.parse.urlencode({"q": query(line, country), "limit": MOST, "lang": "en"})
    headers = {"User-Agent": f"AncesTree/{__version__}", "Accept": "application/json"}
    request = urllib.request.Request(f"{url}?{asked}", headers=headers)  # noqa: S310
    try:
        with _OPENER.open(request, timeout=15) as response:
            body: bytes = response.read(MOST_BYTES + 1)
    except urllib.error.HTTPError as error:
        raise PhotonError(f"Photon answered {error.code} ({error.reason})") from error
    except (OSError, HTTPException) as error:  # no internet, or cut off
        raise PhotonError("Photon couldn't be reached: no internet, or it's down") from error
    if len(body) > MOST_BYTES:
        raise PhotonError("Photon sent more than places")
    try:
        answer = json.loads(body)
    except (ValueError, RecursionError) as error:  # nested too deep to read, too
        raise PhotonError("Photon's answer couldn't be read") from error
    features = answer.get("features") if isinstance(answer, dict) else None
    if not isinstance(features, list):
        raise PhotonError("Photon's answer couldn't be read")
    return [found for feature in features if (found := _found(feature)) is not None][:MOST]


def _text(properties: dict[str, Any], *names: str) -> str:
    for name in names:
        value = properties.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()[:100]
    return ""


def _found(feature: object) -> Found | None:
    """A place from Photon's answer, or None for one that isn't as Photon writes them."""
    if not isinstance(feature, dict):
        return None
    geometry, properties = feature.get("geometry"), feature.get("properties")
    if not isinstance(geometry, dict) or not isinstance(properties, dict):
        return None
    point = geometry.get("coordinates")
    if not (isinstance(point, list) and len(point) == 2):
        return None
    lon, lat = point
    if not all(isinstance(each, int | float) and not isinstance(each, bool) for each in point):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    number, street = _text(properties, "housenumber"), _text(properties, "street")
    kind = _text(properties, "type")
    exact: Exactness
    if number and street:
        address, exact = f"{number} {street}", "spot"
    elif kind == "house":
        address, exact = _text(properties, "name"), "spot"
    elif street or kind == "street":
        address, exact = street or _text(properties, "name"), "street"
    else:
        address, exact = "", "postcode" if kind == "postcode" else "town"
    town = _text(properties, "city", "town", "village", "locality")
    if not town and kind in ("city", "town", "village", "locality"):
        town = _text(properties, "name")
    return Found(
        address=address[:300],
        town=town,
        district=_text(properties, "county", "district"),
        state=_text(properties, "state"),
        postcode=_text(properties, "postcode")[:20],
        country=_text(properties, "countrycode").upper(),
        lat=round(float(lat), 6),
        lon=round(float(lon), 6),
        exact=exact,
    )
