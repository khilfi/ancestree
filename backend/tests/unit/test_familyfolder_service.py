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
    StartFamily,
)
from ancestree.familyfolder.computers import Keeper, Member
from ancestree.familyfolder.google import Client, SignedOutError, Tokens
from ancestree.services.context import Context, RuleError
from ancestree.services.familyfolder import FOLDER_NAME, OWN_FOLDER, FamilyFolder
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
        """As a restore would: the archive's graph and its people's and settings' files."""
        with ZipFile(archive) as opened:
            graph = json.loads(opened.read("graph.json"))
            files = {
                name: opened.read(name)
                for name in opened.namelist()
                if name.startswith(("people/", "settings/"))
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
    _, ours, _, _, _ = await two_computers(tmp_path, cloud)
    again = computer(tmp_path, cloud, KEEPER, ours)
    status = await again.status()
    assert (status.setup, status.role, status.family) == ("keeper", "keeper", "Keluarga Contoh")
    assert status.recovery_code is None  # shown once, never kept
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
