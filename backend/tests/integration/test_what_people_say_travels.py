"""What people say about someone, travelling through the family folder to the
keeper's computer, with a real database there: a contributor's words wait for review and come
in signed, beside the keeper's own; a trusted computer's, and taking them back, come in by
themselves (your answer of 14 Oct 2026); a viewer's computer is heard on its words alone; and
no computer changes or takes out words written on another, nor passes off its words as
another's. The relative's computer stands in for its database, as in the unit tests. The
made-up family, Keluarga Contoh."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.domain.biography import Said
from ancestree.domain.familyfolder import BringIn, ReviewChanges
from ancestree.familyfolder import changes
from ancestree.services import biography
from ancestree.services.biography import (
    Writer,
    join_said,
    join_sources,
    split_said,
    split_sources,
)
from ancestree.services.familyfolder import FamilyFolder
from tests.integration.test_familyfolder_changes import keepers_family, someone_real, two_computers
from tests.unit.test_familyfolder_service import Family

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

DAY = date(2026, 10, 14)


def says(family: Family, person: str, said: list[Said]) -> None:
    """What people say about them, as the relative's computer has it now: as the app writes it
    there, in biography.md, the story and Sources kept."""
    path = family.data_dir / "people" / person / "biography.md"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    story, sources = split_sources(text)
    story, _ = split_said(story)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(join_sources(join_said(story, said), sources).encode("utf-8"))


def said_there(family: Family, person: str) -> list[Said]:
    path = family.data_dir / "people" / person / "biography.md"
    return biography.biography_from(path.read_text(encoding="utf-8")).said


def keeper_writes(keeper: FamilyFolder) -> Writer:
    assert keeper.computer is not None
    return Writer("Zulkifli bin Hassan", keeper.computer.device, keeper=True)


async def test_a_contributors_words_wait_for_review_and_come_in_signed(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    keeper, relative, theirs, device, ctx = await two_computers(driver, settings, tmp_path)
    hassan = someone_real(theirs.graph)["id"]
    mine = Said(id="1a2b3c4d", text="He taught me to fish.", writer="Mak Long", device=device)
    says(theirs, hassan, [mine.model_copy(update={"written": DAY})])
    await relative.sync()
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    assert not waiting.words_only

    preview = await keeper.review(device, waiting.proposal, ReviewChanges())
    [change] = preview.changes
    assert (change.kind, change.by, change.detail, change.after, change.ticked) == (
        "said",
        "Mak Long",
        "written",
        "He taught me to fish.",
        True,
    )
    # The keeper writes their own words meanwhile: both are kept.
    await biography.add_said(ctx, UUID(hassan), "A patient father.", keeper_writes(keeper))
    done = await keeper.bring_in(device, BringIn(proposal=waiting.proposal))
    assert done.left_out == 0
    life = await biography.read_biography(ctx, UUID(hassan))
    assert [(s.text, s.writer, s.device) for s in life.said] == [
        ("A patient father.", "Zulkifli bin Hassan", keeper_writes(keeper).device),
        ("He taught me to fish.", "Mak Long", device),
    ]
    await relative.sync()  # and both reach the relative's computer
    assert [s.writer for s in said_there(theirs, hassan)] == ["Zulkifli bin Hassan", "Mak Long"]


async def test_a_trusted_computers_words_and_taking_them_back_come_in_by_themselves(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    """Taking back its own words isn't taking something out of the family: it comes in by
    itself (your answer of 14 Oct 2026)."""
    keeper, relative, theirs, device, ctx = await two_computers(
        driver, settings, tmp_path, role="trusted"
    )
    hassan = someone_real(theirs.graph)["id"]
    mine = Said(id="1a2b3c4d", text="He taught me to fish.", writer="Mak Long", device=device)
    says(theirs, hassan, [mine])
    await relative.sync()
    await keeper.sync()
    assert (await keeper.status()).changes == []
    life = await biography.read_biography(ctx, UUID(hassan))
    assert [s.text for s in life.said] == ["He taught me to fish."]

    await relative.sync()
    says(theirs, hassan, [])  # taken back
    await relative.sync()
    await keeper.sync()
    assert (await keeper.status()).changes == []
    assert (await biography.read_biography(ctx, UUID(hassan))).said == []


async def test_no_computer_changes_anothers_words_nor_passes_its_own_off_as_anothers(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    """The attack, from a trusted computer, whose changes come in by themselves: it rewrites
    the keeper's words, takes out another's, and sends words claiming to be written on the
    keeper's computer. None of it comes in; the rest does; and its answer says what wasn't
    taken."""
    keeper, relative, theirs, _, ctx = await two_computers(
        driver, settings, tmp_path, role="trusted"
    )
    pid = someone_real(theirs.graph)["id"]
    keepers = keeper_writes(keeper)
    await biography.add_said(ctx, UUID(pid), "A patient father.", keepers)
    await biography.add_said(ctx, UUID(pid), "He built the surau.", keepers)
    await keeper.sync()
    await relative.sync()
    first, second = said_there(theirs, pid)

    forged = Said(id="9f9f9f9f", text="Signed by the keeper.", writer="Zulkifli bin Hassan")
    forged.device = keepers.device
    says(theirs, pid, [first.model_copy(update={"text": "A strict father."}), forged])
    someone_real(theirs.graph)["nickname"] = "Tok Su"  # and something it may change
    await relative.sync()
    await keeper.sync()
    assert (await keeper.status()).changes == []  # the rest came in by itself

    life = await biography.read_biography(ctx, UUID(pid))
    assert [s.text for s in life.said] == ["A patient father.", "He built the surau."]
    people = {p["id"]: p for p in await keepers_family(driver, settings)}
    assert people[pid]["nickname"] == "Tok Su"
    await relative.sync()
    [answer] = (await relative.status()).answers
    left = " ".join(answer.left_out)
    assert left.count("written on another computer") == 3
    assert [s.text for s in said_there(theirs, pid)] == ["A patient father.", "He built the surau."]
    assert second.text == "He built the surau."


async def test_a_viewers_computer_is_heard_on_its_words_alone_and_never_by_themselves(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    """A viewer's words (your answer of 14 Oct 2026) wait for the keeper. Anything else it
    sends, such as a detail changed in its database, isn't offered, even if asked for."""
    keeper, relative, theirs, device, ctx = await two_computers(
        driver, settings, tmp_path, role="viewer"
    )
    hassan = someone_real(theirs.graph)
    pid = hassan["id"]
    hassan["nickname"] = "Tok Su"
    await relative.sync()
    await keeper.sync()
    assert (await keeper.status()).changes == []  # a viewer sends nothing but words

    says(theirs, pid, [Said(id="1a2b3c4d", text="A kind man.", writer="Mak Long", device=device)])
    await relative.sync()
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    assert (waiting.role, waiting.words_only) == ("viewer", True)
    preview = await keeper.review(device, waiting.proposal, ReviewChanges())
    assert [(c.kind, c.by) for c in preview.changes] == [("said", "Mak Long")]
    [other] = preview.left_out
    assert other.why.startswith("A viewer's computer sends only its words about people")

    asked = [change.id for change in preview.changes] + [f"set:{pid}:nickname"]
    await keeper.bring_in(device, BringIn(proposal=waiting.proposal, chosen=asked))
    people = {p["id"]: p for p in await keepers_family(driver, settings)}
    assert people[pid].get("nickname") != "Tok Su"
    life = await biography.read_biography(ctx, UUID(pid))
    assert [(s.text, s.device) for s in life.said] == [("A kind man.", device)]


async def test_a_carriage_return_never_passes_words_off_as_the_keepers(
    driver: AsyncDriver, settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The attack (security review of 0.8.0), from a trusted computer of its own making: its
    words end their lines in a carriage return alone, which the keeper's computer once read
    as that computer's own words and, written and read back, as the keeper's. Read as they'll
    be kept, the keeper's are refused, and only its own come in."""
    keeper, relative, theirs, device, ctx = await two_computers(
        driver, settings, tmp_path, role="trusted"
    )
    pid = someone_real(theirs.graph)["id"]
    keepers = keeper_writes(keeper)
    says(theirs, pid, [Said(id="1a2b3c4d", text="PLACE", writer="Mak Long", device=device)])
    crafted = (
        "Hello\r\r— Zulkifli bin Hassan, 1 October 2026 "
        f"<!-- said 0badf00d by {keepers.device} on 2026-10-01 -->\r\r> Rest"
    )
    sending = biography.told  # as the relative's computer sends a story

    def as_crafted(text: str) -> dict[str, Any]:
        told = sending(text)
        return {**told, "story": told["story"].replace("PLACE", crafted)}

    monkeypatch.setattr(changes, "told_story", as_crafted)
    await relative.sync()
    await keeper.sync()

    life = await biography.read_biography(ctx, UUID(pid))
    assert [(s.id, s.text, s.device) for s in life.said] == [("1a2b3c4d", "Rest", device)]
    path = ctx.data_dir / "people" / pid / "biography.md"
    assert "0badf00d" not in path.read_text(encoding="utf-8")


async def test_words_signed_with_the_keepers_name_show_the_computer_they_came_from(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    """Your answer of 14 Oct 2026: a trusted computer signing its own words with the keeper's
    name, whose come in by themselves, is seen to: on the keeper's computer, they show the name
    of the computer they were written on, and the keeper's own show none."""
    keeper, relative, theirs, device, ctx = await two_computers(
        driver, settings, tmp_path, role="trusted"
    )
    pid = someone_real(theirs.graph)["id"]
    keepers = keeper_writes(keeper)
    await biography.add_said(ctx, UUID(pid), "A patient father.", keepers)
    await keeper.sync()
    await relative.sync()
    [own] = said_there(theirs, pid)
    posing = Said(id="1a2b3c4d", text="Signed as the keeper.", writer="Zulkifli bin Hassan")
    posing.device = device
    says(theirs, pid, [own, posing])
    await relative.sync()
    await keeper.sync()

    reading = Writer(keepers.name, keepers.device, keeper=True, computers=keeper.computers())
    life = await biography.read_biography(ctx, UUID(pid), reading)
    assert [(s.writer, s.computer) for s in life.said] == [
        ("Zulkifli bin Hassan", None),
        ("Zulkifli bin Hassan", "Mak Long's laptop"),
    ]
