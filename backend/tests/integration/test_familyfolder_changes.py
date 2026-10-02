"""Changes sent back through the family folder, with a real database on the keeper's
computer: the keeper's review of what a relative's computer sent, as changes from a copy to edit
were reviewed; bringing them in, turning them down, a trusted computer's coming in by
themselves, and Take back. The relative's computer stands in for its database, as in the unit
tests. The made-up family, Keluarga Contoh."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from neo4j import AsyncDriver

from ancestree.config import Settings
from ancestree.domain.familyfolder import (
    Admit,
    BringIn,
    Invite,
    JoinFamily,
    ReviewChanges,
    StartFamily,
    TurnDown,
)
from ancestree.familyfolder.computers import Keeper
from ancestree.familyfolder.google import Client, Tokens
from ancestree.familyfolder.models import RecordChange
from ancestree.familyfolder.seals import Kind, peek, unseal
from ancestree.migrations.runner import apply_migrations
from ancestree.repo.export import export_graph
from ancestree.seed.loader import load_seed
from ancestree.services import imports, journal
from ancestree.services.context import Context, NotFoundError
from ancestree.services.familyfolder import FamilyFolder
from ancestree.services.history import History
from tests.fake_drive import Cloud
from tests.unit.test_familyfolder_service import KEEPER, RELATIVE, Family, computer

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

AMINAH = "00000000-0000-4000-8000-00000000a001"
LINK = "00000000-0000-4000-8000-00000000a0a1"


async def keepers_family(driver: AsyncDriver, settings: Settings) -> list[dict[str, Any]]:
    graph = await export_graph(driver, settings.neo4j_database)
    people: list[dict[str, Any]] = graph["people"]
    return people


async def two_computers(
    driver: AsyncDriver, settings: Settings, tmp_path: Path, role: str = "contributor"
) -> tuple[FamilyFolder, FamilyFolder, Family, str, Context]:
    """The keeper's computer, on the made-up family in the database, and a relative's, let in
    with `role` and the family received."""
    await apply_migrations(driver, settings.neo4j_database)
    await load_seed(driver, settings.neo4j_database)
    cloud = Cloud()
    ctx = Context(driver, settings.neo4j_database, settings.data_dir)
    keeper = FamilyFolder(
        ctx,
        client=Client("made-up-client", "made-up-secret"),
        drive=lambda session: cloud.as_account(session.email),
        history=History(),
    )
    keeper._signed_in(Client("made-up-client", "made-up-secret"), Tokens("r", KEEPER))
    keeper.history.journal = lambda step, how: journal.record(
        ctx.data_dir, step, keeper.journaling() or "", how
    )  # as the app has it: who changed this
    await keeper.start(StartFamily(family="Keluarga Contoh", computer="Keeper's PC"))
    await keeper.invite(Invite(email=RELATIVE))
    theirs = Family(tmp_path / "relative-data")
    relative = computer(tmp_path, cloud, RELATIVE, theirs)
    [shared] = await relative.shared()
    await relative.join(JoinFamily(folder=shared.id, computer="Mak Long's laptop"))
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role=role))  # type: ignore[arg-type]
    await relative.sync()
    assert len(theirs.restores) == 1
    return keeper, relative, theirs, asking.device, ctx


def someone_real(graph: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, Any] = next(
        p for p in sorted(graph["people"], key=lambda p: p["id"]) if not p.get("placeholder")
    )
    return found


def add_a_daughter(graph: dict[str, Any], parent: str) -> None:
    graph["people"].append(
        {
            "id": AMINAH,
            "full_name": "Aminah binti Ali",
            "gender": "female",
            "placeholder": False,
            "has_photo": False,
            "photo_version": 0,
        }
    )
    graph["links"].append(
        {
            "type": "PARENT_OF",
            "source": parent,
            "target": AMINAH,
            "properties": {"id": LINK, "kind": "biological"},
        }
    )


async def test_the_keeper_reviews_and_brings_in_what_a_relative_sent(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    keeper, relative, theirs, device, ctx = await two_computers(driver, settings, tmp_path)
    who = someone_real(theirs.graph)
    who["nickname"] = "Tok Su"
    add_a_daughter(theirs.graph, who["id"])
    await relative.sync()
    await keeper.sync()
    [waiting] = (await keeper.status()).changes

    preview = await keeper.review(device, waiting.proposal, ReviewChanges())
    kinds = sorted(change.kind for change in preview.changes)
    assert kinds == ["add_link", "add_person", "set"]
    assert all(change.ticked for change in preview.changes)
    assert not any(change.clash for change in preview.changes)

    done = await keeper.bring_in(device, BringIn(proposal=waiting.proposal))
    assert (done.people, done.links, done.changed, done.left_out) == (1, 1, 1, 0)
    assert done.label == "Changes from Mak Long's laptop"
    people = {p["id"]: p for p in await keepers_family(driver, settings)}
    assert people[who["id"]]["nickname"] == "Tok Su"
    assert people[AMINAH]["full_name"] == "Aminah binti Ali"
    assert (await keeper.status()).changes == []
    with pytest.raises(NotFoundError):
        await keeper.bring_in(device, BringIn(proposal=waiting.proposal))  # once only

    [line] = journal.journal_of(ctx.data_dir, who["id"])  # who changed this
    assert (line.what, line.by, line.from_computer, line.from_email) == (
        "Changes from Mak Long's laptop",
        "Keeper's PC",
        "Mak Long's laptop",
        RELATIVE,
    )

    await relative.sync()  # what was taken is the family's now
    files = theirs.restores[-1]["files"]
    assert f"people/{who['id']}/journal.json" in files  # who changed it, there too
    status = await relative.status()
    assert status.pending == 0
    assert status.answers == []  # all taken: no note
    assert relative.computer is not None
    assert relative.computer.waiting == {}

    [earlier] = await imports.list_imports(ctx)
    assert (earlier.kind, earlier.for_name, earlier.people) == ("folder", "Mak Long's laptop", 1)
    taken = await imports.take_back(ctx, keeper.history, earlier.id)
    assert taken.moved == 1
    people = {p["id"]: p for p in await keepers_family(driver, settings)}
    assert AMINAH not in people
    assert people[who["id"]].get("nickname") != "Tok Su"


async def test_what_the_keeper_doesnt_take_goes_back_with_a_note(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    keeper, relative, theirs, device, _ = await two_computers(driver, settings, tmp_path)
    who = someone_real(theirs.graph)
    who["nickname"] = "Tok Su"
    add_a_daughter(theirs.graph, who["id"])
    await relative.sync()
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    preview = await keeper.review(device, waiting.proposal, ReviewChanges())
    chosen = [change.id for change in preview.changes if change.kind == "set"]
    await keeper.bring_in(
        device, BringIn(proposal=waiting.proposal, chosen=chosen, note="Who are her parents?")
    )
    await relative.sync()
    [answer] = (await relative.status()).answers
    assert answer.note == "Who are her parents?"
    assert any("Aminah binti Ali" in line for line in answer.left_out)
    latest = theirs.restores[-1]["graph"]
    assert AMINAH not in {p["id"] for p in latest["people"]}  # not taken: gone here too
    assert next(p for p in latest["people"] if p["id"] == who["id"])["nickname"] == "Tok Su"

    del next(p for p in theirs.graph["people"] if p["id"] == who["id"])["nickname"]
    theirs.graph["people"][0]["occupation"] = "Teacher"
    await relative.sync()
    await keeper.sync()
    [again] = (await keeper.status()).changes
    await keeper.turn_down(device, TurnDown(proposal=again.proposal, note="Not now, please"))
    await relative.sync()
    answers = (await relative.status()).answers
    assert answers[-1].note == "Not now, please"
    assert answers[-1].left_out  # everything it sent, in words
    assert (await relative.status()).pending == 0


async def test_a_clash_with_the_keepers_own_change_waits_for_a_tick(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    keeper, relative, theirs, device, _ = await two_computers(driver, settings, tmp_path)
    who = someone_real(theirs.graph)
    who["nickname"] = "Tok Su"
    await relative.sync()
    await driver.execute_query(
        "MATCH (p:Person {id: $id}) SET p.nickname = 'Pak Long'",
        id=who["id"],
        database_=settings.neo4j_database,
    )
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    [change] = (await keeper.review(device, waiting.proposal, ReviewChanges())).changes
    assert change.clash
    assert not change.ticked  # the keeper's stays unless ticked


async def test_a_trusted_computers_changes_come_in_unless_they_take_something_out(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    keeper, relative, theirs, _, _ = await two_computers(driver, settings, tmp_path, role="trusted")
    who = someone_real(theirs.graph)
    who["nickname"] = "Tok Su"
    await relative.sync()
    await keeper.sync()  # in by itself
    assert (await keeper.status()).changes == []
    people = {p["id"]: p for p in await keepers_family(driver, settings)}
    assert people[who["id"]]["nickname"] == "Tok Su"
    await relative.sync()
    assert (await relative.status()).pending == 0

    gone = next(
        p for p in theirs.graph["people"] if not p.get("placeholder") and p["id"] != who["id"]
    )
    theirs.graph["people"].remove(gone)
    theirs.graph["links"] = [
        link for link in theirs.graph["links"] if gone["id"] not in (link["source"], link["target"])
    ]
    await relative.sync()
    await keeper.sync()
    [waiting] = (await keeper.status()).changes  # taking someone out waits for the keeper
    assert waiting.role == "trusted"


def sources_of(keeper: FamilyFolder) -> dict[int, str | None]:
    """Each change set in the keeper's record: the relative's computer it came from, if any."""
    computer = keeper.computer
    assert isinstance(computer, Keeper)
    found: dict[int, str | None] = {}
    for path in (keeper.local / "record").glob("*.chg"):
        blob = path.read_bytes()
        seq = int(path.name.split("-")[0])
        _, epoch, _ = peek(blob)
        opened = unseal(blob, f"record/{seq}", Kind.RECORD, {computer.keeper}, computer.keys[epoch])
        change = RecordChange.model_validate_json(opened.payload)
        found[seq] = change.source.device if change.source else None
    return found


async def test_the_keepers_own_changes_go_out_first_and_as_the_keepers(
    driver: AsyncDriver, settings: Settings, tmp_path: Path
) -> None:
    """Bringing in a relative's changes publishes them as theirs, in a change set of their
    own: what the keeper changed meanwhile goes out first, as the keeper's (0.3.1)."""
    keeper, relative, theirs, device, _ = await two_computers(driver, settings, tmp_path)
    who = someone_real(theirs.graph)
    who["nickname"] = "Tok Su"
    await relative.sync()
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    other = next(
        p
        for p in sorted(theirs.graph["people"], key=lambda p: p["id"])
        if not p.get("placeholder") and p["id"] != who["id"]
    )
    await driver.execute_query(
        "MATCH (p:Person {id: $id}) SET p.occupation = 'Teacher'",
        id=other["id"],
        database_=settings.neo4j_database,
    )  # the keeper's own, not published yet
    await keeper.bring_in(device, BringIn(proposal=waiting.proposal))
    assert isinstance(keeper.computer, Keeper)
    changed = keeper.computer.changed
    mine, brought = changed[f"person/{other['id']}"], changed[f"person/{who['id']}"]
    assert mine < brought
    sources = sources_of(keeper)
    assert (sources[mine], sources[brought]) == (None, device)
