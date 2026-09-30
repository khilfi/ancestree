"""The family folder: computers kept in step through one shared folder.

`Drive` stands in for Google Drive: each computer has its own copy of the folder, and a
sync copies what's new, late, in any order, and sometimes half a file before the rest.
Names are the fictional family's.
"""

from __future__ import annotations

import random
import shutil
from pathlib import Path

import pytest

from ancestree.familyfolder.computers import Keeper, Member
from ancestree.familyfolder.models import Delete, Put
from ancestree.familyfolder.seals import Kind, RefusedError, seal


class Drive:
    """Every computer's copy of one folder, and the service's own copy between them."""

    def __init__(self, root: Path, names: list[str], seed: int = 7) -> None:
        self.root = root
        self.copies: dict[str, Path] = {}
        self.cloud: dict[str, bytes] = {}
        self.synced: dict[str, dict[str, bytes]] = {}
        self.half: set[tuple[str, str]] = set()
        self.rng = random.Random(seed)  # noqa: S311 - a made-up sync order, not a secret
        for name in names:
            self.add(name)

    def add(self, name: str) -> Path:
        self.copies[name] = self.root / f"{name}-copy"
        self.copies[name].mkdir(parents=True)
        self.synced[name] = {}
        return self.copies[name]

    def _files(self, copy: Path) -> dict[str, bytes]:
        return {
            path.relative_to(copy).as_posix(): path.read_bytes()
            for path in copy.rglob("*")
            if path.is_file() and not path.name.endswith(".part")
        }

    def sync(self, *, halves: bool = False) -> None:
        # Up: what each computer changed, added or took away since its last sync.
        for name, copy in self.copies.items():
            here = self._files(copy)
            for relative, data in here.items():
                if (name, relative) not in self.half and self.synced[name].get(relative) != data:
                    self.cloud[relative] = data
                    self.synced[name][relative] = data
            for relative in list(self.synced[name]):
                if relative not in here and (name, relative) not in self.half:
                    self.cloud.pop(relative, None)
                    del self.synced[name][relative]
        # Down: what's new in the service, in any order, a file sometimes only half there.
        for name, copy in self.copies.items():
            waiting = [r for r, data in self.cloud.items() if self.synced[name].get(r) != data]
            self.rng.shuffle(waiting)
            for relative in waiting:
                path = copy / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                data = self.cloud[relative]
                if halves and (name, relative) not in self.half and self.rng.random() < 0.3:
                    path.write_bytes(data[: len(data) // 2])
                    self.half.add((name, relative))
                    continue
                path.write_bytes(data)
                self.synced[name][relative] = data
                self.half.discard((name, relative))
            for relative in [r for r in self.synced[name] if r not in self.cloud]:
                (copy / relative).unlink(missing_ok=True)
                del self.synced[name][relative]


def person(key: str, **data: object) -> Put:
    return Put(id=key, data={"full_name": key, **data})


@pytest.fixture
def drive(tmp_path: Path) -> Drive:
    return Drive(tmp_path, ["keeper", "salmah", "zul"])


@pytest.fixture
def keeper(drive: Drive, tmp_path: Path) -> Keeper:
    keeper, _ = Keeper.start(drive.copies["keeper"], tmp_path / "keeper-data", "Hassan")
    return keeper


def join(drive: Drive, keeper: Keeper, name: str, role: str = "contributor") -> Member:
    drive.sync()
    member, code = Member.ask_to_join(drive.copies[name], drive.root / f"{name}-data", name.title())
    drive.sync()
    (ask,) = [ask for ask in keeper.asking() if ask.device == member.device]
    assert ask.code == code  # what the two owners read to each other on the phone
    assert ask.name == name.title()
    keeper.admit(ask, role)  # type: ignore[arg-type]
    drive.sync()
    member.receive()
    return member


def test_a_relative_joins_and_receives_the_family(drive: Drive, keeper: Keeper) -> None:
    keeper.publish([person("Hassan bin Ismail", born=1938)])
    salmah = join(drive, keeper, "salmah")

    assert salmah.role == "contributor"
    assert salmah.state == keeper.state
    assert salmah.state["people"]["Hassan bin Ismail"]["born"] == 1938
    names = {m["name"] for m in salmah.state["members"].values()}
    assert names == {"Hassan", "Salmah"}


def test_a_family_file_switched_before_joining_shows_on_the_phone(
    drive: Drive, keeper: Keeper, tmp_path: Path
) -> None:
    impostor_folder = tmp_path / "impostor"
    Keeper.start(impostor_folder, tmp_path / "impostor-data", "Someone")
    drive.sync()
    salmah_copy = drive.copies["salmah"]
    shutil.copy(impostor_folder / "family.json", salmah_copy / "family.json")

    salmah, code = Member.ask_to_join(salmah_copy, tmp_path / "salmah-data", "Salmah")
    drive.sync()

    # The real keeper can't read her request: it was locked for the impostor's key...
    assert all(ask.device != salmah.device for ask in keeper.asking())
    assert any(path.startswith("join/") for path in keeper.suspect)
    # ...and no code on the keeper's screen matches the one she reads out.
    assert code not in {ask.code for ask in keeper.asking()}


def test_a_proposal_reaches_the_keeper_and_what_is_taken_comes_back(
    drive: Drive, keeper: Keeper
) -> None:
    salmah = join(drive, keeper, "salmah")
    salmah.send([person("Aminah binti Hassan", born=1962), person("Karim bin Hassan")])
    assert list(salmah.waiting) == [1]  # shown at once on her computer, waiting
    drive.sync()

    (arrived,) = keeper.inbox()
    assert arrived.name == "Salmah"
    keeper.decide(arrived, taken=[0], note="Karim: a source for him first, please")
    assert keeper.inbox() == []
    drive.sync()
    salmah.receive()

    assert "Aminah binti Hassan" in salmah.state["people"]
    assert "Karim bin Hassan" not in salmah.state["people"]
    assert salmah.waiting == {}
    assert salmah.answers[1].left == [1]
    assert salmah.answers[1].note.startswith("Karim")


def test_a_trusted_computers_changes_go_through_unless_they_clash(
    drive: Drive, keeper: Keeper
) -> None:
    keeper.publish([person("Nor binti Hassan")])
    zul = join(drive, keeper, "zul", role="trusted")
    zul.send([person("Zulkifli bin Hassan", nickname="Zul")])
    keeper.publish([person("Nor binti Hassan", born=1968)])  # changed by the keeper meanwhile
    zul.send([person("Nor binti Hassan", born=1969)])  # made before he saw that: a clash
    zul.send([Delete(id="Zulkifli bin Hassan")])  # taking something out waits too
    drive.sync()

    published = keeper.approve_trusted()

    assert len(published) == 1
    assert keeper.state["people"]["Zulkifli bin Hassan"]["nickname"] == "Zul"
    assert [a.proposal.seq for a in keeper.inbox()] == [2, 3]  # left for the keeper
    assert keeper.state["people"]["Nor binti Hassan"]["born"] == 1968


def test_a_changed_record_file_is_refused_then_put_back(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    seq = keeper.publish([person("Yusof bin Ismail")])
    drive.sync()
    (path,) = (drive.copies["salmah"] / "record").glob(f"{seq:08d}-*.chg")
    changed = bytearray(path.read_bytes())
    changed[-80] ^= 0x01
    path.write_bytes(bytes(changed))  # damaged, or changed on purpose, in her copy

    salmah.receive()
    assert salmah.applied == seq - 1
    assert "record/" + path.name in salmah.suspect

    drive.sync()  # her copy's change reaches everyone, the keeper too...
    assert keeper.repair() == ["record/" + path.name]  # ...who puts the original back
    drive.sync()
    salmah.receive()
    assert salmah.applied == seq
    assert salmah.suspect == {}


def test_a_change_set_forged_by_a_member_is_refused(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    zul = join(drive, keeper, "zul")
    drive.sync()
    zul.receive()
    seq = zul.applied + 1
    epoch = max(zul.keys)
    forged = f'{{"seq":{seq},"prev":"{zul.last}","made":"now","changes":[]}}'.encode()
    blob = seal(Kind.RECORD, f"record/{seq}", forged, zul.sign, zul.keys[epoch], epoch)
    zul._write(f"record/{seq:08d}-ffffffff.chg", blob)  # right key, right place, wrong signer
    drive.sync()

    salmah.receive()
    assert salmah.applied == seq - 1
    assert salmah.suspect == {
        f"record/{seq:08d}-ffffffff.chg": "signed by a computer that may not write it"
    }

    keeper.publish([person("Khadijah binti Ismail")])  # the real change set takes that number
    drive.sync()
    salmah.receive()
    assert "Khadijah binti Ismail" in salmah.state["people"]


def test_a_proposal_in_another_computers_name_is_refused(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    zul = join(drive, keeper, "zul")
    epoch = max(zul.keys)
    payload = b'{"seq":1,"base":0,"made":"now","changes":[{"op":"delete","id":"x"}]}'
    blob = seal(
        Kind.PROPOSAL, f"inbox/{salmah.device}/1", payload, zul.sign, zul.keys[epoch], epoch
    )
    zul._write(f"inbox/{salmah.device}/00000001.prop", blob)
    drive.sync()

    assert keeper.inbox() == []
    assert keeper.suspect[f"inbox/{salmah.device}/00000001.prop"] == (
        "signed by a computer that may not write it"
    )


def test_a_file_moved_to_another_place_is_refused(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    first = keeper.publish([person("Rahman bin Ismail")])
    drive.sync()
    (path,) = (drive.copies["salmah"] / "record").glob(f"{first:08d}-*.chg")
    moved = path.with_name(f"{first + 1:08d}-{path.name.split('-')[1]}")
    shutil.copy(path, moved)  # the same file again, as the next change set
    salmah.receive()

    assert salmah.applied == first
    assert "record/" + moved.name in salmah.suspect


def test_a_removed_computer_reads_nothing_new(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    zul = join(drive, keeper, "zul")
    keeper.remove(zul.device)
    keeper.publish([person("Karim bin Hassan", born=1965)])
    drive.sync()

    salmah.receive()
    zul.receive()

    assert salmah.state["people"]["Karim bin Hassan"]["born"] == 1965
    assert salmah.state["members"][zul.device]["role"] == "removed"
    assert zul.role == "removed"
    assert "Karim bin Hassan" not in zul.state["people"]
    assert max(zul.keys) < max(salmah.keys)  # the new family key never reached him
    with pytest.raises(PermissionError):
        zul.send([person("Zulkifli bin Hassan")])


def test_a_new_computer_starts_from_a_snapshot(drive: Drive, keeper: Keeper) -> None:
    for n in range(30):
        keeper.publish([person(f"Cousin {n}", born=1950 + n)])
    keeper.snapshot()
    keeper.publish([person("Cousin 30")])
    drive.sync()
    for path in sorted((drive.copies["keeper"] / "record").glob("*.chg"))[:25]:
        path.unlink()  # the early record is gone from the folder
    drive.sync()

    salmah = join(drive, keeper, "salmah")

    assert salmah.state == keeper.state
    assert salmah.applied == keeper.applied
    assert len(salmah.state["people"]) == 31


def test_the_family_stays_in_step_however_the_sync_delivers(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    zul = join(drive, keeper, "zul", role="trusted")
    rng = random.Random(3)  # noqa: S311 - made-up comings and goings, not a secret
    for round_ in range(40):
        if rng.random() < 0.4:
            keeper.publish([person(f"Keeper's {round_}")])
        if rng.random() < 0.4:
            salmah.send([person(f"Salmah's {round_}")])
        if rng.random() < 0.4:
            zul.send([person(f"Zul's {round_}")])
        drive.sync(halves=True)
        for arrived in keeper.inbox():
            if arrived.device == salmah.device:
                keeper.decide(arrived, taken=[0])
        keeper.approve_trusted()
        salmah.receive()
        zul.receive()
    for _ in range(6):  # then let everything arrive whole
        drive.sync()
        keeper.approve_trusted()
        for arrived in keeper.inbox():
            keeper.decide(arrived, taken=[0])
        salmah.receive()
        zul.receive()

    assert salmah.state == keeper.state == zul.state
    assert salmah.waiting == {}
    assert zul.waiting == {}
    assert salmah.suspect == zul.suspect == keeper.suspect == {}


def test_photos_are_kept_once_and_checked(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    photo = b"\xff\xd8 a small made-up photo"
    name = salmah.put_file(photo)
    assert salmah.put_file(photo) == name
    drive.sync()

    assert keeper.get_file(name) == photo
    path = drive.copies["keeper"] / "files" / f"{name}.bin"
    damaged = bytearray(path.read_bytes())
    damaged[70] ^= 0x01
    path.write_bytes(bytes(damaged))
    with pytest.raises(RefusedError):
        keeper.get_file(name)


def test_the_keeper_comes_back_from_the_recovery_code(drive: Drive, tmp_path: Path) -> None:
    keeper, code = Keeper.start(drive.copies["keeper"], tmp_path / "keeper-data", "Hassan")
    salmah = join(drive, keeper, "salmah")
    salmah.send([person("Aminah binti Hassan")])
    drive.sync()
    (arrived,) = keeper.inbox()
    keeper.decide(arrived, taken=[0])
    drive.sync()
    shutil.rmtree(tmp_path / "keeper-data")  # the keeper's computer is lost

    again = Keeper.recover(drive.copies["keeper"], tmp_path / "new-computer", code.lower())

    assert again.inbox() == []  # what was answered stays answered
    assert again.known[salmah.device].name == "Salmah"
    again.publish([person("Nor binti Hassan")])
    drive.sync()
    salmah.receive()
    assert "Nor binti Hassan" in salmah.state["people"]


def test_nothing_in_the_folder_names_the_family(drive: Drive, keeper: Keeper) -> None:
    salmah = join(drive, keeper, "salmah")
    keeper.publish([person("Hassan bin Ismail", born=1938)])
    salmah.send([person("Aminah binti Hassan", lives_in="Klang")])
    salmah.put_file(b"a made-up photo of Aminah")
    drive.sync()

    words = [b"Hassan", b"Salmah", b"Aminah", b"Klang", b"1938"]
    for path in drive.copies["keeper"].rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            assert not [word for word in words if word in data], path.name
