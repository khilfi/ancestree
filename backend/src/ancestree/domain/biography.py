"""Life stories."""

from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints


def lines_ended(text: str) -> str:
    """Every line ended with a newline alone, as a story is read back from its file: a carriage
    return alone ends a line there too. So a story is checked as it will be read, never as one
    thing then read as another (0.8.0)."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


Source = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Text = Annotated[str, AfterValidator(lines_ended)]  # a story's text, its lines ended as read

# The parts of a life story beyond the story itself, in their order, each kept under
# its own heading in biography.md, after the story and before the Sources.
PartKey = Literal[
    "accomplishments",
    "early",
    "middle",
    "later",
    "character",
    "sayings",
    "message",
    "values",
    "hobbies",
    "talents",
    "notes",
]
PARTS: dict[PartKey, str] = {
    "accomplishments": "Notable accomplishments",
    "early": "Early life",
    "middle": "Middle life",
    "later": "Later life",
    "character": "Character and mannerisms",
    "sayings": "Sayings and quotes",
    "message": "A message to the next generations",
    "values": "Life values kept for life",
    "hobbies": "Hobbies",
    "talents": "Hidden talents",
    "notes": "Free notes",
}
Part = Annotated[Text, StringConstraints(max_length=200_000)]


class Said(BaseModel):
    """What someone says about them: their own words, kept in biography.md under
    "What people say", each with who wrote them and when."""

    id: str  # 8 hex characters, kept beside the words in the file
    text: str  # their words, as written: a line or more
    writer: str  # their Me's name, or their computer's name if they hadn't chosen one
    # The computer they were written on: only it changes them or takes them back, and the
    # keeper may take them out. None: the keeper's, written before the family folder or by hand.
    device: str | None = None
    written: date | None = None
    changed: date | None = None
    yours: bool = False  # written on this computer, so it may change them: as the API reads it
    # Written on another computer: its name, as the family knows it, shown beside the writer's,
    # so no computer passes its words off as someone else's (0.8.0, your answer of 14 Oct
    # 2026). As the API reads it, and a copy has it.
    computer: str | None = None


class Biography(BaseModel):
    story: str  # Markdown: their story itself, before any part
    # Each part filled in, as Markdown: a list part ("accomplishments", "sayings",
    # "values", "hobbies", "talents") as a list, one item a line.
    parts: dict[PartKey, str] = Field(default_factory=dict)
    said: list[Said] = Field(default_factory=list)  # what people say about them, in order
    sources: list[str]  # where the information came from: "Birth certificate, 1938"
    # Changes whenever the file does, in the app or outside it, but not with what people say,
    # which is kept as it is when the story is saved; "none": no file yet.
    version: str


class BiographyUpdate(BaseModel):
    story: Text = Field(max_length=2_000_000)
    parts: dict[PartKey, Part] = Field(default_factory=dict)
    sources: list[Source] = Field(default_factory=list, max_length=500)
    base_version: str = Field(max_length=64)  # the version this edit started from


class SaidWords(BaseModel):
    """Someone's words about them, written or changed."""

    text: Text = Field(min_length=1, max_length=20_000)


class PictureAdded(BaseModel):
    src: str  # as the story refers to it: "media/2026-09-27-4f3a9c.webp"
