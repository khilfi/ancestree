"""Each computer's side of the family folder: the keeper's, and every other's.

A computer keeps its keys and its copy of the family in its own data folder, never in the
family folder. It writes only files of its own into the family folder, and reads the rest:

    family.json                        which family, and the keeper's public keys
    join/<computer>.req                a computer asking to join
    members/<computer>/<n>.mem         its place, with the family's keys locked for it
    record/<n>-<print>.chg             the record: the keeper's change sets, in order
    snapshots/<n>-<print>.snap         the whole family as of change set n
    inbox/<computer>/<n>.prop          changes a computer sends the keeper (since M25, in that
                                       computer's own folder, in its owner's Drive)
    notes/<computer>/<n>.note          the keeper's answer to one of them
    files/<name>.bin                   photos and pictures
    recovery/<n>.bin                   the keeper's keys, locked with the recovery code
    offers/<computer>.bin              the family offered to that computer, locked for it
    helping/<computer>.bin             for another of the keeper's own computers, allowed to
                                       invite and let in for it, locked for it

and, in a relative's computer's own folder, since 0.5.0:

    about/<computer>.bin               what it says of itself: its version, an offer turned down
    took/<computer>.bin                the new keeper's word that it took the family, and where
                                       the family folder is now

and, since 0.8.0, in that of one of the keeper's own allowed to invite and let in:

    instructions/<computer>/<n>.ins    its word to the keeper's to let a computer in, numbered
"""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Self

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from pydantic import ValidationError

from ancestree.familyfolder.models import (
    About,
    Change,
    FamilyFile,
    Helping,
    Instruction,
    Joined,
    JoinRequest,
    KeyRing,
    KnownComputer,
    MemberFile,
    Newcomer,
    Note,
    Offer,
    Proposal,
    RecordChange,
    RecordOp,
    Recovery,
    Removed,
    Role,
    Snapshot,
    Source,
    TookOver,
)
from ancestree.familyfolder.protect import read_secret, write_secret
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
# Those that send anything: a viewer sends its words about people alone, which the
# keeper's computer takes alone from it.
SENDS: set[str] = MAY_SEND | {"viewer"}
HANDOVER = 1  # the way of handing over the keeper this code takes part in, since 0.5.0
# A request to join, or an instruction, at most: a few hundred bytes as the app writes
# them. Anything larger is refused unread (0.8.0).
SMALL = 64 * 1024
# The family folder's own files, the keeper's: what a new keeper's folder holds after a
# handover, without the offers or relatives' files.
FAMILY_FOLDER_FILES = (
    "family.json",
    "members/",
    "record/",
    "snapshots/",
    "notes/",
    "files/",
    "recovery/",
)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def requested(blob: bytes, device: str) -> JoinRequest:
    """A computer's request to join, checked as its own: read by the keeper's computer, and
    since 0.8.0 by another of the keeper's own, which works out its code from it, and
    can't open the name, locked for the keeper."""
    if len(blob) > SMALL:
        raise RefusedError("larger than a request to join is")
    opened = unseal(blob, f"join/{device}", Kind.JOIN, None, None)
    ask = JoinRequest.model_validate_json(opened.payload)
    if ask.device != device or bytes.fromhex(ask.sign) != opened.signer:
        raise RefusedError("not signed by the computer asking")
    return ask


def _public(key: Ed25519PrivateKey | X25519PrivateKey) -> bytes:
    return key.public_key().public_bytes_raw()


def _apply_to(state: dict[str, Any], change: RecordChange) -> None:
    """A change set's changes, made to the family and its members as `state` holds them."""
    people: dict[str, Any] = state["people"]
    members: dict[str, Any] = state["members"]
    for op in change.changes:
        if op.op == "put":
            people[op.id] = op.data
        elif op.op == "delete":
            people.pop(op.id, None)
        elif op.op == "joined":
            # From which change set it has this role: what it sent before, it sent as
            # it was then. Computers before 0.5.0 read the name and role alone.
            members[op.device] = {"name": op.name, "role": op.role, "since": change.seq}
        else:
            members.setdefault(op.device, {"name": "", "role": "removed"})["role"] = "removed"


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
    # It, or one not decided yet that it stands for, was made before the computer's role last
    # changed: the keeper's to look at, whatever the computer may do now.
    before_role: bool = False
    # A viewer's: only its words about people are taken from it.
    words_only: bool = False


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
        """This computer's keys and copy of the family, locked on this computer."""
        write_secret(self.data / "computer.bin", json.dumps(self._saved()).encode())

    @classmethod
    def load(cls, folder: Path, data: Path) -> Self:
        computer = cls(folder, data)
        saved = read_secret(data / "computer.bin")
        if saved is None:
            raise FileNotFoundError(data / "computer.bin")
        computer._restore(json.loads(saved))
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
        return self._change_at(self.applied + 1, self.last, note=self.role != "removed")

    def _change_at(
        self, seq: int, prev: str | None, *, note: bool = False
    ) -> tuple[bytes, RecordChange] | None:
        """Change set `seq` of the record, checked: signed by the keeper and naming the one
        before it. With `note`, a file refused is noted."""
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
                if change.seq != seq or change.prev != prev:
                    raise RefusedError("not the next change set in the record")
            except (RefusedError, ValidationError) as error:
                if note:
                    self._refused(path, error)
                continue
            self._cleared(path)
            return blob, change
        return None

    def state_at(self, seq: int) -> dict[str, Any]:
        """The family as the record had it after change set `seq`: from the newest
        snapshot at or before it, then each change set after it, each checked as it's read."""
        best: Snapshot | None = None
        for path in (self.folder / "snapshots").glob("*.snap"):
            try:
                at = int(path.name.split("-")[0])
            except ValueError:
                continue
            blob = self._read(path)
            if blob is None or at > seq or (best is not None and at <= best.seq):
                continue
            try:
                _, epoch, _ = peek(blob)
                place = f"snapshot/{at}"
                opened = unseal(blob, place, Kind.SNAPSHOT, {self.keeper}, self._key(epoch))
                snapshot = Snapshot.model_validate_json(opened.payload)
            except RefusedError, ValidationError:
                continue
            if snapshot.seq == at:
                best = snapshot
        state: dict[str, Any] = (
            json.loads(json.dumps(best.state)) if best else {"people": {}, "members": {}}
        )
        last = best.hash if best else None
        for at in range((best.seq if best else 0) + 1, seq + 1):
            found = self._change_at(at, last)
            if found is None:
                raise RefusedError(f"change set {at} of the record isn't here")
            blob, change = found
            _apply_to(state, change)
            last = fingerprint(blob)
        return state

    def _apply(self, change: RecordChange) -> None:
        _apply_to(self.state, change)
        for op in change.changes:
            if op.op in ("put", "delete"):
                self.changed[op.id] = change.seq
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

    def send(
        self,
        changes: list[Change],
        *,
        family: str = "",
        answered: int = 0,
        base: int | None = None,
        changed: int = 0,
    ) -> int:
        """Send changes to the keeper; they wait here, marked, until answered. Or rather the
        computer's whole `family`, made on the record's change set `base`."""
        if self.role not in SENDS:
            raise PermissionError(f"a {self.role} computer doesn't send changes")
        self.sent += 1
        proposal = Proposal(
            seq=self.sent,
            base=self.applied if base is None else base,
            made=_now(),
            changes=changes,
            family=family,
            answered=answered,
            changed=changed,
        )
        place = f"inbox/{self.device}/{self.sent}"
        blob = self._sealed(Kind.PROPOSAL, place, proposal.model_dump_json().encode())
        self._write(f"inbox/{self.device}/{self.sent:08d}.prop", blob)
        self.waiting[self.sent] = [change.model_dump() for change in changes]
        self.save()
        return self.sent

    # Handing over the keeper

    @classmethod
    def newcomer(
        cls,
        folder: Path,
        data: Path,
        family: str,
        keeper: bytes,
        identity: tuple[str, Ed25519PrivateKey, X25519PrivateKey],
    ) -> Member:
        """The old keeper's computer as a relative, after the family it offered was taken: the
        identity it offered, which the new keeper let in, writing its member file."""
        member = cls(folder, data)
        member.device, member.sign, member.dh = identity
        member.family, member.keeper = family, keeper
        member.save()
        return member

    def read_offer(self) -> Offer | None:
        """The family offered to this computer, if it is: signed with the keeper's key, locked
        for this computer alone, and holding the keeper's own keys."""
        path = self.folder / "offers" / f"{self.device}.bin"
        blob = self._read(path)
        if blob is None:
            return None
        try:
            opened = unseal(blob, f"offer/{self.device}", Kind.OFFER, {self.keeper}, None)
            context = b"offer " + self.device.encode()
            offer = Offer.model_validate_json(open_for(self.dh, opened.payload, context))
            sign = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(offer.keys.sign))
            if offer.to != self.device or _public(sign) != self.keeper:
                raise RefusedError("not the keeper's keys, for this computer")
        except (RefusedError, ValidationError, ValueError) as error:
            self._refused(path, error)
            return None
        self._cleared(path)
        return offer

    def read_helping(self) -> Helping | None:
        """What the keeper's computer left this one, allowed to invite and let in for it:
        signed with the keeper's key, locked for this computer alone. None if there's none."""
        path = self.folder / "helping" / f"{self.device}.bin"
        blob = self._read(path)
        if blob is None:
            return None
        try:
            opened = unseal(blob, f"helping/{self.device}", Kind.HELPING, {self.keeper}, None)
            context = b"helping " + self.device.encode()
            helping = Helping.model_validate_json(open_for(self.dh, opened.payload, context))
            if helping.device != self.device:
                raise RefusedError("for another computer")
        except (RefusedError, ValidationError, ValueError) as error:
            self._refused(path, error)
            return None
        self._cleared(path)
        return helping

    def instruct(self, instruction: Instruction) -> None:
        """Its word to the keeper's computer, in its own folder: signed with this
        computer's key, locked for the keeper's computer alone, its number in its place."""
        family = FamilyFile.model_validate_json((self.folder / "family.json").read_bytes())
        number = instruction.number
        context = b"instruction " + f"{self.device}/{number}".encode()
        locked = seal_for(
            bytes.fromhex(family.keeper_dh), instruction.model_dump_json().encode(), context
        )
        place = f"instruction/{self.device}/{number}"
        blob = seal(Kind.INSTRUCTION, place, locked, self.sign, None)
        self._write(f"instructions/{self.device}/{number:08d}.ins", blob)

    def write_about(self, version: str, declined: str = "") -> None:
        """What this computer says of itself, in its own folder: its version, and the way of
        handing over it can take part in, for the keeper to know it may offer it the family;
        and an offer it turned down."""
        about = About(device=self.device, version=version, handover=HANDOVER, declined=declined)
        place = f"about/{self.device}"
        blob = seal(Kind.ABOUT, place, about.model_dump_json().encode(), self.sign, None)
        self._write(f"about/{self.device}.bin", blob)


class Keeper(Computer):
    """The keeper's computer: publishes the record, admits and removes computers."""

    def __init__(self, folder: Path, data: Path) -> None:
        super().__init__(folder, data)
        self.known: dict[str, Known] = {}
        self.decided: set[str] = set()  # "computer/proposal"
        self.recovery = b""  # the key the recovery code stands for
        # Each computer's proposals made before its role last changed, by what this
        # computer saw itself: those here as the role changed, and those come before the change
        # went up to Drive, when that computer couldn't have known. Never by what a proposal
        # says of itself, its `base`, which its sender chooses (0.8.0).
        self.before: dict[str, set[int]] = {}
        self.going_up: set[str] = set()  # computers whose new role hasn't gone up to Drive yet

    def _saved(self) -> dict[str, Any]:
        return {
            **super()._saved(),
            "known": {device: asdict(known) for device, known in self.known.items()},
            "decided": sorted(self.decided),
            "recovery": self.recovery.hex(),
            "before": {
                device: sorted(seq for seq in seqs if f"{device}/{seq}" not in self.decided)
                for device, seqs in self.before.items()
            },
            "going_up": sorted(self.going_up),
        }

    def _restore(self, saved: dict[str, Any]) -> None:
        super()._restore(saved)
        self.known = {device: Known(**known) for device, known in saved["known"].items()}
        self.decided = set(saved["decided"])
        self.recovery = bytes.fromhex(saved["recovery"])
        self.going_up = set(saved.get("going_up", []))
        if "before" in saved:
            self.before = {device: set(seqs) for device, seqs in saved["before"].items()}
            return
        # Kept by a version before 0.8.0, which went by what each proposal said of itself: those
        # here already are taken as it said, once; every one after, by what this computer sees.
        for device, known in self.known.items():
            if known.role not in ("keeper", "removed"):
                since = self.role_since(device)
                made = [seq for seq, proposal in self._proposals(device) if proposal.base < since]
                if made:
                    self.before[device] = set(made)

    def _write(self, relative: str, blob: bytes) -> None:
        """Everything the keeper writes is also kept here, to put back if it goes missing."""
        super()._write(relative, blob)
        copy = self.data / "published" / relative
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(blob)

    @classmethod
    def start(cls, folder: Path, data: Path, name: str, family: str = "") -> tuple[Keeper, str]:
        """Start a family in an empty folder; the recovery code, for the keeper's sheet.
        `family`: the family's id, if it's chosen already (it names the folder in Drive)."""
        keeper = cls(folder, data)
        keeper.family = family or secrets.token_hex(8)
        keeper.keeper = _public(keeper.sign)
        keeper.keys = {1: os.urandom(32)}
        keeper.naming = os.urandom(32)
        keeper.role = "keeper"
        found = FamilyFile(
            family=keeper.family,
            keeper_sign=keeper.keeper.hex(),
            keeper_dh=_public(keeper.dh).hex(),
        )
        keeper._write("family.json", found.model_dump_json(indent=2).encode())
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

    def _recovery_versions(self) -> set[int]:
        """The recovery files' numbers, in the folder here and among those this computer wrote:
        a new one is numbered after them all, even with some taken out of the folder since."""
        versions: set[int] = set()
        for folder in (self.folder / "recovery", self.data / "published" / "recovery"):
            for path in folder.glob("*.bin"):
                if path.stem.isdigit():
                    versions.add(int(path.stem))
        return versions

    def _keys(self) -> Recovery:
        """The keeper's keys: its place, its private keys, every family key and the naming key,
        as a recovery file or an offer holds them."""
        return Recovery(
            device=self.device,
            sign=self.sign.private_bytes_raw().hex(),
            dh=self.dh.private_bytes_raw().hex(),
            keys={epoch: key.hex() for epoch, key in self.keys.items()},
            naming=self.naming.hex(),
        )

    def _take_keys(self, keys: Recovery) -> None:
        """The keeper's keys, from a recovery file or an offer, as this computer's own."""
        self.device = keys.device
        self.sign = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(keys.sign))
        self.dh = X25519PrivateKey.from_private_bytes(bytes.fromhex(keys.dh))
        self.keys = {epoch: bytes.fromhex(key) for epoch, key in keys.keys.items()}
        self.naming = bytes.fromhex(keys.naming)

    def _write_recovery(self) -> str:
        """The keeper's keys, locked with the recovery code, in a new recovery file; its path."""
        version = max(self._recovery_versions(), default=0) + 1
        keys = self._keys()
        place = f"recovery/{version}"
        blob = seal(Kind.RECOVERY, place, keys.model_dump_json().encode(), self.sign, self.recovery)
        written = f"recovery/{version:06d}.bin"
        self._write(written, blob)
        return written

    def new_recovery(self) -> tuple[str, list[str]]:
        """A new recovery code, for one lost or seen by someone else: the keeper's keys locked
        with it in a new recovery file, the newest, which a new computer opens. The code, and
        the older recovery files, locked with the old code: to take out of the folder once the
        new one is there."""
        older = sorted(
            path.relative_to(self.folder).as_posix()
            for path in (self.folder / "recovery").glob("*.bin")
        )
        code = recovery_code()
        self.recovery = recovery_key(code, self.family)
        self._write_recovery()
        self.save()
        return code, older

    def forget(self, relative: str) -> None:
        """A file of the keeper's taken out of the folder for good: not put back by repair."""
        (self.folder / relative).unlink(missing_ok=True)
        (self.data / "published" / relative).unlink(missing_ok=True)

    def _adopt_own(self) -> None:
        """A change set this computer wrote but stopped before counting (the app ended just
        then): counted now, as it may have reached the folder in Drive already, so the next
        isn't numbered the same."""
        adopted = False
        while True:
            seq = self.applied + 1
            found = sorted((self.data / "published" / "record").glob(f"{seq:08d}-*.chg"))
            if not found:
                break
            blob = found[0].read_bytes()
            try:
                _, epoch, _ = peek(blob)
                opened = unseal(blob, f"record/{seq}", Kind.RECORD, {self.keeper}, self._key(epoch))
                change = RecordChange.model_validate_json(opened.payload)
            except RefusedError, ValidationError:
                break
            if change.seq != seq or change.prev != self.last:
                break
            self._apply(change)
            self.applied = seq
            self.last = fingerprint(blob)
            adopted = True
        if adopted:
            self.save()

    def overtaken(self) -> bool:
        """Whether the record has moved on without this computer: a change set signed with the
        keeper's key that this computer didn't write, numbered as its newest or after. The
        keeper's keys are at work on another computer, brought back there with the recovery
        code; this one must stop publishing, or the record would split in two."""
        self._adopt_own()
        mine = self.data / "published" / "record"
        newest = f"{self.applied:08d}-{(self.last or '')[:8]}.chg"  # the last it applied
        for path in (self.folder / "record").glob("*.chg"):
            try:
                seq = int(path.name.split("-")[0])
            except ValueError:
                continue
            if seq < self.applied or path.name == newest or (mine / path.name).is_file():
                continue
            blob = self._read(path)
            if blob is None:
                continue
            try:  # the signature alone: its key may be one this computer never had
                unseal(blob, f"record/{seq}", Kind.RECORD, {self.keeper}, None)
            except RefusedError:
                continue  # not the keeper's: refused by every computer, put right by repair
            return True
        return False

    def publish(self, changes: list[RecordOp], source: Source | None = None) -> int:
        """Add a change set to the record, for every computer in the family."""
        self._adopt_own()
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

    def asking(self, passed_over: set[str] | frozenset[str] = frozenset()) -> list[Asking]:
        """The computers asking to join, each checked: all but those let in already, and those
        `passed_over` (turned away), which aren't even read."""
        asks: list[Asking] = []
        for path in sorted((self.folder / "join").glob("*.req")):
            device = path.stem
            if device in self.known or device in passed_over:
                continue
            blob = self._read(path)
            if blob is None:
                continue
            try:
                ask = requested(blob, device)
                context = b"join " + device.encode()
                name = open_for(self.dh, bytes.fromhex(ask.name), context).decode()
                code = join_code(self.keeper, bytes.fromhex(ask.sign), bytes.fromhex(ask.dh))
            except (RefusedError, ValidationError, ValueError) as error:
                self._refused(path, error)
                continue
            self._cleared(path)
            asks.append(Asking(device=device, name=name, code=code, sign=ask.sign, dh=ask.dh))
        return asks

    def admit(self, ask: Asking, role: Role) -> None:
        """Let a computer in, once its owner has read out the same code as this one shows."""
        self.known[ask.device] = Known(name=ask.name, role=role, sign=ask.sign, dh=ask.dh)
        self._write_member(ask.device)
        self.publish([Joined(device=ask.device, name=ask.name, role=role)])

    def change_role(self, device: str, role: Role) -> int:
        """Another role for a computer let in already: a new member file, holding the same
        keys, as every role reads the family; and the role in the record, so every computer's
        list shows it. Computers since 0.4.0 read both already. The change set's number.
        What it sent that's here now was made before the change; so is what comes until the
        change has gone up to Drive (`went_up`), as it can't know till then."""
        known = self.known[device]
        known.role = role
        self.before.setdefault(device, set()).update(seq for seq, _ in self._proposals(device))
        self.going_up.add(device)
        self._write_member(device)
        return self.publish([Joined(device=device, name=known.name, role=role)])

    def went_up(self) -> None:
        """What this computer wrote has gone up to Drive, any new role with it: what came here
        before was made before the role changed; what a computer sends from now, knowing
        it."""
        if not self.going_up:
            return
        for device in self.going_up & self.known.keys():
            self.before.setdefault(device, set()).update(seq for seq, _ in self._proposals(device))
        self.going_up.clear()
        self.save()

    def role_since(self, device: str) -> int:
        """The change set from which a computer has had its role: a proposal saying it was
        made on an earlier one says it was made as the computer was before, as versions before
        0.8.0 took it. 0 if the record doesn't say."""
        member: dict[str, Any] = self.state["members"].get(device, {})
        return int(member.get("since", 0))

    def remove(self, device: str) -> None:
        """Let a computer go: a new family key for everyone else, so it can't read what follows."""
        self.known[device].role = "removed"
        self.keys[max(self.keys) + 1] = os.urandom(32)
        for other in self.known:
            self._write_member(other)
        self._write_recovery()
        self.publish([Removed(device=device)])

    # Proposals

    def _proposals(self, device: str) -> list[tuple[int, Proposal]]:
        """A computer's proposals here not decided yet, each checked as its own, by number."""
        known = self.known[device]
        found: list[tuple[int, Proposal]] = []
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
                try:
                    datetime.fromisoformat(proposal.made)
                except ValueError:
                    raise RefusedError("dated wrongly") from None
            except (RefusedError, ValidationError) as error:
                self._refused(path, error)
                continue
            self._cleared(path)
            found.append((seq, proposal))
        return found

    def inbox(self) -> list[Arrived]:
        """Each computer's proposals not decided yet, checked. One that became a viewer is
        still heard on what it sent before it knew: nothing it sent is dropped unseen. What a
        viewer sends as one is for its words about people alone. Which were made before
        a role changed is this computer's to know (`before`), never the sender's to say."""
        arrived: list[Arrived] = []
        for device, known in self.known.items():
            if known.role in ("keeper", "removed"):
                continue
            for seq, proposal in self._proposals(device):
                if device in self.going_up:  # it can't know its new role yet
                    self.before.setdefault(device, set()).add(seq)
                made_before = seq in self.before.get(device, ())
                arrived.append(
                    Arrived(
                        device=device,
                        name=known.name,
                        proposal=proposal,
                        before_role=made_before,
                        words_only=known.role not in MAY_SEND and not made_before,
                    )
                )
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

    def settle(self, device: str, proposal: int) -> None:
        """A computer's proposal decided, and every one it sent before: none comes again."""
        for path in (self.folder / "inbox" / device).glob("*.prop"):
            try:
                seq = int(path.stem)
            except ValueError:
                continue
            if seq <= proposal:
                self.decided.add(f"{device}/{seq}")
        self.decided.add(f"{device}/{proposal}")
        self.save()

    def answer(self, device: str, proposal: int, left_out: list[str], note: str = "") -> None:
        """The keeper's answer to a computer's proposal: what wasn't taken, in words,
        and a note of the keeper's own. The proposal, and every one before it, is settled."""
        answer = Note(proposal=proposal, taken=[], left=[], note=note, left_out=left_out)
        place = f"note/{device}/{proposal}"
        blob = self._sealed(Kind.NOTE, place, answer.model_dump_json().encode())
        self._write(f"notes/{device}/{proposal:08d}.note", blob)
        self.settle(device, proposal)

    def last_decided(self, device: str) -> int:
        return max(
            (int(seq) for name in self.decided for who, _, seq in [name.partition("/")]
             if who == device),
            default=0,
        )  # fmt: skip

    def newest(self) -> list[Arrived]:
        """Each computer's newest proposal not yet decided. Each is the computer's whole
        family, so a newer one stands for those before it; one made before the computer heard
        back on its last decided proposal waits for a fresher one, which it sends then. Each
        says whether it, or one it stands for, was made before the computer's role last
        changed."""
        newest: dict[str, Arrived] = {}
        earlier: set[str] = set()
        for arrived in self.inbox():
            if not arrived.proposal.family:
                continue  # the spike's, entry by entry
            if arrived.before_role:
                earlier.add(arrived.device)
            if arrived.proposal.answered < self.last_decided(arrived.device):
                continue
            have = newest.get(arrived.device)
            if have is None or arrived.proposal.seq > have.proposal.seq:
                newest[arrived.device] = arrived
        return sorted(
            (
                replace(arrived, before_role=arrived.device in earlier)
                for arrived in newest.values()
            ),
            key=lambda arrived: arrived.proposal.made,
        )

    def approve_trusted(self) -> list[int]:
        """A trusted computer's proposals go through, unless they clash or take something out,
        or it sent them before it was trusted."""
        published: list[int] = []
        for arrived in self.inbox():
            if self.known[arrived.device].role != "trusted" or arrived.before_role:
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

    # Handing over the keeper

    def offer(
        self, to: str, newcomer: Newcomer | None, accounts: dict[str, str], invited: list[str]
    ) -> Offer:
        """The family offered to one of its computers: the keeper's keys and its list of the
        family's computers, locked for that computer alone and signed with the keeper's key, in
        offers/. Not kept to put back: withdrawn, it stays gone."""
        offer = Offer(
            id=secrets.token_hex(8),
            to=to,
            made=_now(),
            keys=self._keys(),
            recovery=self.recovery.hex(),
            known={device: KnownComputer(**asdict(known)) for device, known in self.known.items()},
            accounts=accounts,
            invited=invited,
            decided=sorted(self.decided),
            newcomer=newcomer,
        )
        context = b"offer " + to.encode()
        locked = seal_for(
            bytes.fromhex(self.known[to].dh), offer.model_dump_json().encode(), context
        )
        Computer._write(
            self, f"offers/{to}.bin", seal(Kind.OFFER, f"offer/{to}", locked, self.sign, None)
        )
        return offer

    def leave_helping(self, helping: Helping) -> None:
        """For another of the keeper's own computers, allowed to invite and let in for it, or
        no longer: signed with the keeper's key and locked for that computer alone, beside
        the offers, and like them never put back by repair: it's written again soon enough."""
        device = helping.device
        context = b"helping " + device.encode()
        locked = seal_for(
            bytes.fromhex(self.known[device].dh), helping.model_dump_json().encode(), context
        )
        blob = seal(Kind.HELPING, f"helping/{device}", locked, self.sign, None)
        Computer._write(self, f"helping/{device}.bin", blob)

    def last_instruction(self, device: str) -> int:
        """The highest number of a computer's instructions here, read or not: 0 for none."""
        return max(
            (
                int(path.stem)
                for path in (self.folder / "instructions" / device).glob("*.ins")
                if len(path.stem) == 8 and path.stem.isascii() and path.stem.isdigit()
            ),
            default=0,
        )

    def instructions(self, device: str, after: int) -> list[tuple[int, Instruction | None]]:
        """A computer's instructions numbered after `after`, from its own folder, in order:
        each checked as that computer's own, signed with its key and locked for this computer,
        its number in its place; None for one that doesn't check out. Only those named as the
        app names them, eight digits, are read: so they're read in order (0.8.0)."""
        known = self.known.get(device)
        found: list[tuple[int, Instruction | None]] = []
        for path in sorted((self.folder / "instructions" / device).glob("*.ins")):
            stem = path.stem
            if len(stem) != 8 or not (stem.isascii() and stem.isdigit()) or int(stem) <= after:
                continue
            number = int(stem)
            blob = self._read(path)
            if blob is None:
                continue
            try:
                if known is None:
                    raise RefusedError("from a computer the family doesn't know")
                if len(blob) > SMALL:
                    raise RefusedError("larger than an instruction is")
                opened = unseal(
                    blob,
                    f"instruction/{device}/{number}",
                    Kind.INSTRUCTION,
                    {bytes.fromhex(known.sign)},
                    None,
                )
                context = b"instruction " + f"{device}/{number}".encode()
                instruction = Instruction.model_validate_json(
                    open_for(self.dh, opened.payload, context)
                )
                if instruction.device != device or instruction.number != number:
                    raise RefusedError("not the instruction its place says")
            except (RefusedError, ValidationError, ValueError) as error:
                self._refused(path, error)
                found.append((number, None))
                continue
            self._cleared(path)
            found.append((number, instruction))
        return found

    def about(self, device: str) -> About | None:
        """What a relative's computer says of itself, from its own folder: checked, as that
        computer's own. None from a computer before 0.5.0, which writes none."""
        known = self.known.get(device)
        path = self.folder / "about" / f"{device}.bin"
        blob = self._read(path)
        if known is None or blob is None:
            return None
        try:
            signer = {bytes.fromhex(known.sign)}
            opened = unseal(blob, f"about/{device}", Kind.ABOUT, signer, None)
            about = About.model_validate_json(opened.payload)
            if about.device != device:
                raise RefusedError("for another computer")
        except (RefusedError, ValidationError) as error:
            self._refused(path, error)
            return None
        self._cleared(path)
        return about

    def taken_over(self, offers: set[str]) -> TookOver | None:
        """The new keeper's word, from a relative's own folder, that it took the family on one
        of `offers`, those this computer made: signed with the keeper's key, which no other
        computer had but the one it was offered to."""
        for path in sorted((self.folder / "took").glob("*.bin")):
            blob = self._read(path)
            if blob is None:
                continue
            try:
                opened = unseal(blob, f"took/{path.stem}", Kind.TOOK, {self.keeper}, None)
                took = TookOver.model_validate_json(opened.payload)
            except (RefusedError, ValidationError) as error:
                self._refused(path, error)
                continue
            if took.offer in offers:
                return took
        return None

    def write_took(self, device: str, offer: str, folder: str) -> None:
        """This computer's word, as the new keeper, that it took the family on `offer`, and
        where the family folder is now: in the folder that was its own as `device`, which the
        old keeper reads."""
        took = TookOver(offer=offer, folder=folder, made=_now())
        blob = seal(Kind.TOOK, f"took/{device}", took.model_dump_json().encode(), self.sign, None)
        Computer._write(self, f"took/{device}.bin", blob)

    @classmethod
    def take_over(
        cls, member: Member, offer: Offer, name: str, *, new_code: bool
    ) -> tuple[Keeper, str]:
        """The keeper, on the computer the family was offered to: the keeper's keys, list and
        answers from the offer; the old keeper let in under the identity it offered; this
        computer's old place as a relative off the list; and the record told at once, so the
        old keeper stops. Another person's computer gets a new recovery code, which the old
        one no longer opens; the code, or "" for a computer of the keeper's own."""
        keeper = cls(member.folder, member.data)
        keeper.family, keeper.keeper = member.family, member.keeper
        keeper._take_keys(offer.keys)
        keeper.role = "keeper"
        keeper.receive()
        keeper.known = {
            device: Known(**known.model_dump()) for device, known in offer.known.items()
        }
        keeper.decided = set(offer.decided)
        keeper._remember_answers()
        code = recovery_code() if new_code else ""
        keeper.recovery = (
            recovery_key(code, keeper.family) if code else bytes.fromhex(offer.recovery)
        )
        keeper.known[keeper.device].name = name
        changes: list[RecordOp] = [Joined(device=keeper.device, name=name, role="keeper")]
        if member.device in keeper.known:
            keeper.known[member.device].role = "removed"
            changes.append(Removed(device=member.device))
        newcomer = offer.newcomer
        if newcomer is not None:
            keeper.known[newcomer.device] = Known(
                name=newcomer.name, role=newcomer.role, sign=newcomer.sign, dh=newcomer.dh
            )
            keeper._write_member(newcomer.device)
            changes.append(Joined(device=newcomer.device, name=newcomer.name, role=newcomer.role))
        if code:
            kept = keeper._write_recovery()
            for path in (keeper.folder / "recovery").glob("*.bin"):
                if path.relative_to(keeper.folder).as_posix() != kept:
                    path.unlink()  # locked with the old code: never in the new folder
        keeper.publish(changes)
        return keeper, code

    def adopt_folder(self) -> None:
        """Every file of the family folder here, as this computer's own to put back: the new
        keeper's, whose family folder it is now, all of it."""
        for path in sorted(self.folder.rglob("*")):
            relative = path.relative_to(self.folder).as_posix()
            if path.is_file() and relative.startswith(FAMILY_FOLDER_FILES):
                copy = self.data / "published" / relative
                copy.parent.mkdir(parents=True, exist_ok=True)
                copy.write_bytes(path.read_bytes())

    @staticmethod
    def opens(family: bytes, recovery: bytes, version: int, code: str) -> bool:
        """Whether a recovery code opens a family folder's recovery file: its `family.json`,
        and its newest recovery file, `recovery/<version>.bin`."""
        try:
            found = FamilyFile.model_validate_json(family)
            unseal(
                recovery,
                f"recovery/{version}",
                Kind.RECOVERY,
                {bytes.fromhex(found.keeper_sign)},
                recovery_key(code, found.family),
            )
        except RefusedError, ValidationError, ValueError:
            return False
        return True

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
        keeper._take_keys(Recovery.model_validate_json(opened.payload))
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
