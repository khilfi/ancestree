"""Putting relationships into words, from a word list per language.

`terms/en.yaml`, `ms.yaml` and `jv.yaml` have the same keys, which describe structure, never
English: see the top of en.yaml. Where a language has no word, `term` says the relation in
pieces, as that language would; a blank word is never guessed.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Any

import yaml

from ancestree.domain.kinship import Language
from ancestree.domain.person import Gender
from ancestree.domain.relationship import RelationshipKind
from ancestree.kinship.blood import Place
from ancestree.kinship.kin import Blood, Chain, Compound, Kin, KindSibling, KindStep, Spouse

MAX_CHAIN = 6  # longer than this, a chain of relations stops being an answer
LANGUAGES: tuple[Language, ...] = ("en", "ms", "jv")
_KINDS_FROM_SETTINGS = "settings"
_VOWELS = frozenset("aeiouéèåAEIOUÉÈÅ")


@dataclass(frozen=True)
class Titles:
    """Birth-order titles, e.g. Malay long, ngah, lang … su: the title for each place
    among brothers and sisters, and one for the youngest."""

    places: tuple[str, ...] = ()
    youngest: str = ""

    def title(self, place: Place) -> str | None:
        if place.youngest and self.youngest:
            return self.youngest
        if place.number <= len(self.places) and self.places[place.number - 1]:
            return self.places[place.number - 1]
        return None


class TermBook:
    def __init__(
        self, data: Mapping[str, Any], code: str = "en", titles: Titles | None = None
    ) -> None:
        self.data = data
        self.code = code  # "en", "ms", "jv"
        self.language = str(data.get("language") or "")
        if titles is None:
            defaults = _mapping(data.get("titles"))
            titles = Titles(
                tuple(str(t) for t in defaults.get("places") or ()),
                _text(defaults.get("youngest")),
            )
        self.titles = titles

    @classmethod
    def load(cls, language: str) -> TermBook:
        return _load(language)

    def with_titles(self, titles: Titles) -> TermBook:
        """The same words with a family's own birth-order titles (Settings, D14)."""
        return TermBook(self.data, self.code, titles)

    def for_twin(self) -> dict[str, Any]:
        """The list as a view-only copy's kinship engine reads it: its words and
        grammar, and the titles in use. What only the dictionary shows stays behind."""
        return {
            "code": self.code,
            "data": {key: value for key, value in self.data.items() if key != "dictionary"},
            "titles": {"places": list(self.titles.places), "youngest": self.titles.youngest},
        }

    def dictionary_notes(self, row: str) -> Mapping[str, Any]:
        """What only the Kinship dictionary shows for a row: other words, notes."""
        return _mapping(self._section("dictionary").get(row))

    def has_word(self, kin: Kin) -> bool:
        """Whether the language has a word for it, rather than saying it in pieces."""
        match kin:
            case Blood():
                return self.blood(kin) is not None
            case Compound(key=key, group=group, gender=gender):
                entry = self._section(group).get(key)
                return self._pick_detailed(entry, gender, kin.seniority, kin.place)[0] is not None
            case Chain():
                return False
            case _:
                return True

    # --- Whole answers ---------------------------------------------------------------------

    def sentence(self, b: str, a: str, term: str | None) -> str | None:
        """ "Siti is Ali's aunt"; None when this language can't say it yet."""
        if not term:
            return None
        return _fill(self._grammar("sentence"), b=b, a=a, term=term)

    def term(self, kin: Kin, kinds: Mapping[str, RelationshipKind]) -> str | None:
        match kin:
            case Blood(parts=parts):
                # No word for it (a parent's cousin, in Malay): say it in its two pieces.
                return self.blood(kin) or (self.chain(parts, kinds) if parts else None)
            case Spouse(gender=gender, former=former):
                word = _pick(self._section("marriage").get("="), gender)
                return self._former(word) if former else word
            case KindStep(kind=kind, upward=upward, gender=gender):
                return self._kind_word(kinds, kind, "parent" if upward else "child", gender)
            case KindSibling():
                return self._kind_sibling(kin, kinds)
            case Compound(key=key, group=group, gender=gender, former=former, parts=parts):
                word, _ = self._pick_detailed(
                    self._section(group).get(key), gender, kin.seniority, kin.place
                )
                if word:
                    return self._former(word) if former else word
                return self.chain(parts, kinds)  # no single word for it: say it in pieces
            case Chain(parts=parts):
                return self.chain(parts, kinds)

    # --- Blood -----------------------------------------------------------------------------

    def blood(self, kin: Blood) -> str | None:
        up, down = kin.up, kin.down
        entry = self._section("blood").get(f"{up},{down}")
        said_seniority = False
        if entry is not None:
            word, said_seniority = self._pick_detailed(entry, kin.gender, kin.seniority, kin.place)
        else:
            word = self._blood_pattern(up, down, kin.gender)
        if not word:
            return None
        if up == down == 1:
            if kin.half:
                # "Half-brother"; a language may say which parent is shared (half_paternal).
                names = (f"half_{kin.side}", "half") if kin.side else ("half",)
                word = self._compose(*names, term=word)
            if kin.seniority and not said_seniority:
                word = self._compose("seniority", term=word, seniority=self._word(kin.seniority))
        if down == 0 and up >= 2 and kin.side:
            word = self._compose("side", term=word, side=self._word(kin.side))
        return word

    def _blood_pattern(self, up: int, down: int, gender: Gender) -> str | None:
        patterns = self._section("patterns")
        unknown = Gender.UNKNOWN
        if down == 0 and up >= 4:
            return _fill(_pick(patterns.get("ancestor"), gender), nth=self._nth(up - 2))
        if up == 0 and down >= 4:
            return _fill(_pick(patterns.get("descendant"), gender), nth=self._nth(down - 2))
        if down == 1 and up >= 4:
            return _fill(
                _pick(patterns.get("uncle"), gender),
                nth=self._nth(up - 2),
                ancestor=self.blood(Blood(up - 1, 0, unknown)),
            )
        if up == 1 and down >= 5:
            return _fill(
                _pick(patterns.get("nephew"), gender),
                nth=self._nth(down - 3),
                descendant=self.blood(Blood(0, down - 1, unknown)),
            )
        if up >= 2 and down >= 2:
            cousin = _fill(
                _text(patterns.get("cousin")),
                degree=self._listed("degrees", min(up, down) - 1),
            )
            if up == down:
                return cousin
            return _fill(
                _text(patterns.get("removed")),
                cousin=cousin,
                times=self._listed("times", abs(up - down)),
            )
        return None

    # --- Other kinds of link -------------------------------------------------------------

    def _kind_word(
        self, kinds: Mapping[str, RelationshipKind], kind: str, side: str, gender: Gender
    ) -> str | None:
        """ "adoptive father", "foster daughter", "bapa angkat": the words set in Settings,
        in this language where the kind has them, otherwise its English ones."""
        if self.data.get("kinds") == _KINDS_FROM_SETTINGS:
            definition = kinds.get(kind)
            if definition is None:
                return None
            words = definition.words.get(self.code)
            said = words or definition
            label = said.parent_label if side == "parent" else said.child_label
            return label.for_gender(gender)
        return _pick(_mapping(self._section("kinds").get(kind)).get(side), gender)

    def _kind_sibling(self, kin: KindSibling, kinds: Mapping[str, RelationshipKind]) -> str | None:
        if self.data.get("kinds") == _KINDS_FROM_SETTINGS:
            definition = kinds.get(kin.kind)
            sibling, said = self._pick_detailed(
                self._section("blood").get("1,1"), kin.gender, kin.seniority, None
            )
            if definition is None or not sibling:
                return None
            words = definition.words.get(self.code)
            adjective = words.label if words else definition.label.lower()
            word = self._compose("kind", kind=adjective, term=sibling)
        else:
            entry = _mapping(self._section("kinds").get(kin.kind)).get("sibling")
            word, said = self._pick_detailed(entry, kin.gender, kin.seniority, None)
            if not word:
                return None
        if kin.seniority and not said:
            word = self._compose("seniority", term=word, seniority=self._word(kin.seniority))
        return word

    def chain(self, parts: Sequence[Kin], kinds: Mapping[str, RelationshipKind]) -> str | None:
        """ "wife's sister's husband": each part said from the one before it. Malay puts the
        owner last (adik lelaki ibu tiri); Javanese also marks what is owned (adhiné)."""
        if len(parts) > MAX_CHAIN:
            return self._grammar("distant") or None
        words = [self.term(part, kinds) for part in parts]
        if not words or not all(words):
            return None
        said = words[0]
        for word in words[1:]:
            said = _fill(self._grammar("possessive"), owner=said, thing=self._owned(word))
        return said

    def _owned(self, word: str | None) -> str | None:
        """Javanese adds -é to what is owned, or -né after a vowel: bapaké, adhiné.
        Each of two alternatives gets it: "pakdhéné / pakliké"."""
        suffix = _mapping(self._grammar_entry("possessive_suffix"))
        if not word or not suffix:
            return word
        after_vowel, after_consonant = (
            _text(suffix.get("after_vowel")),
            _text(suffix.get("after_consonant")),
        )
        return " / ".join(
            alternative + (after_vowel if alternative[-1] in _VOWELS else after_consonant)
            for alternative in word.split(" / ")
        )

    # --- Grammar and words -----------------------------------------------------------------

    def _section(self, name: str) -> Mapping[str, Any]:
        return _mapping(self.data.get(name))

    def _grammar(self, name: str) -> str:
        return _text(self._section("grammar").get(name))

    def _grammar_entry(self, name: str) -> object:
        return self._section("grammar").get(name)

    def _pick_detailed(
        self, entry: object, gender: Gender, seniority: str | None, place: Place | None
    ) -> tuple[str | None, bool]:
        """The most specific word an entry has, and whether it already says elder or
        younger. Birth-order words come first (an eldest uncle: pak long), then seniority
        (pakdhé, abang), then gender."""
        if isinstance(entry, Mapping):
            if place is not None and (
                word := self._by_place(entry.get("by_birth_order"), place, gender)
            ):
                return word, False
            if word := _by(entry.get("by_seniority"), seniority, gender):
                return word, True
        return _pick(entry, gender), False

    def _by_place(self, table: object, place: Place, gender: Gender) -> str | None:
        """A word by B's place: named ("eldest", "third", "youngest"), then a title template
        such as "pak {title}" with the family's titles, then "other"."""
        if not isinstance(table, Mapping):
            return None
        *named, other = place.keys()
        for key in named:
            if word := _by(table, key, gender):
                return word
        titled = table.get("titled")
        if titled is not None and (title := self.titles.title(place)):
            return _fill(_pick(titled, gender), title=title)
        return _by(table, other, gender)

    def _word(self, name: str) -> str | None:
        return _text(self._section("words").get(name)) or None

    def _compose(self, *templates: str, **values: str | None) -> str | None:
        """Add a qualifier ("elder", "maternal", "former") with the first of `templates` the
        language has; without one, the bare term is still true, just less precise."""
        term = values.get("term")
        for name in templates:
            if template := self._grammar(name):
                return _fill(template, **values) or term
        return term

    def _former(self, word: str | None) -> str | None:
        return self._compose("former", term=word) if word else None

    def _nth(self, number: int) -> str | None:
        """ "2nd", "3rd": the numbering in "2nd great-grandfather"."""
        style = self._grammar("nth")
        if style == "english":
            return _english_ordinal(number)
        return _fill(style, n=str(number))

    def _listed(self, name: str, number: int) -> str | None:
        """ "first", "second" (cousins); "once", "twice" (removed). Beyond the list: 11th."""
        words = self._section("patterns").get(name)
        if isinstance(words, list) and 0 < number <= len(words) and words[number - 1]:
            return str(words[number - 1])
        overflow = _text(self._section("patterns").get(f"{name}_beyond"))
        return _fill(overflow, n=str(number), nth=self._nth(number))


@cache
def _load(language: str) -> TermBook:
    text = (
        resources.files("ancestree.kinship").joinpath(f"terms/{language}.yaml").read_text("utf-8")
    )
    return TermBook(yaml.safe_load(text) or {}, language)


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def _fill(template: str | None, **values: str | None) -> str | None:
    """A template with its blanks filled; None if it's blank or a value it needs is missing."""
    if not template:
        return None
    if any(f"{{{name}}}" in template and not value for name, value in values.items()):
        return None
    try:
        return template.format(**{name: value or "" for name, value in values.items()})
    except KeyError, IndexError, ValueError:
        return None


def _gendered(entry: Mapping[str, Any], gender: Gender) -> str | None:
    """The word for this gender; "any" suits everyone; "unknown" is the neutral word."""
    for key in (gender.value, "any", "unknown"):
        value = entry.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _pick(entry: object, gender: Gender) -> str | None:
    if isinstance(entry, str):
        return entry or None
    return _gendered(entry, gender) if isinstance(entry, Mapping) else None


def _by(table: object, key: str | None, gender: Gender) -> str | None:
    """A word chosen by seniority or birth order: {elder: ...} or {male: {elder: ...}}."""
    if not key or not isinstance(table, Mapping):
        return None
    value = table.get(key)
    if isinstance(value, str):
        return value or None
    if isinstance(value, Mapping):
        return _gendered(value, gender)
    by_gender = table.get(gender.value)
    if isinstance(by_gender, Mapping):
        return _text(by_gender.get(key)) or None
    return None


def _english_ordinal(number: int) -> str:
    if 10 <= number % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"
