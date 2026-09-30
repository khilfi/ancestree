"""Names as written in older files: tidying them, matching them, and what they say about gender."""

import re

from ancestree.domain.person import Gender

# "Ahmad bin Ismail", "Siti binti Ali": the word before the parent's name.
_SON_OF = frozenset({"bin", "b."})
_DAUGHTER_OF = frozenset({"binti", "bte", "bte.", "bt", "bt."})
_PARTICLES = _SON_OF | _DAUGHTER_OF | {"al", "a/l", "a/p", "@"}
_MALE_TITLES = frozenset({"haji", "hj", "hj."})
_FEMALE_TITLES = frozenset({"hajah", "hjh", "hjh."})
_APOSTROPHES = str.maketrans(dict.fromkeys("`‘’´", "'"))  # noqa: RUF001
_BRACKETED = re.compile(r"\(([^()]*)\)")


def clean_spaces(text: str) -> str:
    return " ".join(text.split())


def match_key(name: str) -> str:
    """How names are compared: case, spacing, apostrophes, brackets and * don't count."""
    text = _BRACKETED.sub(" ", name.translate(_APOSTROPHES)).replace("*", " ")
    return clean_spaces(text).casefold()


def split_nickname(text: str) -> tuple[str, str | None]:
    """ "Abdul Karim (Tok Kerim)" -> ("Abdul Karim", "Tok Kerim")."""
    nickname = None
    if match := _BRACKETED.search(text):
        nickname = clean_spaces(match[1]) or None
    return clean_spaces(_BRACKETED.sub(" ", text)), nickname


def with_apostrophes(name: str) -> str:
    """ "Na`imah" -> "Na'imah": a backtick typed where an apostrophe was meant."""
    return name.translate(_APOSTROPHES)


def tidy_capitals(name: str) -> str:
    """ "Mohd hafiz bin ismail" -> "Mohd Hafiz bin Ismail".

    Only words typed all in lower case change; bin, binti and other particles stay as written.
    """
    words = []
    for word in name.split(" "):
        if word.islower() and word[:1].isalpha() and word.casefold() not in _PARTICLES:
            word = word[:1].upper() + word[1:]
        words.append(word)
    return " ".join(words)


def gender_from_name(name: str) -> Gender | None:
    """ "bin" means a son, "binti" a daughter; a leading Haji or Hajah says the same."""
    words = [word.casefold() for word in name.split()]
    for word in words[1:]:
        if word in _SON_OF:
            return Gender.MALE
        if word in _DAUGHTER_OF:
            return Gender.FEMALE
    if words and words[0] in _MALE_TITLES:
        return Gender.MALE
    if words and words[0] in _FEMALE_TITLES:
        return Gender.FEMALE
    return None
