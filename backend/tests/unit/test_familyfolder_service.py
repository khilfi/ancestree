"""The family folder in the app: the keeper's computer and a relative's, kept in step
through a stand-in for Google Drive. The database stands aside: each computer's family is a
made-up graph, and what a restore would put in its place is kept to look at. Names are the
fictional family's."""

from __future__ import annotations

import asyncio
import copy
import json
import re
import sys
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest

from ancestree.domain.familyfolder import (
    Admit,
    Invite,
    JoinFamily,
    OneComputer,
    Recover,
    ReviewChanges,
    StartFamily,
    TurnDown,
)
from ancestree.familyfolder.computers import Keeper, Member
from ancestree.familyfolder.drive import DriveError
from ancestree.familyfolder.google import Client, Session, SignedOutError, Tokens
from ancestree.familyfolder.invitations import Invitation
from ancestree.familyfolder.mirror import Mirror
from ancestree.services.context import Context, NotFoundError, RuleError
from ancestree.services.familyfolder import (
    FOLDER_NAME,
    FOREIGN,
    LOST,
    LOST_RELATIVE,
    NOT_THIS_PROJECTS,
    OWN_FOLDER,
    REPLACED,
    UNREADABLE,
    FamilyFolder,
    keep_in_step,
)
from tests.fake_drive import Cloud

pytestmark = pytest.mark.anyio

KEEPER = "keeper@example.com"
RELATIVE = "relative@example.com"
HASSAN = "00000000-0000-4000-8000-000000000001"
SITI = "00000000-0000-4000-8000-000000000002"


def made_up_graph() -> dict[str, Any]:
    return {
        "schema_version": 9,
        "people": [
            {"id": HASSAN, "full_name": "Hassan bin Ismail", "gender": "male"},
            {"id": SITI, "full_name": "Siti binti Hassan", "gender": "female"},
        ],
        "links": [
            {
                "type": "PARENT_OF",
                "source": HASSAN,
                "target": SITI,
                "properties": {"id": "00000000-0000-4000-8000-0000000000a1", "kind": "biological"},
            }
        ],
        "relationship_kinds": [{"key": "biological", "label": "Biological", "sort_order": 0}],
    }


class Family:
    """One computer's family, as its database would hold it, and every restore made of it."""

    def __init__(self, data_dir: Path, graph: dict[str, Any] | None = None) -> None:
        self.data_dir = data_dir
        self.graph = graph or {
            "schema_version": 9,
            "people": [],
            "links": [],
            "relationship_kinds": [],
        }
        self.restores: list[dict[str, Any]] = []

    async def export(self) -> dict[str, Any]:
        return copy.deepcopy(self.graph)

    async def restore(self, archive: Path, backup_first: bool) -> None:
        """As a restore would: the archive's graph and its people's, settings' and Trash's
        files."""
        with ZipFile(archive) as opened:
            graph = json.loads(opened.read("graph.json"))
            files = {
                name: opened.read(name)
                for name in opened.namelist()
                if name.startswith(("people/", "settings/", "trash/"))
            }
        for name, data in files.items():
            target = self.data_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        self.graph = graph
        self.restores.append({"graph": graph, "files": files, "backup_first": backup_first})


def family_of(folder: FamilyFolder) -> str:
    """The family's id, as its family folder's family.json has it."""
    assert folder.computer is not None
    return folder.computer.family


def folder_name(folder: FamilyFolder) -> str:
    """The family folder's name in Drive, since 0.4.0: with its family's id."""
    return f"{FOLDER_NAME} ({family_of(folder)})"


def family_folders(cloud: Cloud) -> list[str]:
    return [item.name for item in cloud.items.values() if item.name.startswith(f"{FOLDER_NAME} (")]


def computer(tmp_path: Path, cloud: Cloud, email: str, family: Family) -> FamilyFolder:
    ctx = Context(None, "neo4j", family.data_dir)  # type: ignore[arg-type]
    folder = FamilyFolder(
        ctx,
        client=Client("made-up-client", "made-up-secret"),
        drive=lambda session: cloud.as_account(session.email),
        graph=family.export,
        restore=family.restore,
    )
    folder._signed_in(Client("made-up-client", "made-up-secret"), Tokens("r", email))
    return folder


@pytest.fixture
def cloud() -> Cloud:
    return Cloud()


async def two_computers(
    tmp_path: Path, cloud: Cloud
) -> tuple[FamilyFolder, Family, FamilyFolder, Family, str]:
    ours = Family(tmp_path / "keeper-data", made_up_graph())
    keeper = computer(tmp_path, cloud, KEEPER, ours)
    await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    await keeper.invite(Invite(email=RELATIVE))
    theirs = Family(tmp_path / "relative-data")
    relative = computer(tmp_path, cloud, RELATIVE, theirs)
    [shared] = await relative.shared()
    await relative.join(JoinFamily(folder=shared.id, computer="Mak Long's laptop"))
    return keeper, ours, relative, theirs, shared.id


async def test_a_relative_joins_with_the_code_and_receives_the_family(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, relative, theirs, folder = await two_computers(tmp_path, cloud)
    assert cloud.path(folder) == folder_name(keeper)
    assert cloud.items[folder].owner == KEEPER

    waiting = await relative.status()
    assert waiting.setup == "member"
    assert waiting.role == "waiting"
    assert waiting.code is not None
    assert re.fullmatch(r"[A-Z2-7]{4}-[A-Z2-7]{4}", waiting.code)
    await relative.sync()
    assert theirs.restores == []  # nothing until the keeper lets it in

    await keeper.sync()
    [asking] = (await keeper.status()).asking
    assert (asking.name, asking.email, asking.code) == ("Mak Long's laptop", RELATIVE, waiting.code)
    await keeper.admit(Admit(device=asking.device, role="viewer"))

    await relative.sync()
    now = await relative.status()
    assert (now.role, now.family, now.problem) == ("viewer", "Keluarga Contoh", "")
    assert [restore["graph"] for restore in theirs.restores] == [ours.graph]
    assert theirs.restores[0]["backup_first"] is True  # what was here first: kept
    names = {member.name: (member.role, member.email) for member in now.members}
    assert names == {
        "Pak Hassan's PC": ("keeper", KEEPER),
        "Mak Long's laptop": ("viewer", RELATIVE),
    }
    assert not relative.editing
    assert keeper.editing


async def test_each_computer_writes_only_in_its_own_folder(tmp_path: Path, cloud: Cloud) -> None:
    """The family folder holds the keeper's files alone, so the keeper's app can share it, and
    stop sharing it, within the permission D41 chose: Drive refuses while it holds another
    account's file."""
    keeper, _, relative, _, folder = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role="contributor"))
    await relative.sync()

    in_the_family_folder = [item for item in cloud.items.values() if cloud.inside(item, folder)]
    assert {item.owner for item in in_the_family_folder} == {KEEPER}
    assert relative.setup is not None
    own = cloud.items[relative.setup.own_folder]
    family = family_of(keeper)
    named = f"{OWN_FOLDER} ({family}, {asking.device})"
    assert (own.name, own.owner, own.parent) == (named, RELATIVE, None)
    assert own.shared == {KEEPER: "reader"}
    assert cloud.items[folder].shared == {RELATIVE: "reader"}
    written = [cloud.path(item.id) for item in cloud.items.values() if cloud.inside(item, own.id)]
    assert f"{own.name}/join/{asking.device}.req" in written

    await keeper.invite(Invite(email="cousin@example.com"))  # another relative, after the first
    assert set(cloud.items[folder].shared) == {RELATIVE, "cousin@example.com"}


async def test_a_folder_from_an_account_not_invited_is_left_alone(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, _, _, _ = await two_computers(tmp_path, cloud)
    stranger = cloud.as_account("stranger@example.com")
    lookalike = stranger.create_folder(f"{OWN_FOLDER} (0123456789abcdef)", None)
    join = stranger.create_folder("join", lookalike.id)
    stranger.upload("0123456789abcdef.req", join.id, b"let me in")
    stranger.share(lookalike.id, KEEPER)
    await keeper.sync()
    assert [ask.email for ask in (await keeper.status()).asking] == [RELATIVE]
    assert not (keeper.local / "join" / "0123456789abcdef.req").exists()


async def test_what_the_keeper_changes_reaches_the_relative(tmp_path: Path, cloud: Cloud) -> None:
    keeper, ours, relative, theirs, _ = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role="contributor"))
    await relative.sync()

    ours.graph["people"][1]["full_name"] = "Siti Aminah binti Hassan"
    ours.graph["people"].append({"id": "00000000-0000-4000-8000-000000000003", "full_name": "Ali"})
    photo = ours.data_dir / "people" / HASSAN / "photos" / "portrait.jpg"
    photo.parent.mkdir(parents=True)
    photo.write_bytes(b"\xff\xd8 a made-up photo")
    story = ours.data_dir / "people" / HASSAN / "biography.md"
    story.write_text("# Hassan\n\nA made-up story.\n", encoding="utf-8")
    await keeper.sync()
    await relative.sync()

    latest = theirs.restores[-1]
    assert latest["backup_first"] is False  # after the first: the keeper's can always return
    assert latest["graph"] == ours.graph
    assert latest["files"][f"people/{HASSAN}/photos/portrait.jpg"] == b"\xff\xd8 a made-up photo"
    assert latest["files"][f"people/{HASSAN}/biography.md"].startswith(b"# Hassan")

    await keeper.sync()
    await relative.sync()
    assert len(theirs.restores) == 2  # nothing changed since: nothing restored again


async def test_a_relatives_folder_gone_since_drive_last_looked_is_passed_over(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, _, _ = await two_computers(tmp_path, cloud)
    await keeper.sync()
    assert keeper.mirror is not None
    assert relative.setup is not None
    listed = keeper.mirror.drive.shared_folders(OWN_FOLDER)  # as Drive's search saw it
    cloud.as_account(RELATIVE).delete(relative.setup.own_folder)
    keeper.mirror.drive.shared_folders = lambda name="": listed  # type: ignore[method-assign]
    await keeper.sync()
    assert (await keeper.status()).problem == ""


async def test_a_removed_relative_loses_the_folder(tmp_path: Path, cloud: Cloud) -> None:
    keeper, ours, relative, theirs, folder = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role="viewer"))
    await relative.sync()

    await keeper.remove(OneComputer(device=asking.device))
    assert RELATIVE not in cloud.items[folder].shared
    ours.graph["people"][0]["full_name"] = "Haji Hassan bin Ismail"
    await keeper.sync()
    await relative.sync()
    assert len(theirs.restores) == 1
    assert "isn't shared with this Google account" in (await relative.status()).problem
    removed = {member.name: member.role for member in (await keeper.status()).members}
    assert removed["Mak Long's laptop"] == "removed"


async def removed(tmp_path: Path, cloud: Cloud) -> tuple[FamilyFolder, str]:
    """The keeper's computer, having removed the relative's while Drive refused to unshare."""
    keeper, _, relative, _, folder = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role="viewer"))
    await relative.sync()
    cloud.failing = {"unshare"}
    await keeper.remove(OneComputer(device=asking.device))  # done here, whatever Drive says
    return keeper, folder


async def test_a_removal_drive_refuses_is_finished_by_the_next_round(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, folder = await removed(tmp_path, cloud)
    status = await keeper.status()
    assert {member.name: member.role for member in status.members}["Mak Long's laptop"] == (
        "removed"
    )
    assert "Google Drive said no (500)" in status.problem
    assert RELATIVE in cloud.items[folder].shared

    await keeper.sync()  # Drive still refuses: still waiting
    assert RELATIVE in cloud.items[folder].shared
    cloud.failing = set()
    await keeper.sync()
    assert RELATIVE not in cloud.items[folder].shared
    assert (await keeper.status()).problem == ""
    again = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "keeper-data"))
    assert again.setup is not None
    assert again.setup.unshare == []


async def test_an_account_asked_back_before_drive_unshared_it_stays_shared(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, folder = await removed(tmp_path, cloud)
    cloud.failing = set()
    await keeper.invite(Invite(email=RELATIVE.upper()))
    await keeper.sync()
    assert RELATIVE in cloud.items[folder].shared


async def test_the_recovery_code_is_shown_though_drive_fails_just_then(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "keeper-data", made_up_graph()))
    cloud.failing = {"upload"}
    code = await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    status = await keeper.status()
    assert status.recovery_code == code  # there's no other copy of it
    assert "Google Drive said no (500)" in status.problem
    cloud.failing = set()
    await keeper.sync()
    assert any(item.name == "family.json" for item in cloud.items.values())
    assert (await keeper.status()).problem == ""


async def test_a_computer_turned_away_is_no_longer_asking(tmp_path: Path, cloud: Cloud) -> None:
    keeper, _, _, theirs, _ = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.refuse(OneComputer(device=asking.device))
    assert (await keeper.status()).asking == []
    with pytest.raises(NotFoundError):  # turned away: it asks again as a new computer, if need be
        await keeper.admit(Admit(device=asking.device, role="viewer"))
    with pytest.raises(RuleError):
        await keeper.start(StartFamily(family="Another", computer="PC"))  # one family here
    assert theirs.restores == []


async def test_the_keeper_puts_back_what_was_changed_in_drive(tmp_path: Path, cloud: Cloud) -> None:
    keeper, _, relative, theirs, _ = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role="viewer"))
    record = next(item for item in cloud.items.values() if cloud.path(item.id).endswith(".chg"))
    original = record.data
    cloud.as_account(RELATIVE).tamper(record.id, b"not the keeper's")
    await keeper.sync()
    assert record.data == original
    await relative.sync()
    assert len(theirs.restores) == 1
    assert (await relative.status()).problem == ""


async def test_offline_and_signed_out_are_said_plainly(tmp_path: Path, cloud: Cloud) -> None:
    keeper, _, _, _, _ = await two_computers(tmp_path, cloud)
    cloud.offline = True
    await keeper.sync()
    assert "No internet" in (await keeper.status()).problem
    cloud.offline = False
    await keeper.sync()
    assert (await keeper.status()).problem == ""

    def ended(*_: object) -> list[Any]:
        raise SignedOutError("ended")

    assert keeper.mirror is not None
    keeper.mirror.drive.children = ended  # type: ignore[method-assign, assignment]
    await keeper.sync()
    status = await keeper.status()
    assert "sign in again" in status.problem
    assert status.email is None
    assert status.setup == "keeper"  # the family folder stays; only the sign-in went


async def test_what_is_kept_here_survives_a_restart(tmp_path: Path, cloud: Cloud) -> None:
    keeper, ours, _, _, _ = await two_computers(tmp_path, cloud)
    code = keeper.recovery_code
    assert code is not None
    again = computer(tmp_path, cloud, KEEPER, ours)
    status = await again.status()
    assert (status.setup, status.role, status.family) == ("keeper", "keeper", "Keluarga Contoh")
    assert status.recovery_code == code  # until the keeper says it's kept: no other copy
    kept = (ours.data_dir / "familyfolder" / "recovery-code.bin").read_bytes()
    assert code.encode() not in kept or sys.platform != "win32"  # locked, as the keys are
    again.recovery_seen()
    assert (await computer(tmp_path, cloud, KEEPER, ours).status()).recovery_code is None
    assert not (ours.data_dir / "familyfolder" / "recovery-code.bin").exists()
    keys = (ours.data_dir / "familyfolder" / "computer" / "computer.bin").read_bytes()
    if sys.platform == "win32":  # locked by Windows: nothing in it can be read
        assert keys.startswith(b"AncesTree protected 1")
        assert b"Hassan" not in keys
        assert b"Keluarga" not in keys
    else:  # a file only this user may read
        assert keys.startswith(b"AncesTree plain 1")


async def test_nothing_in_drive_names_the_family(tmp_path: Path, cloud: Cloud) -> None:
    keeper, ours, relative, _, _ = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role="viewer"))
    await relative.sync()
    in_drive = b"".join(item.name.encode() + item.data for item in cloud.items.values())
    names = [b"Keluarga Contoh", b"Hassan", b"Siti", b"Pak Hassan", b"Mak Long"]
    assert [name for name in names if name in in_drive] == []
    local = ours.data_dir / "familyfolder" / "folder"
    in_the_copy = b"".join(path.read_bytes() for path in local.rglob("*") if path.is_file())
    assert [name for name in names if name in in_the_copy] == []


def test_a_sign_in_starts_at_googles_page_with_the_chosen_permission() -> None:
    from ancestree.familyfolder.google import SCOPES, SignIn

    sign_in = SignIn(Client("made-up-client", "made-up-secret"), hint="someone@example.com")
    try:
        assert sign_in.url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        for scope in SCOPES:
            assert scope.replace(":", "%3A").replace("/", "%2F") in sign_in.url
        assert "code_challenge_method=S256" in sign_in.url
        assert "access_type=offline" in sign_in.url
        assert "login_hint=someone%40example.com" in sign_in.url
        assert sign_in.redirect.startswith("http://127.0.0.1:")
    finally:
        sign_in.close()


async def test_the_keeper_comes_back_on_a_new_computer_with_the_recovery_code(
    tmp_path: Path, cloud: Cloud
) -> None:
    ours = Family(tmp_path / "keeper-data", made_up_graph())
    keeper = computer(tmp_path, cloud, KEEPER, ours)
    code = await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))

    new_one = Family(tmp_path / "new-computer")
    again = computer(tmp_path, cloud, KEEPER, new_one)
    with pytest.raises(RuleError) as wrong:
        await again.recover(Recover(code="AAAA BBBB CCCC DDDD EEEE FFFF GG"))
    assert wrong.value.code == "not_recovered"
    assert (await again.status()).setup is None

    await again.recover(Recover(code=code.lower()))  # typed as it comes: case doesn't matter
    status = await again.status()
    assert (status.setup, status.role, status.family) == ("keeper", "keeper", "Keluarga Contoh")
    [restore] = new_one.restores
    assert restore["graph"] == ours.graph
    assert restore["backup_first"] is True  # the keeper's own computer: backed up first


# --- Changes sent back --------------------------------------------------------------------


def someone(graph: dict[str, Any], pid: str) -> dict[str, Any]:
    found: dict[str, Any] = next(p for p in graph["people"] if p["id"] == pid)
    return found


async def admitted(
    tmp_path: Path, cloud: Cloud, role: str = "contributor"
) -> tuple[FamilyFolder, Family, FamilyFolder, Family, str]:
    """The keeper's computer and a relative's, let in with `role`, the family received."""
    keeper, ours, relative, theirs, _ = await two_computers(tmp_path, cloud)
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role=role))  # type: ignore[arg-type]
    await relative.sync()
    return keeper, ours, relative, theirs, asking.device


async def test_a_relatives_change_is_sent_and_waits_for_the_keeper(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs, device = await admitted(tmp_path, cloud)
    assert len(theirs.restores) == 1
    assert (await relative.status()).pending == 0
    assert relative.proposing
    assert not relative.editing

    someone(theirs.graph, HASSAN)["nickname"] = "Pak Hassan"  # changed on their computer
    await relative.sync()
    status = await relative.status()
    assert status.pending == 1
    assert status.sent_at is not None
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    assert (waiting.device, waiting.name, waiting.email, waiting.role, waiting.proposal) == (
        device,
        "Mak Long's laptop",
        RELATIVE,
        "contributor",
        1,
    )
    await relative.sync()  # nothing new since: nothing sent again
    await keeper.sync()
    assert [changes.proposal for changes in (await keeper.status()).changes] == [1]


async def test_the_keepers_next_family_comes_in_beneath_a_relatives_change(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, relative, theirs, _ = await admitted(tmp_path, cloud)
    someone(theirs.graph, HASSAN)["nickname"] = "Pak Hassan"
    await relative.sync()
    someone(ours.graph, SITI)["full_name"] = "Siti Aminah binti Hassan"  # the keeper's
    someone(ours.graph, HASSAN)["birth_year"] = 1950  # theirs too, of the same person
    await keeper.sync()
    await relative.sync()
    latest = theirs.restores[-1]["graph"]
    assert someone(latest, SITI)["full_name"] == "Siti Aminah binti Hassan"
    assert someone(latest, HASSAN)["nickname"] == "Pak Hassan"
    assert someone(latest, HASSAN)["birth_year"] == 1950
    assert (await relative.status()).pending == 1


async def test_once_answered_what_was_sent_goes_and_what_came_after_stays(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs, device = await admitted(tmp_path, cloud)
    someone(theirs.graph, HASSAN)["nickname"] = "Pak Hassan"
    await relative.sync()  # sent: its first proposal
    someone(theirs.graph, SITI)["occupation"] = "Teacher"  # changed after
    await keeper.sync()
    # The keeper's review needs the database: here, its computer answers as the review would.
    assert isinstance(keeper.computer, Keeper)
    keeper.computer.answer(device, 1, ["Hassan bin Ismail: Nickname"], "Not that one, please")
    await keeper.sync()
    await relative.sync()

    status = await relative.status()
    assert [(a.left_out, a.note) for a in status.answers] == [
        (["Hassan bin Ismail: Nickname"], "Not that one, please")
    ]
    latest = theirs.restores[-1]["graph"]
    assert "nickname" not in someone(latest, HASSAN)
    assert someone(latest, SITI)["occupation"] == "Teacher"
    relative.answers_seen()
    assert (await relative.status()).answers == []
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    assert waiting.proposal == 2  # what came after, sent once the first was answered


async def test_changes_sent_before_hearing_back_wait_for_fresher_ones(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs, device = await admitted(tmp_path, cloud)
    someone(theirs.graph, HASSAN)["nickname"] = "Pak Hassan"
    await relative.sync()  # proposal 1
    await keeper.sync()
    assert isinstance(keeper.computer, Keeper)
    keeper.computer.answer(device, 1, ["Hassan bin Ismail: Nickname"], "")
    someone(theirs.graph, SITI)["occupation"] = "Teacher"
    assert isinstance(relative.computer, Member)
    relative.computer.receive = lambda: 0  # type: ignore[method-assign]  # the answer's on its way
    await relative.sync()  # proposal 2, made before it heard back
    await keeper.sync()
    assert (await keeper.status()).changes == []  # it stands for 1, already answered
    del relative.computer.receive
    await relative.sync()  # it hears back, and sends what's still new: proposal 3
    await keeper.sync()
    assert [changes.proposal for changes in (await keeper.status()).changes] == [3]


async def test_a_change_put_back_here_is_withdrawn(tmp_path: Path, cloud: Cloud) -> None:
    keeper, _, relative, theirs, _ = await admitted(tmp_path, cloud)
    someone(theirs.graph, HASSAN)["nickname"] = "Pak Hassan"
    await relative.sync()
    del someone(theirs.graph, HASSAN)["nickname"]
    await relative.sync()  # sent again, changing nothing
    assert (await relative.status()).pending == 0
    await keeper.sync()
    assert (await keeper.status()).changes == []  # answered by itself
    await relative.sync()
    assert (await relative.status()).answers == []


async def test_a_viewer_sends_nothing_nor_does_moving_people_on_the_tree(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs, _ = await admitted(tmp_path, cloud, role="viewer")
    assert not relative.proposing
    someone(theirs.graph, HASSAN)["nickname"] = "Pak Hassan"
    await relative.sync()
    await keeper.sync()
    assert (await keeper.status()).changes == []

    keeper2, _, relative2, theirs2, _ = await admitted(tmp_path / "again", Cloud())
    someone(theirs2.graph, HASSAN).update(layout_x=120.0, layout_y=40.0)
    await relative2.sync()
    assert (await relative2.status()).pending == 0
    await keeper2.sync()
    assert (await keeper2.status()).changes == []


# --- Put right in 0.3.1 -------------------------------------------------------------------------


def records_in(cloud: Cloud) -> int:
    """The change sets in the family's record, as Drive holds them."""
    return sum(1 for item in cloud.items.values() if item.name.endswith(".chg"))


async def test_the_keeper_back_on_a_new_computer_takes_over_and_the_old_one_stops(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, _, _, folder = await two_computers(tmp_path, cloud)
    code = keeper.recovery_code
    assert code is not None
    await keeper.sync()  # the relative's request to join is gathered here

    new_one = Family(tmp_path / "new-computer")
    again = computer(tmp_path, cloud, KEEPER, new_one)
    await again.recover(Recover(code=code))
    await again.sync()
    in_the_family_folder = [item for item in cloud.items.values() if cloud.inside(item, folder)]
    paths = [cloud.path(item.id) for item in in_the_family_folder]
    assert not [path for path in paths if "/join/" in path or "/inbox/" in path]  # relatives'
    assert {item.owner for item in in_the_family_folder} == {KEEPER}
    assert [ask.name for ask in (await again.status()).asking] == ["Mak Long's laptop"]

    published = records_in(cloud)
    someone(ours.graph, HASSAN)["full_name"] = "Haji Hassan bin Ismail"  # on the old computer
    await keeper.sync()
    status = await keeper.status()
    assert (status.replaced, status.may_leave, status.problem) == (True, True, REPLACED)
    assert (status.asking, status.changes) == ([], [])
    assert records_in(cloud) == published  # nothing more from the old computer: no split
    with pytest.raises(RuleError) as stopped:
        await keeper.invite(Invite(email="cousin@example.com"))
    assert stopped.value.code == "replaced"
    assert (await again.status()).problem == ""  # the new keeper carries on

    await keeper.leave()  # set aside; to keep the family there again, recover there
    assert (await keeper.status()).setup is None


async def test_a_keeper_back_before_every_photo_has_come_publishes_nothing_yet(
    tmp_path: Path, cloud: Cloud
) -> None:
    ours = Family(tmp_path / "keeper-data", made_up_graph())
    photo = ours.data_dir / "people" / HASSAN / "profile" / "original.jpg"
    photo.parent.mkdir(parents=True)
    photo.write_bytes(b"\xff\xd8 a made-up photo")
    keeper = computer(tmp_path, cloud, KEEPER, ours)
    code = await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    blob = next(item for item in cloud.items.values() if "/files/" in cloud.path(item.id))
    hidden = cloud.items.pop(blob.id)  # not listed yet, as Drive sometimes is for a while
    published = records_in(cloud)

    new_one = Family(tmp_path / "new-computer")  # nobody here yet
    again = computer(tmp_path, cloud, KEEPER, new_one)
    await again.recover(Recover(code=code))
    assert new_one.restores == []
    assert "still arriving" in (await again.status()).problem
    assert records_in(cloud) == published + 1  # only the word that it keeps the family now
    await again.sync()
    assert records_in(cloud) == published + 1  # never everyone taken out, for want of a photo

    cloud.items[hidden.id] = hidden
    await again.sync()
    [restore] = new_one.restores
    assert restore["graph"] == ours.graph
    assert restore["files"][f"people/{HASSAN}/profile/original.jpg"] == b"\xff\xd8 a made-up photo"
    assert restore["backup_first"] is True
    await again.sync()
    assert records_in(cloud) == published + 1  # the family as it was: nothing to publish
    assert (await again.status()).problem == ""


async def test_a_new_recovery_code_and_the_old_one_opens_nothing(
    tmp_path: Path, cloud: Cloud
) -> None:
    ours = Family(tmp_path / "keeper-data", made_up_graph())
    keeper = computer(tmp_path, cloud, KEEPER, ours)
    old = await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    keeper.recovery_seen()
    new = await keeper.new_recovery_code()
    assert new != old
    assert (await keeper.status()).recovery_code == new
    assert (await computer(tmp_path, cloud, KEEPER, ours).status()).recovery_code == new  # kept
    recovery = sorted(
        cloud.path(item.id) for item in cloud.items.values() if "/recovery/" in cloud.path(item.id)
    )
    assert recovery == [f"{folder_name(keeper)}/recovery/000002.bin"]
    assert [item.name for item in cloud.binned.values()] == ["000001.bin"]  # in the bin, a while
    assert not (keeper.local / "recovery" / "000001.bin").exists()
    await keeper.sync()  # not put back by repair
    assert [item.name for item in cloud.items.values() if item.name == "000001.bin"] == []

    with pytest.raises(RuleError) as wrong:
        await computer(tmp_path, cloud, KEEPER, Family(tmp_path / "old-code")).recover(
            Recover(code=old)
        )
    assert wrong.value.code == "not_recovered"
    again = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "new-code"))
    await again.recover(Recover(code=new))
    assert (await again.status()).setup == "keeper"


async def test_changes_that_cant_be_read_can_still_be_turned_down(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, _, device = await admitted(tmp_path, cloud)
    assert isinstance(relative.computer, Member)
    assert relative.setup is not None
    relative.computer.send(
        [], family="bm90IGEgZmFtaWx5", answered=0, base=relative.setup.restored_seq, changed=1
    )  # "not a family": damaged on its way
    await relative.sync()  # sends it up
    await keeper.sync()
    [waiting] = (await keeper.status()).changes
    with pytest.raises(RuleError) as unreadable:
        await keeper.review(device, waiting.proposal, ReviewChanges())
    assert unreadable.value.code == "unreadable_changes"
    assert "Take none of it" in unreadable.value.message

    await keeper.turn_down(device, TurnDown(proposal=waiting.proposal, note="Again, please"))
    assert (await keeper.status()).changes == []
    await relative.sync()
    [answer] = (await relative.status()).answers
    assert (answer.left_out, answer.note) == ([UNREADABLE], "Again, please")


async def test_drive_trouble_comes_back_as_a_sentence(tmp_path: Path, cloud: Cloud) -> None:
    keeper = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "keeper-data", made_up_graph()))
    cloud.failing = {"create_folder"}
    with pytest.raises(RuleError) as failed:
        await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    assert failed.value.code == "drive_said_no"
    assert (await keeper.status()).setup is None
    cloud.failing, cloud.offline = set(), True
    with pytest.raises(RuleError) as offline:
        await keeper.shared()
    assert offline.value.code == "offline"
    with pytest.raises(RuleError) as offline:
        await keeper.recover(Recover(code="AAAA BBBB CCCC DDDD EEEE FFFF GG"))
    assert offline.value.code == "offline"
    cloud.offline = False
    await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))

    def ended(*_: object) -> None:
        raise SignedOutError("ended")

    assert keeper.drive is not None
    keeper.drive.share = ended  # type: ignore[method-assign, assignment]
    with pytest.raises(RuleError) as signed_out:
        await keeper.invite(Invite(email=RELATIVE))
    assert signed_out.value.code == "signed_out"
    status = await keeper.status()
    assert (status.email, status.setup) == (None, "keeper")  # signed out; the folder stays


async def test_a_second_family_folder_in_one_google_account_is_asked_about_first(
    tmp_path: Path, cloud: Cloud
) -> None:
    """It may be this family's, to keep again with the recovery code (0.3.1); or another
    family's, beside it (0.4.0)."""
    keeper = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "keeper-data", made_up_graph()))
    await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    another = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "another-family"))
    with pytest.raises(RuleError) as refused:
        await another.start(StartFamily(family="Keluarga Contoh", computer="Laptop"))
    assert (refused.value.code, refused.value.details) == ("family_folder_exists", {"count": 1})
    assert family_folders(cloud) == [folder_name(keeper)]

    await another.start(StartFamily(family="Keluarga Lain", computer="Laptop", another=True))
    assert sorted(family_folders(cloud)) == sorted([folder_name(keeper), folder_name(another)])
    assert family_of(keeper) != family_of(another)


async def test_one_relatives_folder_drive_wont_give_holds_up_no_one(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, relative, theirs, _ = await admitted(tmp_path, cloud, role="viewer")
    real = keeper._relatives_mirror

    def refusing(drive: Any, folder: str, device: str) -> Mirror:
        mirror = real(drive, folder, device)

        def pull() -> int:
            raise DriveError(403, "The user does not have sufficient permissions for this file.")

        mirror.pull = pull  # type: ignore[method-assign]
        return mirror

    keeper._relatives_mirror = refusing  # type: ignore[method-assign]
    someone(ours.graph, SITI)["full_name"] = "Siti Aminah binti Hassan"
    await keeper.sync()
    problem = (await keeper.status()).problem
    assert "Mak Long's laptop" in problem
    assert "(403)" in problem
    await relative.sync()  # the family still reached everyone
    assert someone(theirs.restores[-1]["graph"], SITI)["full_name"] == "Siti Aminah binti Hassan"


async def test_a_relatives_own_trash_stays_when_the_family_arrives(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, relative, theirs, _ = await two_computers(tmp_path, cloud)
    tomb = theirs.data_dir / "trash" / "2026-10-03T10-00-00_someone" / "tombstone.json"
    tomb.parent.mkdir(parents=True)
    tomb.write_text('{"format": 1}', encoding="utf-8")
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role="contributor"))
    await relative.sync()
    in_trash = "trash/2026-10-03T10-00-00_someone/tombstone.json"
    assert in_trash not in theirs.restores[0]["files"]  # the first time: its own family, backed up

    someone(ours.graph, SITI)["full_name"] = "Siti Aminah binti Hassan"
    await keeper.sync()
    await relative.sync()
    assert theirs.restores[-1]["files"][in_trash] == b'{"format": 1}'  # after: its own Trash


async def test_a_viewers_own_arrangement_stays_when_the_family_arrives(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, relative, theirs, _ = await admitted(tmp_path, cloud, role="viewer")
    someone(theirs.graph, HASSAN).update(layout_x=120.0, layout_y=40.0)  # dragged on their tree
    someone(ours.graph, SITI).update(
        full_name="Siti Aminah binti Hassan", layout_x=-50.0, layout_y=10.0
    )  # the keeper's
    await keeper.sync()
    await relative.sync()
    latest = theirs.restores[-1]["graph"]
    hassan, siti = someone(latest, HASSAN), someone(latest, SITI)
    assert (hassan["layout_x"], hassan["layout_y"]) == (120.0, 40.0)
    assert siti["layout_x"] == -50.0  # moved by the keeper, not here
    assert siti["full_name"] == "Siti Aminah binti Hassan"


async def test_a_relative_leaves_keeping_the_family_and_the_keeper_stays(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs, device = await admitted(tmp_path, cloud)
    assert not (await keeper.status()).may_leave
    with pytest.raises(RuleError) as stays:
        await keeper.leave()
    assert stays.value.code == "keeper_stays"

    assert (await relative.status()).may_leave
    await relative.leave()
    status = await relative.status()
    assert (status.setup, status.email, status.may_leave) == (None, None, False)
    assert relative.editing  # its family is its own again
    assert not (theirs.data_dir / "familyfolder").exists()
    assert len(list(theirs.data_dir.glob("familyfolder-left-*"))) == 1  # set aside, never deleted
    assert len(theirs.restores) == 1  # the family here stays as it was

    relative._signed_in(Client("made-up-client", "made-up-secret"), Tokens("r", RELATIVE))
    [shared] = await relative.shared()
    await relative.join(JoinFamily(folder=shared.id, computer="Mak Long's laptop"))
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    assert asking.device != device  # asking afresh, as a new computer


async def test_a_part_kept_elsewhere_never_stops_the_app(tmp_path: Path, cloud: Cloud) -> None:
    _, _, _, theirs, _ = await admitted(tmp_path, cloud)
    kept = theirs.data_dir / "familyfolder"
    (kept / "computer" / "computer.bin").write_bytes(b"AncesTree protected 1\nanother computer's")
    (kept / "google.bin").write_bytes(b"not a secret AncesTree kept")
    again = FamilyFolder(
        Context(None, "neo4j", theirs.data_dir),  # type: ignore[arg-type]
        client=Client("made-up-client", "made-up-secret"),
        drive=lambda session: cloud.as_account(session.email),
        graph=theirs.export,
        restore=theirs.restore,
    )
    status = await again.status()
    assert (status.broken, status.may_leave, status.email) == (True, True, None)
    assert "can't be opened here" in status.problem
    await again.sync()  # nothing to do, and nothing fails
    assert not again.editing  # a relative's family still isn't changed here

    await again.leave()
    status = await again.status()
    assert (status.setup, status.broken, status.problem) == (None, False, "")
    assert again.editing


# --- Each family's own Google project, and invitations (0.4.0) ---------------------------------


def client_file(client_id: str, project: str = "keluarga-contoh") -> str:
    """A client's file, as Google's console gives it for one of the Desktop app type."""
    return json.dumps(
        {
            "installed": {
                "client_id": client_id,
                "project_id": project,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "client_secret": "made-up-secret",
                "redirect_uris": ["http://localhost"],
            }
        }
    )


OUR_PROJECT = client_file("123456789012-ourclient.apps.googleusercontent.com")
SAME_PROJECT = client_file("123456789012-newclient.apps.googleusercontent.com")
OTHER_PROJECT = client_file("987654321098-theirclient.apps.googleusercontent.com", "keluarga-lain")


@pytest.fixture(autouse=True)
def no_client_named(monkeypatch: pytest.MonkeyPatch) -> None:
    """A client named while developing would stand in for every family's own."""
    monkeypatch.delenv("ANCESTREE_GOOGLE_CLIENT", raising=False)


def fresh(cloud: Cloud, family: Family) -> FamilyFolder:
    """A family on a new install, or the same one after a restart: what it kept, and no more."""
    return FamilyFolder(
        Context(None, "neo4j", family.data_dir),  # type: ignore[arg-type]
        drive=lambda session: cloud.as_account(session.email),
        graph=family.export,
        restore=family.restore,
    )


def signed_in(folder: FamilyFolder, email: str) -> None:
    """As a sign-in through the family's own project would leave it."""
    assert folder.client is not None
    folder._signed_in(folder.client, Tokens("r", email))
    folder._make_mirror()


async def keeper_with_project(
    tmp_path: Path, cloud: Cloud, name: str = "our-keeper", email: str = KEEPER
) -> tuple[FamilyFolder, Family]:
    """A keeper who gave the family its own Google project, signed in and started it."""
    ours = Family(tmp_path / name, made_up_graph())
    keeper = fresh(cloud, ours)
    await keeper.use_project(OUR_PROJECT)
    signed_in(keeper, email)
    await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    keeper.recovery_seen()
    return keeper, ours


async def test_a_family_signs_in_through_its_own_google_project(
    tmp_path: Path, cloud: Cloud
) -> None:
    ours = Family(tmp_path / "keeper-data", made_up_graph())
    keeper = fresh(cloud, ours)
    status = await keeper.status()
    assert (status.available, status.project) == (False, "")  # no release carries a client
    with pytest.raises(RuleError) as none:
        await keeper.sign_in()
    assert none.value.code == "no_google_client"

    await keeper.use_project(OUR_PROJECT)
    status = await keeper.status()
    assert (status.available, status.project, status.project_invited) == (
        True,
        "keluarga-contoh",
        False,
    )
    again = fresh(cloud, ours)  # kept with the family: there after a restart
    assert again.client == keeper.client


class Answered:
    """A sign-in Google has answered, as `SignIn` is once the browser comes back to it."""

    def __init__(self, client: Client, email: str) -> None:
        self.client, self.email = client, email
        self.answer, self.expired = "a code", False

    def finish(self) -> Tokens:
        return Tokens(f"refresh of {self.email}", self.email)

    def close(self) -> None:
        pass


async def test_a_sign_in_turned_away_is_given_back_to_google(
    tmp_path: Path, cloud: Cloud, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The keeper's computer signed in with another account, as a browser holding two will
    offer: refused, and given back to Google at once, rather than left on that account's list
    of apps with access to it (0.4.0)."""
    given_back: list[str] = []
    monkeypatch.setattr(
        Session, "sign_out", lambda session: given_back.append(session.tokens.refresh)
    )
    keeper, _ = await keeper_with_project(tmp_path, cloud)
    assert keeper.client is not None
    keeper.signing_in = Answered(keeper.client, RELATIVE)  # type: ignore[assignment]
    status = await keeper.status()
    assert status.problem.startswith(f"That was {RELATIVE}. This computer's family folder")
    assert given_back == [f"refresh of {RELATIVE}"]

    keeper.signing_in = Answered(keeper.client, KEEPER)  # type: ignore[assignment]
    status = await keeper.status()
    assert (status.email, status.problem) == (KEEPER, "")
    assert given_back == [f"refresh of {RELATIVE}"]  # the right account's, kept


async def test_a_file_that_isnt_a_desktop_apps_client_is_refused(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper = fresh(cloud, Family(tmp_path / "keeper-data"))
    web = json.dumps({"web": {"client_id": "1-a.apps.googleusercontent.com", "client_secret": "s"}})
    no_secret = client_file("123456789012-x.apps.googleusercontent.com").replace(
        "made-up-secret", " "
    )
    for text, says in (
        (web, "web application"),
        ("{ not the file", "can't be read"),
        (json.dumps({"installed": {"client_id": "nope", "client_secret": "s"}}), "no Desktop app"),
        (no_secret, "no secret"),
    ):
        with pytest.raises(RuleError) as refused:
            await keeper.use_project(text)
        assert refused.value.code == "not_a_client_file"
        assert says in refused.value.message
    assert keeper.client is None


async def test_once_started_only_its_projects_clients_keep_the_family_folder(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _ = await keeper_with_project(tmp_path, cloud)
    with pytest.raises(RuleError) as other:
        await keeper.use_project(OTHER_PROJECT)
    assert other.value.code == "other_project"
    assert "keluarga-contoh" in other.value.message

    await keeper.use_project(SAME_PROJECT)  # a new client, in the same project
    status = await keeper.status()
    assert (status.setup, status.project) == ("keeper", "keluarga-contoh")
    assert status.email is None  # a sign-in belongs to the client it was made with
    signed_in(keeper, KEEPER)
    await keeper.sync()
    assert (await keeper.status()).problem == ""


async def test_a_relative_joins_with_the_invitation(tmp_path: Path, cloud: Cloud) -> None:
    keeper, ours = await keeper_with_project(tmp_path, cloud)
    await keeper.invite(Invite(email=RELATIVE))
    invitation = keeper.invitation()
    assert invitation.client.project == "keluarga-contoh"
    assert "Keluarga" not in invitation.text()  # nothing of the family's own

    theirs = Family(tmp_path / "relative-data")
    relative = fresh(cloud, theirs)
    text = invitation.text()
    # As a message app may break it across lines, with words around it.
    await relative.take_invitation(f"Join us in AncesTree! Paste this:\n{text[:40]}\n{text[40:]}")
    status = await relative.status()
    assert (status.invited, status.project, status.project_invited) == (
        True,
        "keluarga-contoh",
        True,
    )
    assert fresh(cloud, theirs).invited == family_of(keeper)  # kept across a restart
    signed_in(relative, RELATIVE)
    await relative.join(JoinFamily(computer="Mak Long's laptop"))
    status = await relative.status()
    assert (status.setup, status.role, status.invited) == ("member", "waiting", False)

    await keeper.sync()
    [asking] = (await keeper.status()).asking
    assert (asking.name, asking.email) == ("Mak Long's laptop", RELATIVE)
    await keeper.admit(Admit(device=asking.device, role="viewer"))
    await relative.sync()
    assert [restore["graph"] for restore in theirs.restores] == [ours.graph]


async def test_an_invitation_says_so_until_the_folder_is_shared(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _ = await keeper_with_project(tmp_path, cloud)
    relative = fresh(cloud, Family(tmp_path / "relative-data"))
    await relative.take_invitation(keeper.invitation().text())
    signed_in(relative, RELATIVE)
    with pytest.raises(RuleError) as not_yet:
        await relative.join(JoinFamily(computer="Mak Long's laptop"))
    assert not_yet.value.code == "not_shared_yet"
    assert RELATIVE in not_yet.value.message
    assert (await relative.status()).invited  # still waiting to ask

    await keeper.invite(Invite(email=RELATIVE))
    await relative.join(JoinFamily(computer="Mak Long's laptop"))
    assert (await relative.status()).role == "waiting"


async def test_what_isnt_an_invitation_is_said_plainly(tmp_path: Path, cloud: Cloud) -> None:
    keeper, _ = await keeper_with_project(tmp_path, cloud)
    relative = fresh(cloud, Family(tmp_path / "relative-data"))
    whole = keeper.invitation().text()
    for pasted, says in (
        ("Hello!", "isn't an AncesTree invitation"),
        (whole[:30] + whole[36:], "isn't whole"),  # a piece lost on the way
    ):
        with pytest.raises(RuleError) as refused:
            await relative.take_invitation(pasted)
        assert refused.value.code == "not_an_invitation"
        assert says in refused.value.message
    assert relative.client is None


async def test_invitations_are_for_relatives_and_for_one_family(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _ = await keeper_with_project(tmp_path, cloud)
    others, _ = await keeper_with_project(tmp_path, cloud, "another-family", "other@example.com")
    with pytest.raises(RuleError) as own:
        await keeper.take_invitation(others.invitation().text())
    assert own.value.code == "keepers_own"

    await keeper.invite(Invite(email=RELATIVE))
    relative = fresh(cloud, Family(tmp_path / "relative-data"))
    await relative.take_invitation(keeper.invitation().text())
    signed_in(relative, RELATIVE)
    await relative.join(JoinFamily(computer="Mak Long's laptop"))
    with pytest.raises(RuleError) as another:
        await relative.take_invitation(others.invitation().text())
    assert another.value.code == "another_family"

    with pytest.raises(RuleError) as theirs:
        await relative.use_project(OTHER_PROJECT)
    assert theirs.value.code == "project_from_the_keeper"
    # A newer invitation to the same family brings its new project: sign in again.
    newer = Client.from_file(SAME_PROJECT)
    await relative.take_invitation(Invitation(newer, family_of(keeper)).text())
    assert relative.client is not None
    assert relative.client.client_id == newer.client_id
    assert (await relative.status()).email is None


async def test_a_relative_cant_start_a_family_folder_through_the_keepers_project(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _ = await keeper_with_project(tmp_path, cloud)
    relative = fresh(cloud, Family(tmp_path / "relative-data", made_up_graph()))
    await relative.take_invitation(keeper.invitation().text())
    signed_in(relative, RELATIVE)
    with pytest.raises(RuleError) as refused:
        await relative.start(StartFamily(family="Keluarga Kami", computer="Laptop"))
    assert refused.value.code == "project_from_an_invitation"

    await relative.use_project(OTHER_PROJECT)  # their own family's project instead
    signed_in(relative, RELATIVE)
    await relative.start(StartFamily(family="Keluarga Kami", computer="Laptop"))
    status = await relative.status()
    assert (status.setup, status.project, status.invited) == ("keeper", "keluarga-lain", False)


async def test_a_computer_of_the_keepers_own_joins_with_the_keepers_account(
    tmp_path: Path, cloud: Cloud
) -> None:
    """No second Google account for the keeper's own laptop or Mac: it joins with the keeper's,
    and keeps its own folder in the keeper's Drive."""
    keeper, ours = await keeper_with_project(tmp_path, cloud)
    assert keeper.setup is not None
    await keeper.invite(Invite(email=KEEPER.upper()))  # the keeper's own: nothing to share
    assert cloud.items[keeper.setup.folder].shared == {}

    mac = Family(tmp_path / "keepers-mac")
    second = fresh(cloud, mac)
    await second.take_invitation(keeper.invitation().text())
    signed_in(second, KEEPER)
    await second.join(JoinFamily(computer="Pak Hassan's Mac"))
    assert second.setup is not None
    own = cloud.items[second.setup.own_folder]
    assert (own.owner, own.shared) == (KEEPER, {})

    await keeper.sync()
    [asking] = (await keeper.status()).asking
    assert (asking.name, asking.email) == ("Pak Hassan's Mac", KEEPER)
    await keeper.admit(Admit(device=asking.device, role="trusted"))
    await second.sync()
    assert [restore["graph"] for restore in mac.restores] == [ours.graph]
    in_the_family_folder = [
        cloud.path(item.id)
        for item in cloud.items.values()
        if cloud.inside(item, keeper.setup.folder)
    ]
    assert not [path for path in in_the_family_folder if "/join/" in path or "/inbox/" in path]

    await keeper.remove(OneComputer(device=asking.device))
    assert keeper.setup.unshare == []  # the keeper's own account is never unshared from


async def test_two_families_with_one_keeper_never_mix_their_computers(
    tmp_path: Path, cloud: Cloud
) -> None:
    """A keeper of two families, both in one Google account, and a relative in both: each
    family's keeper sees that family's computer alone."""
    fathers, _ = await keeper_with_project(tmp_path, cloud, "fathers-side")
    mothers = fresh(cloud, Family(tmp_path / "mothers-side", made_up_graph()))
    await mothers.use_project(OUR_PROJECT)
    signed_in(mothers, KEEPER)
    await mothers.start(
        StartFamily(family="Keluarga Ibu", computer="Pak Hassan's PC", another=True)
    )
    devices: dict[str, str] = {}
    for keeper, name in ((fathers, "For the father's side"), (mothers, "For the mother's side")):
        await keeper.invite(Invite(email=RELATIVE))
        relative = fresh(cloud, Family(tmp_path / name))
        await relative.take_invitation(keeper.invitation().text())
        signed_in(relative, RELATIVE)
        await relative.join(JoinFamily(computer=name))
        assert relative.computer is not None
        devices[family_of(keeper)] = relative.computer.device
    for keeper in (fathers, mothers):
        await keeper.sync()
        asking = [ask.device for ask in (await keeper.status()).asking]
        assert asking == [devices[family_of(keeper)]]
        others = [device for family, device in devices.items() if family != family_of(keeper)]
        assert not [
            device for device in others if (keeper.local / "join" / f"{device}.req").exists()
        ]


async def test_the_recovery_code_finds_its_family_among_several(
    tmp_path: Path, cloud: Cloud
) -> None:
    await keeper_with_project(tmp_path, cloud, "fathers-side")
    mothers = fresh(cloud, Family(tmp_path / "mothers-side", made_up_graph()))
    await mothers.use_project(OUR_PROJECT)
    signed_in(mothers, KEEPER)
    code = await mothers.start(
        StartFamily(family="Keluarga Ibu", computer="Pak Hassan's PC", another=True)
    )
    assert mothers.setup is not None

    again = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "new-computer"))
    with pytest.raises(RuleError) as wrong:
        await again.recover(Recover(code="AAAA BBBB CCCC DDDD EEEE FFFF GG"))
    assert wrong.value.code == "not_recovered"
    await again.recover(Recover(code=code))
    assert again.setup is not None
    assert again.setup.folder == mothers.setup.folder
    assert (await again.status()).family == "Keluarga Ibu"


async def test_leaving_keeps_the_keepers_own_project_and_not_a_relatives(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours = await keeper_with_project(tmp_path, cloud)
    await keeper.invite(Invite(email=RELATIVE))
    theirs = Family(tmp_path / "relative-data")
    relative = fresh(cloud, theirs)
    await relative.take_invitation(keeper.invitation().text())
    signed_in(relative, RELATIVE)
    await relative.join(JoinFamily(computer="Mak Long's laptop"))
    await relative.leave()
    assert relative.client is None
    assert fresh(cloud, theirs).client is None  # the keeper's project went with the rest

    kept = ours.data_dir / "familyfolder" / "computer" / "computer.bin"
    kept.write_bytes(b"AncesTree protected 1\nanother computer's")  # its part can't be opened
    broken = fresh(cloud, ours)
    assert (await broken.status()).broken
    await broken.leave()
    assert (await fresh(cloud, ours).status()).project == "keluarga-contoh"  # the keeper's own


async def test_a_folder_named_before_0_4_0_is_read_for_a_computer_already_known(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, _, device = await admitted(tmp_path, cloud, role="viewer")
    assert relative.setup is not None
    own = cloud.items[relative.setup.own_folder]
    own.name = f"{OWN_FOLDER} ({device})"  # as computers named it before 0.4.0
    request = keeper.local / "join" / f"{device}.req"
    request.unlink()
    for state in (keeper.dir / "relatives").glob(f"{device}-*.json"):
        state.unlink()
    await keeper.sync()
    assert request.is_file()  # read again: this family knows the computer

    stranger = "0123456789abcdef"  # an old name, from an account invited, but a computer unknown
    relatives_drive = cloud.as_account(RELATIVE)
    lookalike = relatives_drive.create_folder(f"{OWN_FOLDER} ({stranger})", None)
    join = relatives_drive.create_folder("join", lookalike.id)
    relatives_drive.upload(f"{stranger}.req", join.id, b"let me in")
    relatives_drive.share(lookalike.id, KEEPER)
    await keeper.sync()
    assert not (keeper.local / "join" / f"{stranger}.req").exists()


# --- The family folder rebuilt, and relatives following it (0.4.0) -----------------------------


async def joined_by_invitation(
    tmp_path: Path, cloud: Cloud, role: str = "contributor"
) -> tuple[FamilyFolder, Family, FamilyFolder, Family]:
    """A keeper with the family's own project, and a relative let in with the invitation."""
    keeper, ours = await keeper_with_project(tmp_path, cloud)
    await keeper.invite(Invite(email=RELATIVE))
    theirs = Family(tmp_path / "relative-data")
    relative = fresh(cloud, theirs)
    await relative.take_invitation(keeper.invitation().text())
    signed_in(relative, RELATIVE)
    await relative.join(JoinFamily(computer="Mak Long's laptop"))
    await keeper.sync()
    [asking] = (await keeper.status()).asking
    await keeper.admit(Admit(device=asking.device, role=role))  # type: ignore[arg-type]
    await relative.sync()
    return keeper, ours, relative, theirs


async def test_a_family_folder_lost_from_drive_is_rebuilt_and_relatives_follow(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, relative, theirs = await joined_by_invitation(tmp_path, cloud)
    assert keeper.setup is not None
    assert relative.setup is not None
    lost = keeper.setup.folder
    cloud.as_account(KEEPER).delete(lost)  # gone for good: past the bin's 30 days, say
    await keeper.sync()
    status = await keeper.status()
    assert (status.lost, status.problem) == (True, LOST)
    await relative.sync()
    assert (await relative.status()).problem == LOST_RELATIVE  # nothing to follow yet

    await keeper.rebuild()
    rebuilt = keeper.setup.folder
    assert rebuilt != lost
    assert cloud.path(rebuilt) == folder_name(keeper)
    assert cloud.items[rebuilt].shared == {RELATIVE: "reader"}  # shared again
    assert (await keeper.status()).lost is False
    record = [
        item
        for item in cloud.items.values()
        if cloud.inside(item, rebuilt) and "/record/" in cloud.path(item.id)
    ]
    assert record  # the record as it was, every change set

    await relative.sync()
    assert relative.setup.folder == rebuilt  # followed, by itself
    assert (await relative.status()).problem == ""
    someone(ours.graph, HASSAN)["nickname"] = "Tok Hassan"  # the keeper changes on
    await keeper.sync()
    await relative.sync()
    assert someone(theirs.restores[-1]["graph"], HASSAN)["nickname"] == "Tok Hassan"

    someone(theirs.graph, SITI)["nickname"] = "Mak Siti"  # and the relative's reach the keeper
    await relative.sync()
    await keeper.sync()
    assert [changes.name for changes in (await keeper.status()).changes] == ["Mak Long's laptop"]


async def test_a_folder_that_only_looks_like_the_familys_isnt_followed(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, _ = await joined_by_invitation(tmp_path, cloud)
    assert keeper.setup is not None
    assert relative.setup is not None
    family_json = next(
        item for item in cloud.items.values() if cloud.path(item.id).endswith("/family.json")
    )
    stranger = cloud.as_account("stranger@example.com")
    fake = stranger.create_folder(folder_name(keeper), None)
    found = json.loads(family_json.data)
    found["keeper_sign"] = "00" * 32  # another keeper's key
    stranger.upload("family.json", fake.id, json.dumps(found).encode())
    stranger.share(fake.id, RELATIVE)
    cloud.as_account(KEEPER).delete(keeper.setup.folder)
    lost = relative.setup.folder
    await relative.sync()
    assert relative.setup.folder == lost  # not followed: not signed by the family's keeper
    assert (await relative.status()).problem == LOST_RELATIVE


async def test_the_family_folder_moves_to_another_google_account(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs = await joined_by_invitation(tmp_path, cloud)
    assert keeper.setup is not None
    assert relative.setup is not None
    old = keeper.setup.folder
    url = await keeper.move_account()
    assert url.startswith("https://accounts.google.com/")
    assert keeper.signing_in is not None
    keeper.signing_in.close()
    keeper.signing_in = None
    assert (await keeper.status()).moving
    signed_in(keeper, "new.keeper@example.com")  # as Google's page would leave it
    await keeper.rebuild()
    moved = keeper.setup.folder
    assert cloud.items[moved].owner == "new.keeper@example.com"
    assert old in cloud.binned  # binned by the account that had it: relatives find it gone
    assert keeper.setup.account == "new.keeper@example.com"
    assert (await keeper.status()).old_folder_left is False

    await relative.sync()
    assert relative.setup.folder == moved
    own = cloud.items[relative.setup.own_folder]
    assert "new.keeper@example.com" in own.shared  # its changes reach the new account
    someone(theirs.graph, SITI)["nickname"] = "Mak Siti"
    await relative.sync()
    await keeper.sync()
    assert [changes.name for changes in (await keeper.status()).changes] == ["Mak Long's laptop"]


async def test_the_family_folder_moves_to_another_google_project(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs = await joined_by_invitation(tmp_path, cloud)
    assert keeper.setup is not None
    assert relative.setup is not None
    old_own = relative.setup.own_folder
    await keeper.use_project(OTHER_PROJECT, moving=True)
    assert (await keeper.status()).project == "keluarga-lain"
    signed_in(keeper, KEEPER)
    await keeper.rebuild()
    assert keeper.setup.folder in cloud.items
    await relative.sync()  # followed, still through the old project, while its client lasts
    assert relative.setup.folder == keeper.setup.folder

    await relative.take_invitation(keeper.invitation().text())  # the new project
    assert relative.client is not None
    assert relative.client.project == "keluarga-lain"
    signed_in(relative, RELATIVE)
    await relative.sync()
    new_own = relative.setup.own_folder
    assert new_own not in ("", old_own)  # the new project's client writes in a new own folder
    assert cloud.items[new_own].shared == {KEEPER: "reader"}
    someone(theirs.graph, SITI)["nickname"] = "Mak Siti"
    await relative.sync()
    await keeper.sync()
    assert [changes.name for changes in (await keeper.status()).changes] == ["Mak Long's laptop"]


async def test_an_old_folder_left_in_drive_is_said_until_its_deleted(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, _, _ = await joined_by_invitation(tmp_path, cloud)
    assert keeper.setup is not None

    def refused(_: str) -> None:
        raise DriveError(403, "The user does not have sufficient permissions for this file.")

    await keeper.use_project(OTHER_PROJECT, moving=True)
    signed_in(keeper, KEEPER)
    before = keeper._before
    assert before is not None
    real = keeper._make_drive

    def drives(session: Any) -> Any:
        drive = real(session)
        if session is before:
            drive.trash = refused  # type: ignore[method-assign, assignment]  # the old client, gone
        return drive

    keeper._make_drive = drives
    await keeper.rebuild()
    status = await keeper.status()
    assert status.old_folder_left
    assert "old folder is still in Google Drive" in status.problem
    keeper.old_folder_deleted()
    await keeper.sync()
    status = await keeper.status()
    assert (status.old_folder_left, status.problem) == (False, "")


# --- Keeping in step, shown (0.4.0) ---------------------------------------------------------


async def test_when_the_family_was_last_in_step_is_kept_across_a_restart(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours, _, theirs = await joined_by_invitation(tmp_path, cloud)
    status = await keeper.status()
    assert status.through
    assert status.trouble == ""
    assert status.last_sync is not None
    assert status.published is not None  # the keeper's change sets went out

    again = fresh(cloud, ours)  # the app started again: no round yet
    assert (await again.status()).last_sync == status.last_sync.replace(microsecond=0)
    assert (await fresh(cloud, theirs).status()).last_sync is not None


async def test_each_round_is_told_and_says_what_stood_in_its_way(
    tmp_path: Path, cloud: Cloud
) -> None:
    heard: list[tuple[bool, str]] = []
    keeper, _ = await keeper_with_project(tmp_path, cloud)
    keeper._on_round = lambda folder: heard.append((folder.went_through, folder.trouble))
    await keeper.sync()
    cloud.offline = True
    await keeper.sync()
    cloud.offline = False
    keeper._on_round = lambda _: (_ for _ in ()).throw(RuntimeError("a listener's own fault"))
    await keeper.sync()  # a listener's failure never stops a round
    assert heard == [(True, ""), (False, "offline")]
    assert (await keeper.status()).through


async def test_a_change_here_brings_a_round_soon_and_sync_now_at_once(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, ours = await keeper_with_project(tmp_path, cloud)
    rounds: list[float] = []
    real = keeper._round

    async def counted() -> None:
        rounds.append(asyncio.get_running_loop().time())
        await real()

    keeper._round = counted  # type: ignore[method-assign]
    keeping = asyncio.create_task(keep_in_step(keeper, every=3600, soon=0.05))
    try:
        for _ in range(200):  # the first, a few seconds after the start
            if rounds:
                break
            await asyncio.sleep(0.1)
        someone(ours.graph, HASSAN)["nickname"] = "Tok Hassan"
        keeper.nudge()  # as the app does after a change
        for _ in range(100):
            if len(rounds) >= 2:
                break
            await asyncio.sleep(0.05)
        assert len(rounds) == 2  # soon, not within the hour

        await asyncio.to_thread(keeper.sync_soon)  # Sync now, from the icon by the clock
        for _ in range(100):
            if len(rounds) >= 3:
                break
            await asyncio.sleep(0.05)
        assert len(rounds) == 3
    finally:
        keeping.cancel()


async def test_a_last_round_before_closing_sends_what_could_go(
    tmp_path: Path, cloud: Cloud
) -> None:
    keeper, _, relative, theirs = await joined_by_invitation(tmp_path, cloud)
    someone(theirs.graph, SITI)["nickname"] = "Mak Siti"
    await relative.last_round()
    await keeper.sync()
    assert [changes.name for changes in (await keeper.status()).changes] == ["Mak Long's laptop"]
    alone = fresh(cloud, Family(tmp_path / "no-family-folder"))
    await alone.last_round()  # no family folder: nothing to do, quickly


async def test_a_family_folder_made_through_another_project_is_offered_a_rebuild(
    tmp_path: Path, cloud: Cloud
) -> None:
    """A keeper on 0.3.x, through the client AncesTree carried, giving the family its own project:
    the new project can read the folder, not change it, as Drive says (0.4.0)."""
    keeper, ours, relative, _ = await joined_by_invitation(tmp_path, cloud)
    assert keeper.setup is not None
    assert relative.setup is not None
    old = keeper.setup.folder

    def not_this_projects(*_: object) -> None:
        raise DriveError(
            403,
            "The user has not granted the app 1234 write access to the file.",
            NOT_THIS_PROJECTS,
        )

    keeper.mirror.drive.replace = not_this_projects  # type: ignore[union-attr, method-assign]
    keeper.mirror.drive.upload = not_this_projects  # type: ignore[union-attr, method-assign]
    someone(ours.graph, HASSAN)["nickname"] = "Tok Hassan"
    await keeper.sync()
    status = await keeper.status()
    assert (status.lost, status.trouble, status.problem) == (True, "foreign", FOREIGN)

    signed_in(keeper, KEEPER)  # a drive of the family's own project
    await keeper.rebuild()
    assert keeper.setup.folder != old
    assert (await keeper.status()).trouble == ""
    await relative.sync()
    assert relative.setup.folder == keeper.setup.folder  # followed
