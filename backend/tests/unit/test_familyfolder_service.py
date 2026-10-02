"""The family folder in the app: the keeper's computer and a relative's, kept in step
through a stand-in for Google Drive. The database stands aside: each computer's family is a
made-up graph, and what a restore would put in its place is kept to look at. Names are the
fictional family's."""

from __future__ import annotations

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
from ancestree.familyfolder.google import Client, SignedOutError, Tokens
from ancestree.familyfolder.mirror import Mirror
from ancestree.services.context import Context, NotFoundError, RuleError
from ancestree.services.familyfolder import (
    FOLDER_NAME,
    OWN_FOLDER,
    REPLACED,
    UNREADABLE,
    FamilyFolder,
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
    assert cloud.path(folder) == FOLDER_NAME
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
    assert (own.name, own.owner, own.parent) == (f"{OWN_FOLDER} ({asking.device})", RELATIVE, None)
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
    assert recovery == [f"{FOLDER_NAME}/recovery/000002.bin"]
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


async def test_one_family_folder_to_a_google_account(tmp_path: Path, cloud: Cloud) -> None:
    keeper = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "keeper-data", made_up_graph()))
    await keeper.start(StartFamily(family="Keluarga Contoh", computer="Pak Hassan's PC"))
    another = computer(tmp_path, cloud, KEEPER, Family(tmp_path / "another-computer"))
    with pytest.raises(RuleError) as refused:
        await another.start(StartFamily(family="Keluarga Contoh", computer="Laptop"))
    assert refused.value.code == "family_folder_exists"
    assert [item.name for item in cloud.items.values()].count(FOLDER_NAME) == 1


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
