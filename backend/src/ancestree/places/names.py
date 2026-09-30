"""Place names as people write them, shared by the spreadsheet import
and the map: Malaysia's states and federal territories under the names the person form lists,
countries often written in Malay, and names reduced for comparing, so "Kg. Baru" and
"Kampung Baharu" are the same place."""

import re
import unicodedata

# The states and federal territories, as the person form lists them (lib/people.ts), with
# the other ways people write them. GeoNames and Natural Earth use some of these.
STATES: dict[str, tuple[str, ...]] = {
    "Johor": ("johore",),
    "Kedah": (),
    "Kelantan": (),
    "Melaka": ("malacca",),
    "Negeri Sembilan": ("n. sembilan", "n sembilan", "negri sembilan"),
    "Pahang": (),
    "Perak": (),
    "Perlis": (),
    "Pulau Pinang": ("penang", "p. pinang", "pinang"),
    "Sabah": (),
    "Sarawak": (),
    "Selangor": (),
    "Terengganu": ("trengganu",),
    "W.P. Kuala Lumpur": (
        "wp kuala lumpur",
        "w.p kuala lumpur",
        "wilayah persekutuan kuala lumpur",
        "kuala lumpur",
    ),
    "W.P. Labuan": ("wp labuan", "w.p labuan", "wilayah persekutuan labuan", "labuan"),
    "W.P. Putrajaya": (
        "wp putrajaya",
        "w.p putrajaya",
        "wilayah persekutuan putrajaya",
        "putrajaya",
    ),
}
_STATE_NAMES = {
    alias: state for state, aliases in STATES.items() for alias in (state.casefold(), *aliases)
}

# Countries often written on their own, or in Malay, under the English names the app uses.
COUNTRIES: dict[str, str] = {
    "malaysia": "Malaysia",
    "singapore": "Singapore",
    "singapura": "Singapore",
    "brunei": "Brunei",
    "brunei darussalam": "Brunei",
    "indonesia": "Indonesia",
    "thailand": "Thailand",
    "siam": "Thailand",
    "india": "India",
    "china": "China",
    "pakistan": "Pakistan",
    "bangladesh": "Bangladesh",
    "philippines": "Philippines",
    "filipina": "Philippines",
    "saudi arabia": "Saudi Arabia",
    "arab saudi": "Saudi Arabia",
    "egypt": "Egypt",
    "mesir": "Egypt",
    "yemen": "Yemen",
    "japan": "Japan",
    "jepun": "Japan",
    "united kingdom": "United Kingdom",
    "england": "United Kingdom",
    "uk": "United Kingdom",
    "australia": "Australia",
    "united states": "United States",
    "usa": "United States",
}


def state_named(text: str | None) -> str | None:
    """The Malaysian state a name stands for ("penang" is Pulau Pinang), or None."""
    return _STATE_NAMES.get(" ".join(text.split()).casefold()) if text else None


def country_named(text: str | None) -> str | None:
    """The English name of a country written in one of the usual ways, or None."""
    return COUNTRIES.get(" ".join(text.split()).casefold()) if text else None


# The usual abbreviations and spellings in Malaysian place names, each spelt one way.
_WORDS = {
    "kg": "kampung",
    "kpg": "kampung",
    "kampong": "kampung",
    "sg": "sungai",
    "sungei": "sungai",
    "bkt": "bukit",
    "tg": "tanjung",
    "tjg": "tanjung",
    "tanjong": "tanjung",
    "bt": "batu",
    "bdr": "bandar",
    "tmn": "taman",
    "seri": "sri",
    "pangkalan": "pengkalan",
    "bharu": "baru",
    "bahru": "baru",
    "baharu": "baru",
    "ayer": "air",
    "ulu": "hulu",
}


def place_key(text: str | None) -> str:
    """A place name reduced for comparing: no case, accents or punctuation, and the usual
    abbreviations and spellings made one ("Kg. Sg. Bharu" and "Kampung Sungai Baru")."""
    if not text:
        return ""
    plain = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in plain if not unicodedata.combining(c)).casefold()
    words = re.sub(r"[^\w]+", " ", plain).split()
    return " ".join(_WORDS.get(word, word) for word in words)
