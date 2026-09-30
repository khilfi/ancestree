"""Each computer's side of the family folder: the keeper's, and every other's.

A computer keeps its keys and its copy of the family in its own data folder, never in the
family folder. It writes only files of its own into the family folder, and reads the rest:

    family.json                        which family, and the keeper's public keys
    join/<computer>.req                a computer asking to join
    members/<computer>/<n>.mem         its place, with the family's keys locked for it
    record/<n>-<print>.chg             the record: the keeper's change sets, in order
    snapshots/<n>-<print>.snap         the whole family as of change set n
    inbox/<computer>/<n>.prop          changes a computer sends the keeper
    notes/<computer>/<n>.note          the keeper's answer to one of them
    files/<name>.bin                   photos and pictures
    recovery/<n>.bin                   the keeper's keys, locked with the recovery code
"""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Self

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from pydantic import ValidationError

from ancestree.familyfolder.models import (
    Change,
    FamilyFile,
    Joined,
    JoinRequest,
    KeyRing,
    MemberFile,
    Note,
    Proposal,
    RecordChange,
    RecordOp,
    Recovery,
    Removed,
    Role,
    Snapshot,
    Source,
)
from ancestree.familyfolder.seals import (
    Kind,
    RefusedError,
    file_name,
    fingerprint,
    join_code,
    open_for,
    peek,
    recovery_code,
    recovery_key,
    seal,
    seal_for,
    unseal,
)

MAY_SEND: set[str] = {"trusted", "contributor"}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _public(key: Ed25519PrivateKey | X25519PrivateKey) -> bytes:
    return key.public_key().public_bytes_raw()


@dataclass
class Known:
    """A computer the keeper has admitted."""

    name: str
    role: Role
    sign: str
    dh: str
    version: int = 0


@dataclass(frozen=True)
class Asking:
    """A computer asking to join, with the code its owner should read out."""

    device: str
    name: str
    code: str
    sign: str
    dh: str


@dataclass(frozen=True)
class Arrived:
    """A proposal that has reached the keeper, checked."""

    device: str
    name: str
    proposal: Proposal


class Computer:
    """What every computer does: read the family's record, and keep its own copy."""

    def __init__(self, folder: Path, data: Path) -> None:
        self.folder = folder
        self.data = data
        self.device = secrets.token_hex(8)
        self.sign = Ed25519PrivateKey.generate()
        self.dh = X25519PrivateKey.generate()
        self.family = ""
        self.keeper = b""  # the keeper's public signing key, as family.json has it
        self.keys: dict[int, bytes] = {}  # the family's keys, by epoch
        self.naming = b""
        self.role: Role | Literal["waiting"] = "waiting"
        self.version = 0  # of this computer's member file, as last read
        self.state: dict[str, Any] = {"people": {}, "members": {}}
        self.changed: dict[str, int] = {}  # each person: the change set that last changed them
        self.applied = 0
        self.last: str | None = None  # the fingerprint of the last change set applied
        self.sent = 0
        self.waiting: dict[int, list[dict[str, Any]]] = {}  # proposals not answered yet
        self.answers: dict[int, Note] = {}
        self.suspect: dict[str, str] = {}  # files refused so far, and why

    # Keeping this computer's own copy

    def _saved(self) -> dict[str, Any]:
        return {
            "device": self.device,
            "sign": self.sign.private_bytes_raw().hex(),
            "dh": self.dh.private_bytes_raw().hex(),
            "family": self.family,
            "keeper": self.keeper.hex(),
            "keys": {epoch: key.hex() for epoch, key in self.keys.items()},
            "naming": self.naming.hex(),
            "role": self.role,
            "version": self.version,
            "state": self.state,
            "changed": self.changed,
            "applied": self.applied,
            "last": self.last,
            "sent": self.sent,
            "waiting": self.waiting,
            "answers": {seq: note.model_dump() for seq, note in self.answers.items()},
        }

    def _restore(self, saved: dict[str, Any]) -> None:
        self.device = saved["device"]
        self.sign = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(saved["sign"]))
        self.dh = X25519PrivateKey.from_private_bytes(bytes.fromhex(saved["dh"]))
        self.family = saved["family"]
        self.keeper = bytes.fromhex(saved["keeper"])
        self.keys = {int(epoch): bytes.fromhex(key) for epoch, key in saved["keys"].items()}
        self.naming = bytes.fromhex(saved["naming"])
        self.role = saved["role"]
        self.version = saved["version"]
        self.state = saved["state"]
        self.changed = saved["changed"]
        self.applied = saved["applied"]
        self.last = saved["last"]
        self.sent = saved["sent"]
        self.waiting = {int(seq): changes for seq, changes in saved["waiting"].items()}
        self.answers = {int(s): Note.model_validate(n) for s, n in saved["answers"].items()}

    def save(self) -> None:
        self.data.mkdir(parents=True, exist_ok=True)
        path = self.data / "computer.json"
        partial = path.with_name(path.name + ".part")
        partial.write_text(json.dumps(self._saved(), indent=1), encoding="utf-8")
        os.replace(partial, path)

    @classmethod
    def load(cls, folder: Path, data: Path) -> Self:
        computer = cls(folder, data)
        computer._restore(json.loads((data / "computer.json").read_text(encoding="utf-8")))
        return computer

    # The family folder

    def _write(self, relative: str, blob: bytes) -> None:
        """Write a file whole: under a temporary name, then renamed, so it's never half there."""
        path = self.folder / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(blob)
        os.replace(partial, path)

    def _read(self, path: Path) -> bytes | None:
        """A file's bytes, or None if it isn't here yet (or only online, while offline)."""
        try:
            return path.read_bytes()
        except OSError:
            return None

    def _refused(self, path: Path, error: Exception) -> None:
        reason = str(error) if isinstance(error, RefusedError) else "not in the right shape"
        self.suspect[path.relative_to(self.folder).as_posix()] = reason

    def _cleared(self, path: Path) -> None:
        """A file refused before (half-synced, most likely) that checks out now."""
        self.suspect.pop(path.relative_to(self.folder).as_posix(), None)

    def _key(self, epoch: int) -> bytes:
        key = self.keys.get(epoch)
        if key is None:
            raise RefusedError(f"locked with a family key this computer doesn't have ({epoch})")
        return key

    def _sealed(self, kind: Kind, place: str, payload: bytes) -> bytes:
        epoch = max(self.keys)
        return seal(kind, place, payload, self.sign, self.keys[epoch], epoch)

    # Receiving

    def receive(self) -> int:
        """Apply what's new in the family's record; the number of change sets applied."""
        self._read_membership()
        if not self.keys:
            return 0
        if self.applied == 0:
            self._start_from_snapshot()
        count = 0
        while (found := self._next_change()) is not None:
            blob, change = found
            self._apply(change)
            self.applied = change.seq
            self.last = fingerprint(blob)
            count += 1
        self._read_answers()
        self.save()
        return count

    def _next_change(self) -> tuple[bytes, RecordChange] | None:
        seq = self.applied + 1
        for path in sorted((self.folder / "record").glob(f"{seq:08d}-*.chg")):
            blob = self._read(path)
            if blob is None:
                continue
            try:
                _, epoch, _ = peek(blob)
                if epoch not in self.keys:
                    self._read_membership()  # its key may be on its way
                opened = unseal(blob, f"record/{seq}", Kind.RECORD, {self.keeper}, self._key(epoch))
                change = RecordChange.model_validate_json(opened.payload)
                if change.seq != seq or change.prev != self.last:
                    raise RefusedError("not the next change set in the record")
            except (RefusedError, ValidationError) as error:
                if self.role != "removed":
                    self._refused(path, error)
                continue
            self._cleared(path)
            return blob, change
        return None

    def _apply(self, change: RecordChange) -> None:
        people: dict[str, Any] = self.state["people"]
        members: dict[str, Any] = self.state["members"]
        for op in change.changes:
            if op.op == "put":
                people[op.id] = op.data
                self.changed[op.id] = change.seq
            elif op.op == "delete":
                people.pop(op.id, None)
                self.changed[op.id] = change.seq
            elif op.op == "joined":
                members[op.device] = {"name": op.name, "role": op.role}
            else:
                members.setdefault(op.device, {"name": "", "role": "removed"})["role"] = "removed"
        source = change.source
        if source is not None and source.device == self.device and not source.note:
            self.waiting.pop(source.proposal, None)  # all taken; otherwise its note answers it

    def _start_from_snapshot(self) -> None:
        best: Snapshot | None = None
        for path in (self.folder / "snapshots").glob("*.snap"):
            try:
                seq = int(path.name.split("-")[0])
            except ValueError:
                continue
            blob = self._read(path)
            if blob is None or (best is not None and seq <= best.seq):
                continue
            try:
                _, epoch, _ = peek(blob)
                opened = unseal(
                    blob, f"snapshot/{seq}", Kind.SNAPSHOT, {self.keeper}, self._key(epoch)
                )
                snapshot = Snapshot.model_validate_json(opened.payload)
                if snapshot.seq != seq:
                    raise RefusedError("numbered wrongly")
            except (RefusedError, ValidationError) as error:
                self._refused(path, error)
                continue
            self._cleared(path)
            best = snapshot
        if best is not None:
            self.state = json.loads(json.dumps(best.state))
            self.changed = dict(best.changed)
            self.applied = best.seq
            self.last = best.hash

    def _read_membership(self) -> None:
        """This computer's newest member file: its role, and the family's keys locked for it."""
        best: MemberFile | None = None
        for path in (self.folder / "members" / self.device).glob("*.mem"):
            try:
                version = int(path.stem)
            except ValueError:
                continue
            blob = self._read(path)
            if blob is None or version <= max(self.version, best.version if best else 0):
                continue
            try:
                place = f"member/{self.device}/{version}"
                opened = unseal(blob, place, Kind.MEMBER, {self.keeper}, None)
                member = MemberFile.model_validate_json(opened.payload)
                if member.device != self.device or member.version != version:
                    raise RefusedError("for another computer")
            except (RefusedError, ValidationError) as error:
                self._refused(path, error)
                continue
            self._cleared(path)
            best = member
        if best is None:
            return
        self.version = best.version
        self.role = best.role
        if best.keys is not None:
            context = b"member " + self.device.encode()
            ring = KeyRing.model_validate_json(open_for(self.dh, bytes.fromhex(best.keys), context))
            self.keys = {epoch: bytes.fromhex(key) for epoch, key in ring.keys.items()}
            self.naming = bytes.fromhex(ring.naming)

    def _read_answers(self) -> None:
        for seq in list(self.waiting):
            path = self.folder / "notes" / self.device / f"{seq:08d}.note"
            blob = self._read(path)
            if blob is None:
                continue
            try:
                _, epoch, _ = peek(blob)
                place = f"note/{self.device}/{seq}"
                opened = unseal(blob, place, Kind.NOTE, {self.keeper}, self._key(epoch))
                note = Note.model_validate_json(opened.payload)
            except (RefusedError, ValidationError) as error:
                self._refused(path, error)
                continue
            self._cleared(path)
            self.answers[seq] = note
            self.waiting.pop(seq, None)

    # Photos and pictures

    def put_file(self, data: bytes) -> str:
        """Add a photo, once however often it's added; its name is a keyed fingerprint."""
        name = file_name(self.naming, data)
        if not (self.folder / "files" / f"{name}.bin").exists():
            self._write(f"files/{name}.bin", self._sealed(Kind.FILE, f"file/{name}", data))
        return name

    def get_file(self, name: str) -> bytes | None:
        blob = self._read(self.folder / "files" / f"{name}.bin")
        if blob is None:
            return None
        _, epoch, _ = peek(blob)
        # Any computer in the family may add a photo; its keyed name proves it came from one.
        data = unseal(blob, f"file/{name}", Kind.FILE, None, self._key(epoch)).payload
        if file_name(self.naming, data) != name:
            raise RefusedError("not the photo its name says")
        return data


class Member(Computer):
    """A relative's computer: asks to join, receives the family, sends its changes."""

    @classmethod
    def ask_to_join(cls, folder: Path, data: Path, name: str) -> tuple[Member, str]:
        """Ask to join the family in `folder`; the code for its owner to read to the keeper."""
        member = cls(folder, data)
        family = FamilyFile.model_validate_json((folder / "family.json").read_bytes())
        member.family = family.family
        member.keeper = bytes.fromhex(family.keeper_sign)
        context = b"join " + member.device.encode()
        locked_name = seal_for(bytes.fromhex(family.keeper_dh), name.encode(), context)
        ask = JoinRequest(
            device=member.device,
            sign=_public(member.sign).hex(),
            dh=_public(member.dh).hex(),
            name=locked_name.hex(),
        )
        place = f"join/{member.device}"
        blob = seal(Kind.JOIN, place, ask.model_dump_json().encode(), member.sign, None)
        member._write(f"join/{member.device}.req", blob)
        member.save()
        return member, join_code(member.keeper, _public(member.sign), _public(member.dh))

    def send(self, changes: list[Change]) -> int:
        """Send changes to the keeper; they wait here, marked, until answered."""
        if self.role not in MAY_SEND:
            raise PermissionError(f"a {self.role} computer doesn't send changes")
        self.sent += 1
        proposal = Proposal(seq=self.sent, base=self.applied, made=_now(), changes=changes)
        place = f"inbox/{self.device}/{self.sent}"
        blob = self._sealed(Kind.PROPOSAL, place, proposal.model_dump_json().encode())
        self._write(f"inbox/{self.device}/{self.sent:08d}.prop", blob)
        self.waiting[self.sent] = [change.model_dump() for change in changes]
        self.save()
        return self.sent


class Keeper(Computer):
    """The keeper's computer: publishes the record, admits and removes computers."""

    def __init__(self, folder: Path, data: Path) -> None:
        super().__init__(folder, data)
        self.known: dict[str, Known] = {}
        self.decided: set[str] = set()  # "computer/proposal"
        self.recovery = b""  # the key the recovery code stands for

    def _saved(self) -> dict[str, Any]:
        return {
            **super()._saved(),
            "known": {device: asdict(known) for device, known in self.known.items()},
            "decided": sorted(self.decided),
            "recovery": self.recovery.hex(),
        }

    def _restore(self, saved: dict[str, Any]) -> None:
        super()._restore(saved)
        self.known = {device: Known(**known) for device, known in saved["known"].items()}
        self.decided = set(saved["decided"])
        self.recovery = bytes.fromhex(saved["recovery"])

    def _write(self, relative: str, blob: bytes) -> None:
        """Everything the keeper writes is also kept here, to put back if it goes missing."""
        super()._write(relative, blob)
        copy = self.data / "published" / relative
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(blob)

    @classmethod
    def start(cls, folder: Path, data: Path, name: str) -> tuple[Keeper, str]:
        """Start a family in an empty folder; the recovery code, for the keeper's sheet."""
        keeper = cls(folder, data)
        keeper.family = secrets.token_hex(8)
        keeper.keeper = _public(keeper.sign)
        keeper.keys = {1: os.urandom(32)}
        keeper.naming = os.urandom(32)
        keeper.role = "keeper"
        family = FamilyFile(
            family=keeper.family,
            keeper_sign=keeper.keeper.hex(),
            keeper_dh=_public(keeper.dh).hex(),
        )
        keeper._write("family.json", family.model_dump_json(indent=2).encode())
        keeper.known[keeper.device] = Known(
            name=name, role="keeper", sign=keeper.keeper.hex(), dh=_public(keeper.dh).hex()
        )
        keeper._write_member(keeper.device)
        code = recovery_code()
        keeper.recovery = recovery_key(code, keeper.family)
        keeper._write_recovery()
        keeper.publish([Joined(device=keeper.device, name=name, role="keeper")])
        return keeper, code

    def _write_member(self, device: str) -> None:
        known = self.known[device]
        known.version += 1
        locked = None
        if known.role != "removed":
            ring = KeyRing(
                keys={epoch: key.hex() for epoch, key in self.keys.items()},
                naming=self.naming.hex(),
            )
            context = b"member " + device.encode()
            locked = seal_for(
                bytes.fromhex(known.dh), ring.model_dump_json().encode(), context
            ).hex()
        member = MemberFile(
            device=device,
            version=known.version,
            role=known.role,
            sign=known.sign,
            dh=known.dh,
            keys=locked,
        )
        place = f"member/{device}/{known.version}"
        blob = seal(Kind.MEMBER, place, member.model_dump_json().encode(), self.sign, None)
        self._write(f"members/{device}/{known.version:06d}.mem", blob)

    def _write_recovery(self) -> None:
        version = len(list((self.folder / "recovery").glob("*.bin"))) + 1
        keys = Recovery(
            device=self.device,
            sign=self.sign.private_bytes_raw().hex(),
            dh=self.dh.private_bytes_raw().hex(),
            keys={epoch: key.hex() for epoch, key in self.keys.items()},
            naming=self.naming.hex(),
        )
        place = f"recovery/{version}"
        blob = seal(Kind.RECOVERY, place, keys.model_dump_json().encode(), self.sign, self.recovery)
        self._write(f"recovery/{version:06d}.bin", blob)

    def publish(self, changes: list[RecordOp], source: Source | None = None) -> int:
        """Add a change set to the record, for every computer in the family."""
        seq = self.applied + 1
        change = RecordChange(seq=seq, prev=self.last, made=_now(), source=source, changes=changes)
        blob = self._sealed(Kind.RECORD, f"record/{seq}", change.model_dump_json().encode())
        self._write(f"record/{seq:08d}-{fingerprint(blob)[:8]}.chg", blob)
        self._apply(change)
        self.applied = seq
        self.last = fingerprint(blob)
        self.save()
        return seq

    def snapshot(self) -> int:
        """The whole family as it is, so a new computer needn't read the record from the start."""
        snapshot = Snapshot(
            seq=self.applied, hash=self.last or "", state=self.state, changed=self.changed
        )
        blob = self._sealed(
            Kind.SNAPSHOT, f"snapshot/{self.applied}", snapshot.model_dump_json().encode()
        )
        self._write(f"snapshots/{self.applied:08d}-{fingerprint(blob)[:8]}.snap", blob)
        return self.applied

    # Joining and leaving

    def asking(self) -> list[Asking]:
        asks: list[Asking] = []
        for path in sorted((self.folder / "join").glob("*.req")):
            device = path.stem
            blob = self._read(path)
            if device in self.known or blob is None:
                continue
            try:
                opened = unseal(blob, f"join/{device}", Kind.JOIN, None, None)
                ask = JoinRequest.model_validate_json(opened.payload)
                if ask.device != device or bytes.fromhex(ask.sign) != opened.signer:
                    raise RefusedError("not signed by the computer asking")
                context = b"join " + device.encode()
                name = open_for(self.dh, bytes.fromhex(ask.name), context).decode()
            except (RefusedError, ValidationError, ValueError) as error:
                self._refused(path, error)
                continue
            self._cleared(path)
            code = join_code(self.keeper, bytes.fromhex(ask.sign), bytes.fromhex(ask.dh))
            asks.append(Asking(device=device, name=name, code=code, sign=ask.sign, dh=ask.dh))
        return asks

    def admit(self, ask: Asking, role: Role) -> None:
        """Let a computer in, once its owner has read out the same code as this one shows."""
        self.known[ask.device] = Known(name=ask.name, role=role, sign=ask.sign, dh=ask.dh)
        self._write_member(ask.device)
        self.publish([Joined(device=ask.device, name=ask.name, role=role)])

    def remove(self, device: str) -> None:
        """Let a computer go: a new family key for everyone else, so it can't read what follows."""
        self.known[device].role = "removed"
        self.keys[max(self.keys) + 1] = os.urandom(32)
        for other in self.known:
            self._write_member(other)
        self._write_recovery()
        self.publish([Removed(device=device)])

    # Proposals

    def inbox(self) -> list[Arrived]:
        arrived: list[Arrived] = []
        for device, known in self.known.items():
            if known.role not in MAY_SEND:
                continue
            for path in sorted((self.folder / "inbox" / device).glob("*.prop")):
                try:
                    seq = int(path.stem)
                except ValueError:
                    continue
                if f"{device}/{seq}" in self.decided:
                    self._cleared(path)
                    continue
                blob = self._read(path)
                if blob is None:
                    continue
                try:
                    _, epoch, _ = peek(blob)
                    signer = {bytes.fromhex(known.sign)}
                    place = f"inbox/{device}/{seq}"
                    opened = unseal(blob, place, Kind.PROPOSAL, signer, self._key(epoch))
                    proposal = Proposal.model_validate_json(opened.payload)
                    if proposal.seq != seq:
                        raise RefusedError("numbered wrongly")
                except (RefusedError, ValidationError) as error:
                    self._refused(path, error)
                    continue
                self._cleared(path)
                arrived.append(Arrived(device=device, name=known.name, proposal=proposal))
        return arrived

    def decide(self, arrived: Arrived, taken: list[int], note: str = "") -> int | None:
        """Publish the changes taken; answer with a note if any were left out."""
        proposal = arrived.proposal
        changes: list[RecordOp] = [proposal.changes[i] for i in taken]
        left = [i for i in range(len(proposal.changes)) if i not in taken]
        source = Source(device=arrived.device, proposal=proposal.seq, note=bool(left or note))
        seq = self.publish(changes, source) if changes else None
        if left or note:
            answer = Note(proposal=proposal.seq, taken=taken, left=left, note=note)
            place = f"note/{arrived.device}/{proposal.seq}"
            blob = self._sealed(Kind.NOTE, place, answer.model_dump_json().encode())
            self._write(f"notes/{arrived.device}/{proposal.seq:08d}.note", blob)
        self.decided.add(f"{arrived.device}/{proposal.seq}")
        self.save()
        return seq

    def approve_trusted(self) -> list[int]:
        """A trusted computer's proposals go through, unless they clash or take something out."""
        published: list[int] = []
        for arrived in self.inbox():
            if self.known[arrived.device].role != "trusted":
                continue
            changes = arrived.proposal.changes
            clean = [
                i
                for i, change in enumerate(changes)
                if change.op == "put" and self.changed.get(change.id, 0) <= arrived.proposal.base
            ]
            if len(clean) == len(changes) and (seq := self.decide(arrived, clean)) is not None:
                published.append(seq)
        return published

    # Looking after the folder

    def repair(self) -> list[str]:
        """Put back whatever the keeper wrote that's gone from the folder, or changed there."""
        restored: list[str] = []
        published = self.data / "published"
        for copy in sorted(published.rglob("*")):
            if not copy.is_file():
                continue
            relative = copy.relative_to(published).as_posix()
            original = copy.read_bytes()
            if self._read(self.folder / relative) != original:
                Computer._write(self, relative, original)
                restored.append(relative)
        return restored

    @classmethod
    def recover(cls, folder: Path, data: Path, code: str) -> Keeper:
        """The keeper on a new computer, from the recovery code and the family folder."""
        keeper = cls(folder, data)
        family = FamilyFile.model_validate_json((folder / "family.json").read_bytes())
        keeper.family = family.family
        keeper.keeper = bytes.fromhex(family.keeper_sign)
        keeper.recovery = recovery_key(code, family.family)
        newest = max((folder / "recovery").glob("*.bin"), key=lambda path: int(path.stem))
        place = f"recovery/{int(newest.stem)}"
        opened = unseal(newest.read_bytes(), place, Kind.RECOVERY, {keeper.keeper}, keeper.recovery)
        keys = Recovery.model_validate_json(opened.payload)
        keeper.device = keys.device
        keeper.sign = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(keys.sign))
        keeper.dh = X25519PrivateKey.from_private_bytes(bytes.fromhex(keys.dh))
        keeper.keys = {epoch: bytes.fromhex(key) for epoch, key in keys.keys.items()}
        keeper.naming = bytes.fromhex(keys.naming)
        keeper.role = "keeper"
        keeper.receive()
        for device, info in keeper.state["members"].items():
            member = keeper._newest_member_file(device)
            if member is not None:
                keeper.known[device] = Known(
                    name=info["name"],
                    role=member.role,
                    sign=member.sign,
                    dh=member.dh,
                    version=member.version,
                )
        keeper._remember_answers()
        keeper.save()
        return keeper

    def _newest_member_file(self, device: str) -> MemberFile | None:
        newest: MemberFile | None = None
        for path in (self.folder / "members" / device).glob("*.mem"):
            blob = self._read(path)
            if blob is None:
                continue
            try:
                place = f"member/{device}/{int(path.stem)}"
                opened = unseal(blob, place, Kind.MEMBER, {self.keeper}, None)
                member = MemberFile.model_validate_json(opened.payload)
            except RefusedError, ValidationError, ValueError:
                continue
            if newest is None or member.version > newest.version:
                newest = member
        return newest

    def _remember_answers(self) -> None:
        """Proposals already answered, from the record's sources and the notes."""
        for path in (self.folder / "record").glob("*.chg"):
            blob = self._read(path)
            if blob is None:
                continue
            try:
                _, epoch, _ = peek(blob)
                seq = int(path.name.split("-")[0])
                opened = unseal(blob, f"record/{seq}", Kind.RECORD, {self.keeper}, self._key(epoch))
                change = RecordChange.model_validate_json(opened.payload)
            except RefusedError, ValidationError, ValueError:
                continue
            if change.source is not None:
                self.decided.add(f"{change.source.device}/{change.source.proposal}")
        for path in (self.folder / "notes").glob("*/*.note"):
            self.decided.add(f"{path.parent.name}/{int(path.stem)}")
