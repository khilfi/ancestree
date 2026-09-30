"""Life stories."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

Source = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class Biography(BaseModel):
    story: str  # Markdown
    sources: list[str]  # where the information came from: "Birth certificate, 1938"
    version: str  # changes whenever the file does, in the app or outside it; "none": no file yet


class BiographyUpdate(BaseModel):
    story: str = Field(max_length=2_000_000)
    sources: list[Source] = Field(default_factory=list, max_length=500)
    base_version: str = Field(max_length=64)  # the version this edit started from


class PictureAdded(BaseModel):
    src: str  # as the story refers to it: "media/2026-09-27-4f3a9c.webp"
