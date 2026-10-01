"""The family folder's copy on each computer, kept in step with Google Drive, through a
stand-in for Drive's API."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from ancestree.familyfolder import mirror as mirror_module
from ancestree.familyfolder.drive import DriveError
from ancestree.familyfolder.google import OfflineError
from ancestree.familyfolder.mirror import Mirror
from tests.fake_drive import Cloud

KEEPER = "keeper@example.com"
RELATIVE = "relative@example.com"


@pytest.fixture
def cloud() -> Cloud:
    return Cloud()


def two_computers(cloud: Cloud, tmp_path: Path) -> tuple[Mirror, Mirror, str]:
    keeper_drive = cloud.as_account(KEEPER)
    root = keeper_drive.create_folder("AncesTree family", None).id
    # Shared to edit, as Drive's own page can: two accounts writing in one folder.
    keeper_drive.share(root, RELATIVE, role="writer")
    ours = Mirror(keeper_drive, root, tmp_path / "keeper", tmp_path / "keeper.json", KEEPER)
    theirs = Mirror(
        cloud.as_account(RELATIVE),
        root,
        tmp_path / "relative",
        tmp_path / "relative.json",
        RELATIVE,
    )
    return ours, theirs, root


def write(folder: Path, relative: str, data: bytes) -> None:
    path = folder / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_files_written_on_one_computer_reach_the_other(cloud: Cloud, tmp_path: Path) -> None:
    ours, theirs, _ = two_computers(cloud, tmp_path)
    write(ours.local, "family.json", b"{}")
    write(ours.local, "record/00000001-abcd.chg", b"change one")
    assert ours.push() == 2
    assert theirs.pull() == 2
    assert (theirs.local / "record/00000001-abcd.chg").read_bytes() == b"change one"
    assert theirs.owner("record/00000001-abcd.chg") == KEEPER

    write(theirs.local, "join/device1.req", b"may I join")
    assert theirs.push() == 1
    assert ours.pull() == 1
    assert (ours.local / "join/device1.req").read_bytes() == b"may I join"
    assert ours.owner("join/device1.req") == RELATIVE


def test_nothing_is_sent_or_fetched_twice(cloud: Cloud, tmp_path: Path) -> None:
    ours, theirs, _ = two_computers(cloud, tmp_path)
    write(ours.local, "snapshots/00000003-ef01.snap", b"the whole family")
    assert ours.push() == 1
    assert ours.push() == 0
    assert ours.pull() == 0  # its own file, known already
    assert theirs.pull() == 1
    assert theirs.pull() == 0
    reloaded = Mirror(
        cloud.as_account(RELATIVE), theirs.root, theirs.local, tmp_path / "relative.json"
    )
    assert reloaded.pull() == 0  # what it knows survives a restart


def test_a_file_written_again_here_goes_up_as_new_contents(cloud: Cloud, tmp_path: Path) -> None:
    ours, theirs, _ = two_computers(cloud, tmp_path)
    write(ours.local, "record/00000001-abcd.chg", b"original")
    ours.push()
    before = {item.id for item in cloud.items.values()}
    write(ours.local, "record/00000001-abcd.chg", b"put back")
    assert ours.push() == 1
    assert {item.id for item in cloud.items.values()} == before  # the same file, not a second
    theirs.pull()
    assert (theirs.local / "record/00000001-abcd.chg").read_bytes() == b"put back"


def test_a_file_changed_in_drive_comes_down_again(cloud: Cloud, tmp_path: Path) -> None:
    ours, theirs, _ = two_computers(cloud, tmp_path)
    write(ours.local, "record/00000001-abcd.chg", b"original")
    ours.push()
    theirs.pull()
    cloud.as_account(RELATIVE).tamper(
        cloud.find("AncesTree family/record/00000001-abcd.chg").id, b"x"
    )
    assert ours.pull() == 1
    assert (ours.local / "record/00000001-abcd.chg").read_bytes() == b"x"


def test_someone_elses_file_changed_here_is_never_sent(cloud: Cloud, tmp_path: Path) -> None:
    ours, theirs, _ = two_computers(cloud, tmp_path)
    write(ours.local, "family.json", b"keeper's")
    ours.push()
    theirs.pull()
    write(theirs.local, "family.json", b"changed on the relative's computer")
    assert theirs.push() == 0
    assert cloud.find("AncesTree family/family.json").data == b"keeper's"


def test_a_file_gone_from_drive_goes_from_here_after_a_while(
    cloud: Cloud, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ours, theirs, _ = two_computers(cloud, tmp_path)
    write(ours.local, "files/abcd.bin", b"a photo")
    ours.push()
    theirs.pull()
    cloud.as_account(KEEPER).delete(cloud.find("AncesTree family/files/abcd.bin").id)
    theirs.pull()
    assert (theirs.local / "files/abcd.bin").exists()  # not yet: it may be just slow to list
    monkeypatch.setattr(mirror_module, "GONE_AFTER", 0.0)
    theirs.pull()
    assert not (theirs.local / "files/abcd.bin").exists()


def test_a_connection_lost_midway_sends_nothing_twice(cloud: Cloud, tmp_path: Path) -> None:
    ours, _, _ = two_computers(cloud, tmp_path)
    for n in range(5):
        write(ours.local, f"files/{n}.bin", bytes([n]) * 10)
    uploads = 0
    original = ours.drive.upload

    def flaky(name: str, parent: str, data: bytes):  # type: ignore[no-untyped-def]
        nonlocal uploads
        uploads += 1
        if uploads == 3:
            raise OfflineError("the connection dropped")
        return original(name, parent, data)

    ours.drive.upload = flaky  # type: ignore[method-assign]
    with pytest.raises(OfflineError):
        ours.push()
    ours.drive.upload = original  # type: ignore[method-assign]
    assert ours.push() == 3
    files = [item for item in cloud.items.values() if not item.folder]
    assert sorted(item.name for item in files) == [f"{n}.bin" for n in range(5)]


def test_folders_are_made_as_needed_and_read_as_one(cloud: Cloud, tmp_path: Path) -> None:
    ours, theirs, root = two_computers(cloud, tmp_path)
    write(ours.local, "members/device1/000001.mem", b"a place")
    ours.push()
    # Another computer made a folder of the same name: its files are read with the others.
    relative_drive = cloud.as_account(RELATIVE)
    second = relative_drive.create_folder("members", root)
    inner = relative_drive.create_folder("device2", second.id)
    relative_drive.upload("000001.mem", inner.id, b"another place")
    ours.pull()
    assert (ours.local / "members/device2/000001.mem").read_bytes() == b"another place"
    theirs.pull()
    assert (theirs.local / "members/device1/000001.mem").exists()


def test_offline_changes_nothing_here(cloud: Cloud, tmp_path: Path) -> None:
    ours, _, _ = two_computers(cloud, tmp_path)
    write(ours.local, "family.json", b"{}")
    cloud.offline = True
    with pytest.raises(OfflineError):
        ours.push()
    with pytest.raises(OfflineError):
        ours.pull()
    cloud.offline = False
    assert ours.push() == 1


def test_a_folder_no_longer_shared_is_said_and_the_copy_here_stays(
    cloud: Cloud, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ours, theirs, root = two_computers(cloud, tmp_path)
    write(ours.local, "family.json", b"{}")
    ours.push()
    theirs.pull()
    cloud.as_account(KEEPER).unshare(root, RELATIVE)
    assert cloud.as_account(RELATIVE).children(root) == []  # as Drive lists it: just empty
    monkeypatch.setattr(mirror_module, "GONE_AFTER", 0.0)
    for _ in range(2):  # twice: an empty listing would have taken the copy here away
        with pytest.raises(DriveError) as raised:
            theirs.pull()
        assert raised.value.status == 404
    assert (theirs.local / "family.json").read_bytes() == b"{}"


def test_a_file_written_again_within_the_same_tick_still_goes_up(
    cloud: Cloud, tmp_path: Path
) -> None:
    ours, _, _ = two_computers(cloud, tmp_path)
    write(ours.local, "record/00000001-abcd.chg", b"original")
    path = ours.local / "record/00000001-abcd.chg"
    ours.push()
    first = path.stat()
    write(ours.local, "record/00000001-abcd.chg", b"tampered")  # the same size
    os.utime(path, ns=(first.st_atime_ns, first.st_mtime_ns))  # and, as by the clock, time
    assert ours.push() == 1
    assert cloud.find("AncesTree family/record/00000001-abcd.chg").data == b"tampered"
