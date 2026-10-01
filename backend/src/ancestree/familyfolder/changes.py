"""A relative's changes, as the family folder carries them.

A relative's computer changes the family as the keeper's does, in its own database. What it
changed is kept as the difference between its family and the family it last received, so
whatever the keeper publishes next can come in beneath it: `rebased`, field by field for
people. Once the keeper has answered, what was answered goes, and only what came after stays.

What it sends the keeper is its whole family, as a copy to edit carries it (exchange/records.py,
exchange/returned.py): everyone, every link and every life story; and, where they differ from
the family as received, a story's pictures and the photo, made again here. The keeper's
computer compares it with the family as the record had it when the change was made, and with
the tree now, as changes from a copy are compared: the keeper's review decides.
"""

from __future__ import annotations

import base64
import binascii
import gzip
import json
import zlib
from pathlib import Path
from typing import Any

from ancestree.exchange.records import in_link_order, link_record, person_record
from ancestree.familyfolder.entries import Entries
from ancestree.media.photos import PhotoError, process_picture
from ancestree.services.biography import biography_from
from ancestree.storage import biography as stories
from ancestree.storage import files

# What a computer sends, unpacked: a family with a few hundred photos made small (each at most
# 1600 pixels), and its life stories.
MOST_SENT = 256 * 1024 * 1024
_WEBP = "data:image/webp;base64,"
# Where someone sits on this computer's tree, and when their record was last written here:
# this computer's own, never a change to send. So are person.json, which only explains a
# person's folder to someone reading it without the app, and journal.json, which only the
# keeper's computer writes.
HERE_ONLY = frozenset({"layout_x", "layout_y", "updated_at"})
_EXPLAINS = ("/person.json", "/journal.json")


def _people(entries: Entries) -> set[str]:
    return {key.removeprefix("person/") for key in entries if key.startswith("person/")}


def rebased(
    was: Entries, mine: Entries, now: Entries, *, arranged_on: Entries | None = None
) -> Entries:
    """The family as received `now`, with this computer's own changes since `was` on top.

    A person's details come in one by one, so whatever else the keeper changed about them
    stays; a link, a file or a setting comes whole. A person the keeper took out goes, with
    what was changed about them. A link left joining someone no longer here goes too, as does
    a file of theirs. Where people sit on this computer's tree stays as arranged here since
    `arranged_on`, when that's another family than `was` (the one last received)."""
    family = _rebased(was, mine, now)
    if arranged_on is not None:
        for key, value in family.items():
            then, here = arranged_on.get(key), mine.get(key)
            if not key.startswith("person/") or then is None or here is None:
                continue
            moved = {
                name: here[name] for name in HERE_ONLY & here.keys() if then.get(name) != here[name]
            }
            if moved:
                family[key] = {**value, **moved}
    return family


def _rebased(was: Entries, mine: Entries, now: Entries) -> Entries:
    family = dict(now)
    for key in was.keys() | mine.keys():
        before, after = was.get(key), mine.get(key)
        if before == after:
            continue
        if after is None:
            family.pop(key, None)
        elif before is None or not key.startswith("person/"):
            family[key] = after
        elif key in family:
            theirs = dict(family[key])
            for name in before.keys() | after.keys():
                if before.get(name) == after.get(name):
                    continue
                if name in after:
                    theirs[name] = after[name]
                else:
                    theirs.pop(name, None)
            family[key] = theirs
    here = _people(family)

    def stranded(key: str, value: dict[str, Any]) -> bool:
        if key.startswith("link/"):
            return not {value.get("source"), value.get("target")} <= here
        return key.startswith("file/people/") and key.split("/")[2] not in here

    return {key: value for key, value in family.items() if not stranded(key, value)}


def _sent_part(key: str, value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None or not key.startswith("person/"):
        return value
    return {name: item for name, item in value.items() if name not in HERE_ONLY}


def own_changes(received: Entries, family: Entries) -> dict[str, dict[str, Any] | None]:
    """What this computer changed in the family it received: each entry it added or changed,
    as it is now; each it took out, as None. Only what it sends the keeper: not where people
    sit on its tree, nor person.json; nor the family's name, schema or settings, which are
    the keeper's."""
    keys = {
        key
        for key in received.keys() | family.keys()
        if key.startswith(("person/", "link/", "file/")) and not key.endswith(_EXPLAINS)
    }
    return {
        key: family.get(key)
        for key in sorted(keys)
        if _sent_part(key, received.get(key)) != _sent_part(key, family.get(key))
    }


def records(entries: Entries) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """The family the entries hold, as a copy to edit carries it: everyone's record and every
    link's, by id."""
    people = {
        key.removeprefix("person/"): person_record(value)
        for key, value in entries.items()
        if key.startswith("person/")
    }
    links: dict[str, dict[str, Any]] = {}
    for key, value in entries.items():
        if not key.startswith("link/"):
            continue
        props = value.get("properties") or {}
        links[str(props["id"])] = link_record(
            {
                "id": props["id"],
                "type": "parent" if value.get("type") == "PARENT_OF" else "spouse",
                "source": value["source"],
                "target": value["target"],
                "kind": props.get("kind"),
                "status": props.get("status"),
                "order": props.get("order"),
            }
        )
    return people, links


def _picture(data: bytes) -> str:
    return _WEBP + base64.b64encode(data).decode("ascii")


def family_to_send(family: Entries, received: Entries, data_dir: Path) -> dict[str, Any]:
    """This computer's family as a copy to edit carries it, for the keeper's review: everyone,
    every link and every life story; and, where they differ from the family as received, the
    pictures in a story and the photo, made again here (WebP, at most 1600 pixels)."""
    people, links = records(family)
    told: dict[str, Any] = {}
    pictures: dict[str, str] = {}
    photos: dict[str, Any] = {}
    for pid in sorted(people):
        story_key = f"file/people/{pid}/{stories.BIOGRAPHY}"
        text = stories.read_story(data_dir, pid) if story_key in family else None
        if text and text.strip():
            told[pid] = biography_from(text).model_dump(mode="json")
            if family.get(story_key) != received.get(story_key):
                for name in stories.pictures_in(text):
                    path = stories.picture_file(data_dir, pid, name)
                    if path is not None:
                        pictures[f"/api/persons/{pid}/media/{name}"] = _picture(path.read_bytes())
        profile = f"file/people/{pid}/profile/"

        def photo_of(entries: Entries, profile: str = profile) -> dict[str, Any]:
            return {
                key: value
                for key, value in entries.items()
                if key.startswith(profile) and "/previous/" not in key
            }

        if not people[pid].get("has_photo") or photo_of(family) == photo_of(received):
            continue
        original, crop = files.read_original(data_dir, pid), files.read_crop(data_dir, pid)
        if original is None or crop is None:
            continue
        try:
            display = process_picture(original)
        except PhotoError:
            continue  # unreadable here: the keeper's review says it isn't in what was sent
        photos[pid] = {"display": _picture(display), "crop": crop.model_dump()}
    return {
        "family": {"people": list(people.values()), "links": in_link_order(links.values())},
        "stories": told,
        "files": pictures,
        "photos": photos,
    }


def pack(family: dict[str, Any]) -> str:
    """A family to send, as a proposal holds it: JSON, gzipped, in base64."""
    text = json.dumps(family, ensure_ascii=False, separators=(",", ":"))
    return base64.b64encode(gzip.compress(text.encode("utf-8"), mtime=0)).decode("ascii")


class UnpackError(ValueError):
    """What a computer sent can't be read: it's left out of the keeper's inbox."""


def unpack(packed: str) -> dict[str, Any]:
    """A family a computer sent, unpacked with a limit: a small proposal can't make the
    keeper's computer unpack gigabytes."""
    try:
        data = base64.b64decode(packed, validate=True)
        unpacker = zlib.decompressobj(16 + zlib.MAX_WBITS)
        unpacked = unpacker.decompress(data, MOST_SENT + 1)
    except (binascii.Error, ValueError, zlib.error) as error:
        raise UnpackError("what it sent can't be unpacked") from error
    if len(unpacked) > MOST_SENT or unpacker.unconsumed_tail:
        raise UnpackError("what it sent is too big to bring in")
    try:
        found = json.loads(unpacked)
    except ValueError as error:
        raise UnpackError("what it sent can't be read") from error
    if not isinstance(found, dict):
        raise UnpackError("what it sent can't be read")
    return found
