"""The relationship finder's answers."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

from ancestree.domain.person import Gender


class KinPerson(BaseModel):
    """Someone an answer mentions: the two people, or anyone on the path between them."""

    id: UUID
    name: str  # as the answers say it: "Tok Ismail", "Siti"
    full_name: str
    gender: Gender
    photo_version: int | None
    placeholder: bool


type Language = Literal["en", "ms", "jv"]


def _default_titles() -> list[str]:
    return ["long", "ngah", "lang"]


class KinshipSettings(BaseModel):
    """The kinship language and the Malay birth-order titles. Stored in
    DATA_DIR/settings/app.json under "kinship"."""

    language: Language = "en"
    titles: list[Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]] = Field(
        default_factory=_default_titles, max_length=12
    )
    youngest: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)] = "su"


class KinWord(BaseModel):
    """A statement in one kinship language: its word, and the sentence with it, which
    stays English: "Siti is Ali's mak su"."""

    term: str  # "mak su"
    sentence: str  # "Siti is Ali's mak su"
    english: bool = False  # the language has no word for it: the English one stands in


class KinStatement(BaseModel):
    term: str  # "first cousin once removed"
    sentence: str  # "Siti is Ali's first cousin once removed"
    detail: str | None = None  # "his mother's first cousin; one generation above him"
    words: dict[Language, KinWord] = Field(default_factory=dict)  # every language
    entry: str | None = None  # the Kinship dictionary row it belongs to


class DictionaryWord(BaseModel):
    """One language's words for a row of the Kinship dictionary."""

    word: str | None  # what the answers say; None: the language has no word for it
    descr: bool = False  # a description rather than an established word
    also: list[str] = Field(default_factory=list)  # formal, everyday, older, regional words
    address: list[str] = Field(default_factory=list)  # what you call them to their face
    krama: str | None = None  # Javanese polite level
    krama_inggil: str | None = None  # Javanese honorific level
    note: str | None = None


class DictionaryRow(BaseModel):
    id: str
    relation: str  # "A parent's older brother"
    words: dict[Language, DictionaryWord]


class DictionarySection(BaseModel):
    id: str
    title: str
    rows: list[DictionaryRow]


class KinshipLanguage(BaseModel):
    code: Language
    name: str  # "Bahasa Melayu"


class KinshipDictionary(BaseModel):
    languages: list[KinshipLanguage]
    sections: list[DictionarySection]


class KinExplanation(BaseModel):
    """ "What does this mean?": the answer told with the people on the path, in
    English like the rest of the app."""

    sentences: list[str]  # "Ali and Nadia are second cousins: they share great-grandparents, …"
    # Blood relatives, for the ladder: the index in `path` of the shared ancestor where the two
    # lines meet; the two at the same generation ("second cousins"); and the rest ("once
    # removed").
    top: int | None = None
    pair: str | None = None
    removed: str | None = None
    rule: str | None = None  # how the words work: cousins are counted by shared ancestors


class KinRelation(BaseModel):
    """One way the two are related."""

    type: Literal["marriage", "blood", "in_law", "step", "kind", "chain"]
    forward: KinStatement  # the second person, as seen from the first
    reverse: KinStatement  # the first, as seen from the second
    generations: int  # how many generations above the first the second is; below: negative
    shared_ancestors: list[UUID]  # blood relatives: the nearest shared ancestors
    path: list[UUID]  # everyone from the first person to the second
    links: list[UUID]  # the links along the path, to highlight
    explanation: KinExplanation | None = None  # M10


class KinshipAnswer(BaseModel):
    a: UUID
    b: UUID
    relations: list[KinRelation]  # closest first; the rest are "Also related as..."
    people: list[KinPerson]  # the two, plus everyone on the paths
    message: str | None = None  # when there's no answer: "No recorded link between..."
