"""The family folder in the app.

One for the app. It holds this computer's part in its family's folder: the Google sign-in, how
the computer takes part (as the keeper, or a relative's), the copy of the folder, and the
spike's computer (computers.py) that reads and writes it. What it keeps lives in
DATA_DIR/familyfolder/, which backups leave out: the keys there are this computer's alone.

The family folder in Drive holds the keeper's files alone, shared for relatives' accounts to
read. A relative's computer writes in a folder of its own, in its own Drive, shared for the
keeper's account to read: its join request, and later what it sends the keeper. Drive won't let
an app change who reaches a folder holding files that app may not change, so with nobody
else's files in it, the keeper's app can share the family folder and stop sharing it within
the permission D41 chose.

Once a minute while the app runs, `sync()`:

- brings down what's new in the family folder in Google Drive and, on the keeper's computer,
  in relatives' own folders;
- on the keeper's computer, puts back whatever of its own went missing, and publishes what
  changed in the family since;
- on a relative's, takes in what the keeper published and, when the family changed, restores
  it here, keeping this computer's own "Me", language and layout, and its own changes on top
  until the keeper has answered them;
- on a relative's that may send changes, sends its family when it changed since: the keeper
  reviews it, as a copy to edit's changes were reviewed;
- sends up what this computer wrote: the keeper's to the family folder, a relative's to its
  own;
- on the keeper's computer, lists the changes waiting from relatives' computers, and brings in
  a trusted computer's unless they clash, take something out or ask about a look-alike; then
  stops sharing the family folder with the accounts it removed.

What Drive can't do just then waits for the next round, with the reason in `problem`. What a
person asks for that Google, Drive or this computer can't do comes back as a plain sentence.

Only one computer keeps the family at a time. One brought back as the keeper with the recovery
code says so in the record at once; the keeper's computer it replaces sees the record move on
without it, and stops publishing (`replaced`), so the record never splits in two.

Since 0.4.0 each family signs in through its own Google project: the keeper gives AncesTree its
client's file, and relatives' computers take it from the keeper's invitation (invitations.py).
Folders in Drive carry the family's id in their names, so one Google account can keep several
families' folders, and a keeper of two never mixes their relatives' computers.

The keeper's computer holds every file of the family folder, so a family folder lost from Drive
is made again from it (`rebuild`), with the same keys and record; the same moves it to another
Google account or project. A relative's computer whose family folder has gone looks for the
same family, by its id and its keeper's signing key, among the folders shared with it, and
follows it there by itself (`_follow`).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import json
import logging
import re
import secrets
import shutil
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any, Literal

from ancestree.domain.familyfolder import (
    Admit,
    BringIn,
    FamilyFolderStatus,
    FolderAnswer,
    FolderAsking,
    FolderChanges,
    FolderMember,
    Invite,
    JoinFamily,
    OneComputer,
    Recover,
    ReviewChanges,
    SharedFolder,
    StartFamily,
    TurnDown,
)
from ancestree.domain.imports import ChangesPreview, ImportDone
from ancestree.exchange.restore import restore_archive
from ancestree.exchange.returned import ReturnedError, sent_family
from ancestree.familyfolder.changes import (
    UnpackError,
    arranged,
    family_to_send,
    own_changes,
    pack,
    rebased,
    records,
    unpack,
)
from ancestree.familyfolder.computers import MAY_SEND, Arrived, Keeper, Member
from ancestree.familyfolder.drive import Drive, DriveError, DriveLike, RemoteFile
from ancestree.familyfolder.entries import Entries, build_archive, changes_between, family_entries
from ancestree.familyfolder.google import (
    Client,
    ClientFileError,
    GoogleError,
    OfflineError,
    ProjectGoneError,
    Session,
    SignedOutError,
    SignIn,
    Tokens,
)
from ancestree.familyfolder.invitations import Invitation, InvitationError
from ancestree.familyfolder.mirror import Mirror
from ancestree.familyfolder.models import FamilyFile, Joined, Source
from ancestree.familyfolder.protect import ProtectError, read_secret, write_secret
from ancestree.familyfolder.seals import RefusedError, join_code
from ancestree.importing.returned import Base
from ancestree.repo.export import export_graph
from ancestree.services import returns
from ancestree.services.biography import biography_from
from ancestree.services.context import Context, NotFoundError, RuleError
from ancestree.services.history import History
from ancestree.storage.biography import BIOGRAPHY

FOLDER_NAME = "AncesTree family"
# Since 0.4.0, "<FOLDER_NAME> (<family>)": the family's id, as its family.json has it.
FOLDER_NAMED = re.compile(re.escape(FOLDER_NAME) + r"(?: \(([0-9a-f]{16})\))?")
# Made by the keeper at the start, so no two computers ever make the same one at once.
SUBFOLDERS = ("members", "record", "snapshots", "notes", "files", "recovery")
# A relative's computer's own folder, in its own Drive: "<OWN_FOLDER> (<family>, <computer>)";
# before 0.4.0, "<OWN_FOLDER> (<computer>)".
OWN_FOLDER = f"{FOLDER_NAME} - to the keeper"
OWN_FOLDER_NAMED = re.compile(re.escape(OWN_FOLDER) + r" \((?:([0-9a-f]{16}), )?([0-9a-f]{16})\)")
# The family's own Google client (0.4.0), and an invitation waiting to be joined, in the
# family folder's part of the data folder.
CLIENT = "google-client.bin"
JOINING = "joining.json"
# What relatives' computers write, in their own folders. In each computer's copy, it sits
# beside the family folder's files, as computers.py reads it.
RELATIVES = ("join/", "inbox/")
EVERY = 60.0  # seconds between syncs while the app runs
SOON = 5.0  # seconds after a change here before its round, as more changes may follow (0.4.0)
SNAPSHOT_EVERY = 10  # change sets between snapshots of the whole family

BROKEN = (
    "This computer's part in the family folder can't be opened here: its keys were kept by "
    "another Windows user, or on another computer. Leave the family folder here, then join it "
    "again; or, as the keeper, be the keeper again with your recovery code."
)
REPLACED = (
    "Another computer is the family's keeper now: the family's record has moved on without "
    "this one, as when the keeper comes back on a new computer with the recovery code. This "
    "computer no longer keeps the family folder: leave it here, and keep the family on the "
    "other computer. To keep it on this one instead, leave it here, then be the keeper again "
    "with your recovery code."
)
# What a relative hears when what it sent couldn't be read, and was turned down.
UNREADABLE = "Everything you sent: it couldn't be read on the keeper's computer"
# The family folder gone from Drive (0.4.0): on the keeper's computer, which can make it again,
# and on a relative's, which found no moved one to follow.
LOST = (
    "The family folder can't be found in your Google Drive. If it's in Drive's bin, take it "
    "out; if it's gone, rebuild it from this computer: everyone's computers follow it."
)
LOST_RELATIVE = (
    "The family folder isn't shared with this Google account any more, and no moved one was "
    "found. If your keeper started it again, they'll send a new invitation: leave this family "
    "folder, then join with it."
)
FOREIGN = (
    "The family folder was made through another Google project, and this one can't change "
    "it: rebuild the family folder through this project, and relatives' computers follow it."
)
# Drive's reason when this project may read a file, through drive.readonly, but not change it.
NOT_THIS_PROJECTS = "appNotAuthorizedToFile"
OLD_FOLDER = (
    "The family's old folder is still in Google Drive, where relatives' computers keep reading "
    "it: delete it there, so they move to the new one."
)

log = logging.getLogger("uvicorn.error")


@dataclass
class Setup:
    """How this computer takes part, in DATA_DIR/familyfolder/setup.json."""

    role: Literal["keeper", "member"]
    folder: str  # the family folder's id in Google Drive
    family: str  # the family's name: the keeper's own; a relative's, once received
    computer: str  # this computer's name, as the family sees it
    account: str  # the Google account the folder was started or joined with
    snapshot: int = 0  # the keeper's newest snapshot, by change set
    restored: str = ""  # a relative's: a fingerprint of the family last restored here
    received: str = ""  # and when it was restored, as ISO 8601
    refused: list[str] = field(default_factory=list)  # the keeper's: computers turned away
    # The keeper's: accounts the folder is to stop being shared with, until Drive has done it.
    unshare: list[str] = field(default_factory=list)
    # The keeper's: the Google account of each relative's computer, whose own folder it is.
    accounts: dict[str, str] = field(default_factory=dict)
    own_folder: str = ""  # a relative's: its own folder's id, in its own Drive
    # A relative's: the record's change set the family here was last restored from; the
    # newest of its proposals the keeper has answered, and the newest the family here was
    # rebuilt after; the newest answer seen here; and when it last sent its changes.
    restored_seq: int = 0
    answered: int = 0
    rebuilt: int = 0
    seen: int = 0
    sent_at: str = ""
    # The keeper's: when it saw another computer keeping the family, and stopped (0.3.1).
    replaced: str = ""
    # The keeper's: recovery files locked with a code no longer in use, to take out of the
    # folder in Drive once the newest is there (0.3.1).
    retire: list[str] = field(default_factory=list)
    # The keeper's, brought back with the recovery code: until the family has arrived here
    # whole, nothing is published, or what's missing here would be taken out for everyone.
    recovering: bool = False
    # When the family was last in step, and, on the keeper's computer, when it last published
    # a change: kept across restarts (0.4.0).
    in_step: str = ""
    published: str = ""
    # The keeper's (0.4.0): the family folder it moved from, while that's still in Drive, where
    # relatives' computers would keep reading it.
    moved_from: str = ""


def _fingerprint(entries: Entries) -> str:
    return hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()


def _counted(changes: dict[str, Any]) -> int:
    """The people and links a computer changed: a person once, however many of their files."""
    people = {key.split("/")[2] for key in changes if key.startswith("file/people/")}
    people |= {key.removeprefix("person/") for key in changes if key.startswith("person/")}
    return len(people) + sum(key.startswith("link/") for key in changes)


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _family_files(path: str) -> bool:
    """The family folder's files, in a computer's copy: all but what relatives write."""
    return not path.startswith(RELATIVES)


def _relatives_files(device: str) -> Callable[[str], bool]:
    """One relative's computer's files, in a computer's copy: its join request, and what it
    sends the keeper."""
    return lambda path: path == f"join/{device}.req" or path.startswith(f"inbox/{device}/")


class FamilyFolder:
    def __init__(
        self,
        ctx: Context,
        *,
        client: Client | None = None,
        drive: Callable[[Session], DriveLike] | None = None,
        replaced: Callable[[], None] = lambda: None,
        graph: Callable[[], Awaitable[dict[str, Any]]] | None = None,
        restore: Callable[[Path, bool], Awaitable[object]] | None = None,
        history: History | None = None,
        on_round: Callable[[FamilyFolder], None] | None = None,
    ) -> None:
        self.ctx = ctx
        self.dir = ctx.data_dir / "familyfolder"
        self.problem = ""
        self.client = client if client is not None else self._kept_client()
        self._make_drive: Callable[[Session], DriveLike] = drive or (
            lambda session: Drive(session.access_token)
        )
        # When a received family replaces this one: Undo's history is about a family now gone.
        self._replaced = replaced
        # The family as the database holds it, and replacing it: tests stand in for both.
        self._graph = graph or (lambda: export_graph(ctx.driver, ctx.database))
        self._restore = restore or (
            lambda archive, backup_first: restore_archive(ctx, archive, backup_first=backup_first)
        )
        self.history = history or History()  # the app's Undo, for relatives' changes
        self.lock = asyncio.Lock()
        self.session: Session | None = None
        self.drive: DriveLike | None = None
        self.signing_in: SignIn | None = None
        self.setup: Setup | None = None
        self.computer: Keeper | Member | None = None
        self.mirror: Mirror | None = None
        self.last_sync: datetime | None = None  # when the last round went through
        self.tried: datetime | None = None  # when the last round was tried, through or not
        self.went_through = False  # whether it went through: what `problem` says is a note
        self.lost = False  # the last round found the family folder gone from Drive (0.4.0)
        # What stood in the last round's way, as a code for the indicator at the top (0.4.0):
        # "offline", "signed_out", "project", "lost", "problem", or "" for nothing.
        self.trouble = ""
        # The keeper moving the family folder to another Google account or project (0.4.0):
        # a sign-in with another account is let through, for the rebuild.
        self.moving = False
        # The sign-in the keeper is moving from, kept until the rebuild has put the old family
        # folder in Drive's bin with it: the new account, or the new project, can't.
        self._before: Session | None = None
        self.syncing = False  # a round is under way
        # Told after each round, as the desktop app's engine is: for its families' list and
        # the tooltip by the clock (0.4.0).
        self._on_round = on_round
        # A change made here, or Sync now from the icon by the clock: a round soon (0.4.0).
        self.nudged = asyncio.Event()
        self.now = False  # the round asked for is wanted at once: Sync now
        self._loop: asyncio.AbstractEventLoop | None = None
        # The family an invitation names, while this computer hasn't asked to join it yet.
        self.invited: str | None = None
        # The keeper's new recovery code, until they've kept it: shown until then, even after
        # a restart, and then never again.
        self.recovery_code: str | None = None
        self.pending = 0  # a relative's: the people and links it changed, as last counted
        self.waiting: list[FolderChanges] = []  # the keeper's: changes to review, as last read
        self.broken = ""  # why this computer's part can't be opened here, if it can't
        self._load()

    # Where things are kept

    @property
    def local(self) -> Path:
        return self.dir / "folder"  # this computer's copy of the family folder

    @property
    def data(self) -> Path:
        return self.dir / "computer"  # its keys and copy of the family, locked

    def _kept_client(self) -> Client | None:
        """The family's own Google client, kept here (0.4.0); None if there's none yet, or it
        can't be opened on this computer, which is said."""
        try:
            return Client.find(self.dir / CLIENT)
        except (ProtectError, OSError, ValueError, KeyError) as error:
            log.warning("The family's Google project kept here can't be opened: %s", error)
            self.problem = (
                "The family's Google project kept here can't be opened on this computer: give "
                "it AncesTree again."
            )
            return None

    def _load(self) -> None:
        """What this computer kept, as the app starts. What can't be opened here (kept by
        another Windows user, or on another computer) never stops the app: it's said instead,
        and the family folder waits to be left."""
        joining = self._read(self.dir / JOINING)
        if isinstance(joining, dict) and isinstance(joining.get("family"), str):
            self.invited = joining["family"]
        if self.client is not None:
            try:
                tokens = Tokens.load(self.dir / "google.bin")
            except (ProtectError, OSError, ValueError, KeyError) as error:
                log.warning("The Google sign-in kept here can't be opened: %s", error)
                tokens = None
                self.problem = (
                    "The sign-in to Google kept here can't be opened on this computer: sign in "
                    "again."
                )
            if tokens is not None:
                self._signed_in(self.client, tokens)
        setup = self.dir / "setup.json"
        if setup.is_file():
            try:
                self.setup = Setup(**json.loads(setup.read_text(encoding="utf-8")))
                if self.setup.in_step:
                    self.last_sync = datetime.fromisoformat(self.setup.in_step)
                kind = Keeper if self.setup.role == "keeper" else Member
                self.computer = kind.load(self.local, self.data)
            except (ProtectError, OSError, ValueError, KeyError, TypeError) as error:
                log.warning("This computer's part in the family folder can't be opened: %s", error)
                self.computer = None
                self.broken = BROKEN
                return
            self._make_mirror()
        try:
            code = read_secret(self.dir / "recovery-code.bin")
        except (ProtectError, OSError) as error:
            log.warning("The recovery code kept to show can't be opened: %s", error)
            code = None
        if code is not None and isinstance(self.computer, Keeper):
            self.recovery_code = code.decode()

    @staticmethod
    def _write_text(path: Path, text: str) -> None:
        """A file written whole: under a temporary name, then renamed, so a power cut never
        leaves half of it."""
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_text(text, encoding="utf-8")
        partial.replace(path)

    def _save_setup(self) -> None:
        if self.setup is None:
            return
        self._write_text(self.dir / "setup.json", json.dumps(asdict(self.setup), indent=1))

    def _keep_code(self, code: str) -> None:
        """A new recovery code, shown until the keeper has kept it, even after a restart: it's
        locked here as the keys are, and forgotten once they say so."""
        self.recovery_code = code  # shown whatever happens next: there's no other copy
        try:
            write_secret(self.dir / "recovery-code.bin", code.encode())
        except (ProtectError, OSError) as error:
            log.warning("The new recovery code couldn't be kept to show after a restart: %s", error)

    def _signed_in(self, client: Client, tokens: Tokens) -> None:
        self.session = Session(client, tokens)
        self.drive = self._make_drive(self.session)

    def _make_mirror(self) -> None:
        if self.setup is None or self.drive is None or self.session is None:
            self.mirror = None
            return
        self.mirror = self._family_mirror(self.drive, self.setup.folder, self.session.email)

    def _family_mirror(self, drive: DriveLike, folder: str, me: str) -> Mirror:
        return Mirror(drive, folder, self.local, self.dir / "mirror.json", me, _family_files)

    def _relatives_mirror(self, drive: DriveLike, folder: str, device: str) -> Mirror:
        """A relative's computer's own folder in Drive, as this computer's copy holds it. Its
        state is the folder's own: a computer whose family moved to another Google project
        makes a new own folder beside the old (0.4.0)."""
        me = self.session.email if self.session else ""
        state = self.dir / "relatives" / f"{device}-{folder}.json"
        return Mirror(drive, folder, self.local, state, me, _relatives_files(device))

    def _clear_local(self) -> None:
        """A fresh start, before starting or joining a family. Nothing here holds anyone's
        keys yet: this computer takes part in no family."""
        for name in ("folder", "computer", "received", "relatives", "sent"):
            shutil.rmtree(self.dir / name, ignore_errors=True)
        for name in ("mirror.json", "named.json", "received.json", "recovery-code.bin"):
            (self.dir / name).unlink(missing_ok=True)
        self.pending, self.waiting, self.recovery_code = 0, [], None

    # Signing in to Google

    async def sign_in(self) -> str:
        """Start a sign-in: Google's page, for the browser."""
        if self.client is None:
            raise RuleError(
                "no_google_client",
                "This family has no Google project to sign in through yet. The keeper gives "
                "AncesTree the project's client file; a relative pastes the keeper's invitation.",
            )
        if self.signing_in is not None:
            self.signing_in.close()
        hint = self.setup.account if self.setup else (self.session.email if self.session else "")
        self.signing_in = SignIn(self.client, hint)
        self.problem = ""
        return self.signing_in.url

    async def _finish_sign_in(self) -> None:
        waiting = self.signing_in
        if waiting is None:
            return
        if waiting.answer is None:
            if waiting.expired:
                waiting.close()
                self.signing_in = None
                self.problem = "The sign-in to Google wasn't finished in time. Start it again."
            return
        self.signing_in = None
        client = waiting.client
        try:
            tokens = await asyncio.to_thread(waiting.finish)
            if tokens is None:
                return
        except (GoogleError, OfflineError) as error:
            self.problem = str(error)
            return
        # A sign-in not kept is given back to Google at once (0.4.0): kept nowhere, it would
        # only stay on that account's list of apps with access to it.
        give_back = Session(client, tokens).sign_out
        try:
            drive = self._make_drive(Session(client, tokens))
            tokens.email = await asyncio.to_thread(drive.account)
        except (GoogleError, OfflineError, DriveError) as error:
            await asyncio.to_thread(give_back)
            self.problem = str(error)
            return
        if (
            self.setup
            and not self.moving
            and tokens.email.casefold() != self.setup.account.casefold()
        ):
            await asyncio.to_thread(give_back)
            self.problem = (
                f"That was {tokens.email}. This computer's family folder is with "
                f"{self.setup.account}: sign in with that account."
            )
            return
        try:
            tokens.save(self.dir / "google.bin")
        except (ProtectError, OSError) as error:
            await asyncio.to_thread(give_back)
            self.problem = f"The sign-in to Google couldn't be kept on this computer ({error})."
            return
        self._signed_in(client, tokens)
        self._make_mirror()
        self.problem = self.broken

    async def sign_out(self) -> None:
        async with self.lock:
            if self.signing_in is not None:
                self.signing_in.close()
                self.signing_in = None
            if self.session is not None:
                await asyncio.to_thread(self.session.sign_out)
            (self.dir / "google.bin").unlink(missing_ok=True)
            self.session = self.drive = self.mirror = None

    # The family's own Google project (0.4.0)

    async def _keep_client(self, client: Client) -> None:
        """The family's Google client, kept here. A sign-in belongs to the client it was made
        with, so one made with another is given back: sign in again. One the keeper is moving
        from is kept until the rebuild is done with it."""
        if client != self.client:
            if self.signing_in is not None:
                self.signing_in.close()
                self.signing_in = None
            if self.moving and self.session is not None and self._before is None:
                self._before = self.session
            elif self.session is not None:
                await asyncio.to_thread(self.session.sign_out)
            (self.dir / "google.bin").unlink(missing_ok=True)
            self.session = self.drive = self.mirror = None
        try:
            await asyncio.to_thread(client.keep, self.dir / CLIENT)
        except (ProtectError, OSError) as error:
            raise RuleError(
                "cant_be_locked",
                f"The family's Google project couldn't be kept on this computer ({error}).",
            ) from error
        self.client = client
        self.problem = self.broken

    async def use_project(self, text: str, *, moving: bool = False) -> None:
        """The family's own Google project, from the file Google's console gives for its
        client: for a computer starting a family folder, or its keeper's. A relative's
        computer takes the project from the keeper's invitation instead. Once the family folder
        is started, a client of the same project can take over (sign in again); another
        project's can't reach the folder's files."""
        async with self.lock:
            if self.broken:
                raise RuleError("cant_be_opened", self.broken)
            try:
                client = Client.from_file(text)
            except ClientFileError as error:
                raise RuleError("not_a_client_file", str(error)) from error
            setup = self.setup
            if setup is not None and setup.role == "member":
                raise RuleError(
                    "project_from_the_keeper",
                    "This computer takes the family's Google project from its keeper's "
                    "invitation: paste the newest one instead.",
                )
            client_now = self.client
            if (
                setup is not None
                and client_now is not None
                and client.number != client_now.number
                and not moving
            ):
                raise RuleError(
                    "other_project",
                    f"That client is from another Google project. The family folder was made "
                    f"through {client_now.name}, so only that project's clients can keep it.",
                )
            if moving:
                self._moving()
            await self._keep_client(client)
            # An invitation pasted before brought another project: it's set aside with it.
            self.invited = None
            (self.dir / JOINING).unlink(missing_ok=True)

    async def take_invitation(self, text: str) -> None:
        """A keeper's invitation, pasted on a relative's computer: its Google project becomes
        this family's, to sign in through, and the family it names is the one to join. On a
        computer already in that family, a newer invitation brings the family's new project."""
        async with self.lock:
            if self.broken:
                raise RuleError("cant_be_opened", self.broken)
            try:
                invitation = Invitation.read(text)
            except InvitationError as error:
                raise RuleError("not_an_invitation", str(error)) from error
            setup, computer = self.setup, self.computer
            if setup is not None and setup.role == "keeper":
                raise RuleError(
                    "keepers_own",
                    "This computer keeps a family folder: invitations are for the relatives "
                    "you invite.",
                )
            if setup is not None and (computer is None or computer.family != invitation.family):
                raise RuleError(
                    "another_family",
                    "That invitation is to another family. To join it on this computer, add a "
                    "family for it, or leave this family folder first.",
                )
            moved = self.client is not None and self.client.number != invitation.client.number
            await self._keep_client(invitation.client)
            if setup is not None and moved:
                # The new project's client can't write in the own folder the old one made: a
                # new one is made at the next round (0.4.0).
                setup.own_folder = ""
                self._save_setup()
            if setup is None:
                self.invited = invitation.family
                await asyncio.to_thread(
                    self._write_text, self.dir / JOINING, json.dumps({"family": invitation.family})
                )

    def invitation(self) -> Invitation:
        """The family's invitation, for its keeper to send to the relatives they invite."""
        computer, setup = self.computer, self.setup
        if not isinstance(computer, Keeper) or setup is None:
            raise RuleError("not_the_keeper", "Only the family's keeper can invite.")
        if setup.replaced:
            raise RuleError("replaced", REPLACED)
        if self.client is None:
            raise RuleError("no_google_client", "Give AncesTree the family's Google project first.")
        own = Client(self.client.client_id, self.client.client_secret, self.client.project)
        return Invitation(own, computer.family)

    def _own_account(self) -> str:
        """The Google account this computer keeps its family folder with."""
        if self.session is not None:
            return self.session.email
        return self.setup.account if self.setup else ""

    def _ready(self, *, set_up: bool) -> tuple[DriveLike, Session]:
        """Drive and the sign-in, when this computer is signed in and does (or doesn't
        yet) take part in a family folder."""
        if self.broken:
            raise RuleError("cant_be_opened", self.broken)
        if self.drive is None or self.session is None:
            raise RuleError("signed_out", "Sign in to Google first.")
        if set_up and self.setup is None:
            raise RuleError("no_family_folder", "This computer takes part in no family folder.")
        if not set_up and self.setup is not None:
            raise RuleError(
                "family_folder_set_up", "This computer already takes part in a family folder."
            )
        return self.drive, self.session

    def _keeper(self) -> tuple[Keeper, DriveLike, Setup]:
        drive, _ = self._ready(set_up=True)
        if not isinstance(self.computer, Keeper) or self.setup is None:
            raise RuleError("not_the_keeper", "Only the family's keeper can do that.")
        if self.setup.replaced:
            raise RuleError("replaced", REPLACED)
        return self.computer, drive, self.setup

    def _signed_out(self) -> None:
        """The sign-in has ended (taken back in the Google account, or expired): forgotten
        here. The family folder stays, waiting for a new one."""
        (self.dir / "google.bin").unlink(missing_ok=True)
        self.session = self.drive = self.mirror = None

    @contextlib.contextmanager
    def _plainly(self) -> Iterator[None]:
        """What Google, Drive, the family folder's files or this computer's own lock can say,
        as a plain sentence for the person who asked: never a failure without one."""
        try:
            yield
        except OfflineError as error:
            raise RuleError(
                "offline", "Google Drive can't be reached: check the internet."
            ) from error
        except SignedOutError as error:
            self._signed_out()
            raise RuleError(
                "signed_out", "The sign-in to Google has ended: sign in again."
            ) from error
        except GoogleError as error:
            raise RuleError("google_said_no", str(error)) from error
        except DriveError as error:
            raise RuleError("drive_said_no", str(error)) from error
        except RefusedError as error:
            raise RuleError(
                "didnt_check_out",
                f"Something in the family folder didn't check out ({error}), so nothing here "
                "changed.",
            ) from error
        except ProtectError as error:
            raise RuleError(
                "cant_be_locked",
                f"This computer's keys couldn't be locked or opened here ({error}).",
            ) from error

    # What the app shows

    @property
    def editing(self) -> bool:
        """Whether everything about the family may be changed here: on the keeper's computer,
        or with no family folder. A relative's computer receives it."""
        return self.setup is None or self.setup.role == "keeper"

    def journaling(self) -> str | None:
        """Whom this computer's changes are journaled as: the keeper's computer by its
        name in the family, one with no family folder as itself (""). A relative's computer
        journals nothing of its own: the keeper's does, once its changes are brought in."""
        if self.setup is None:
            return ""
        return self.setup.computer if self.setup.role == "keeper" else None

    @property
    def proposing(self) -> bool:
        """Whether this is a relative's computer that sends its changes to the keeper:
        people, links, stories and photos change here as anywhere, and wait for the keeper.
        The family's own settings stay the keeper's."""
        return isinstance(self.computer, Member) and self.computer.role in MAY_SEND

    def _email_of(self, device: str) -> str:
        computer, setup = self.computer, self.setup
        if computer is not None and device == computer.device:
            return self.session.email if self.session else setup.account if setup else ""
        if computer is None or setup is None:
            return ""
        members: dict[str, Any] = computer.state["members"]
        if members.get(device, {}).get("role") == "keeper":
            # The keeper's, who started the folder.
            return self.mirror.owner("family.json") if self.mirror else ""
        return setup.accounts.get(device, "")  # a relative's, whose own folder it wrote in

    async def status(self) -> FamilyFolderStatus:
        await self._finish_sign_in()
        computer, setup = self.computer, self.setup
        members: list[FolderMember] = []
        asking: list[FolderAsking] = []
        code = None
        replaced = isinstance(computer, Keeper) and setup is not None and bool(setup.replaced)
        if isinstance(computer, Keeper) and setup is not None:
            for device, known in computer.known.items():
                members.append(
                    FolderMember(
                        device=device,
                        name=known.name,
                        role=known.role,
                        email=self._email_of(device),
                        you=device == computer.device,
                    )
                )
            refused = frozenset(setup.refused)
            for ask in [] if replaced else await asyncio.to_thread(computer.asking, refused):
                asking.append(
                    FolderAsking(
                        device=ask.device,
                        name=ask.name,
                        email=self._email_of(ask.device),
                        code=ask.code,
                    )
                )
        elif isinstance(computer, Member):
            for device, info in computer.state["members"].items():
                members.append(
                    FolderMember(
                        device=device,
                        name=info["name"],
                        role=info["role"],
                        email=self._email_of(device),
                        you=device == computer.device,
                    )
                )
            if computer.role == "waiting":
                code = join_code(
                    computer.keeper,
                    computer.sign.public_key().public_bytes_raw(),
                    computer.dh.public_key().public_bytes_raw(),
                )
        answers = [
            FolderAnswer(proposal=seq, left_out=note.left_out, note=note.note)
            for seq, note in sorted(computer.answers.items())
            if setup is not None and seq > setup.seen and (note.left_out or note.note)
        ] if isinstance(computer, Member) else []  # fmt: skip
        return FamilyFolderStatus(
            available=self.client is not None,
            email=self.session.email if self.session else None,
            signing_in=self.signing_in is not None,
            setup=setup.role if setup else None,
            family=setup.family if setup else "",
            role=computer.role if computer else None,
            code=code,
            members=members,
            asking=asking,
            last_sync=self.last_sync,
            received=datetime.fromisoformat(setup.received) if setup and setup.received else None,
            problem=self.broken or self.problem,
            recovery_code=self.recovery_code,
            pending=self.pending if self.proposing else 0,
            sent_at=datetime.fromisoformat(setup.sent_at) if setup and setup.sent_at else None,
            answers=answers,
            changes=list(self.waiting) if isinstance(computer, Keeper) and not replaced else [],
            broken=bool(self.broken),
            replaced=replaced,
            may_leave=self._may_leave(),
            project=self.client.name if self.client else "",
            project_invited=bool(self.client and self.client.invited),
            invited=setup is None and self.invited is not None,
            syncing=self.syncing,
            tried=self.tried,
            through=self.went_through,
            trouble=self.trouble,
            lost=self.lost,
            moving=self.moving,
            old_folder_left=bool(setup and setup.moved_from),
            published=(
                datetime.fromisoformat(setup.published) if setup and setup.published else None
            ),
        )

    def _may_leave(self) -> bool:
        """Whether this computer may leave its family folder: a relative's, whenever it likes;
        the keeper's only once another computer keeps the family, or its part can't be opened
        here. Otherwise the family would stop reaching everyone."""
        setup = self.setup
        if self.broken:
            return True
        if setup is None:
            return False
        return setup.role == "member" or bool(setup.replaced)

    def recovery_seen(self) -> None:
        self.recovery_code = None
        (self.dir / "recovery-code.bin").unlink(missing_ok=True)

    def answers_seen(self) -> None:
        """The keeper's answers read, on a relative's computer: they're not shown again."""
        computer, setup = self.computer, self.setup
        if isinstance(computer, Member) and setup is not None and computer.answers:
            setup.seen = max(setup.seen, max(computer.answers))
            self._save_setup()

    # Starting, joining, and coming back

    async def start(self, request: StartFamily) -> str:
        """Start the family's folder, with this computer as its keeper; the recovery code. The
        folder in Drive is named with the family's id, so one Google account can keep several
        families' folders; but one already there is asked about first, as it may be this
        family's, to keep again with the recovery code."""
        async with self.lock:
            with self._plainly():
                drive, session = self._ready(set_up=False)
                if self.client is not None and self.client.invited:
                    raise RuleError(
                        "project_from_an_invitation",
                        "This family's Google project came with an invitation to someone "
                        "else's family. To start your own family's folder, give AncesTree your "
                        "own family's Google project first.",
                    )
                found = await self._family_folders(drive)
                if found and not request.another:
                    folders = "folder" if len(found) == 1 else "folders"
                    raise RuleError(
                        "family_folder_exists",
                        f"This Google account's Drive already holds {len(found)} AncesTree "
                        f"family {folders}. If one is this family's, be its keeper again with "
                        "your recovery code. If this is another family, start its own folder "
                        "beside it.",
                        count=len(found),
                    )
                family = secrets.token_hex(8)
                root = await asyncio.to_thread(
                    drive.create_folder, f"{FOLDER_NAME} ({family})", None
                )
                for name in SUBFOLDERS:
                    await asyncio.to_thread(drive.create_folder, name, root.id)
                self._clear_local()
                keeper, code = await asyncio.to_thread(
                    Keeper.start, self.local, self.data, request.computer, family
                )
                self.computer = keeper
                self.setup = Setup(
                    "keeper", root.id, request.family, request.computer, session.email
                )
                self._save_setup()
                self.invited = None
                (self.dir / JOINING).unlink(missing_ok=True)
                self._make_mirror()
                # Shown even if Drive fails just now, and after a restart until it's kept:
                # there's no other copy of it.
                self._keep_code(code)
            await self._in_step()
            return code

    async def shared(self) -> list[SharedFolder]:
        """Family folders shared with this Google account."""
        with self._plainly():
            drive, _ = self._ready(set_up=False)
            found: list[SharedFolder] = []
            for folder in await asyncio.to_thread(drive.shared_folders, FOLDER_NAME):
                if FOLDER_NAMED.fullmatch(folder.name) is None:
                    continue
                if await asyncio.to_thread(self._family_in, drive, folder) is not None:
                    found.append(SharedFolder(id=folder.id, owner=folder.owner))
            return found

    @staticmethod
    def _family_in(drive: DriveLike, folder: RemoteFile) -> FamilyFile | None:
        """The family a folder in Drive holds, by its family.json; None if it holds none."""
        for child in drive.children(folder.id):
            if child.name == "family.json" and not child.folder:
                try:
                    return FamilyFile.model_validate_json(drive.download(child.id))
                except ValueError:
                    return None
        return None

    async def _invited_folder(self, drive: DriveLike, email: str) -> str:
        """The family folder the pasted invitation names: shared with this account, or, for a
        computer of the keeper's own, in this account's own Drive."""
        if self.invited is None:
            raise RuleError(
                "no_invitation", "Paste the invitation your family's keeper sent you first."
            )
        folders = [
            *await asyncio.to_thread(drive.shared_folders, FOLDER_NAME),
            *await asyncio.to_thread(drive.own_folders, FOLDER_NAME, starting=True),
        ]
        for folder in folders:
            if FOLDER_NAMED.fullmatch(folder.name) is None:
                continue
            family = await asyncio.to_thread(self._family_in, drive, folder)
            if family is not None and family.family == self.invited:
                return folder.id
        raise RuleError(
            "not_shared_yet",
            f"The family folder isn't shared with {email} yet. Ask your family's keeper to "
            "invite this Google account, then try again.",
        )

    async def join(self, request: JoinFamily) -> None:
        """Ask to join the family in a folder shared with this account: the one the pasted
        invitation names, unless another's given. The request goes in a folder of this
        computer's own, in this account's Drive, shared with the keeper's account; a computer
        of the keeper's own, signed in with the keeper's account, keeps it in their Drive."""
        async with self.lock:
            with self._plainly():
                drive, session = self._ready(set_up=False)
                folder = request.folder or await self._invited_folder(drive, session.email)
                self._clear_local()
                mirror = self._family_mirror(drive, folder, session.email)
                await self._reach(mirror.pull)
                if not (self.local / "family.json").is_file():
                    raise RuleError("not_a_family_folder", "That folder holds no AncesTree family.")
                keeper = mirror.owner("family.json")
                member, _ = await asyncio.to_thread(
                    Member.ask_to_join, self.local, self.data, request.computer
                )
                own = await self._reach(
                    lambda: drive.create_folder(
                        f"{OWN_FOLDER} ({member.family}, {member.device})", None
                    )
                )
                if keeper.casefold() != session.email.casefold():
                    await self._reach(lambda: drive.share(own.id, keeper))
                await self._reach(self._relatives_mirror(drive, own.id, member.device).push)
                self.computer, self.mirror = member, mirror
                self.setup = Setup(
                    "member", folder, "", request.computer, session.email, own_folder=own.id
                )
                self._save_setup()
                self.invited = None
                (self.dir / JOINING).unlink(missing_ok=True)
                self.last_sync, self.problem = datetime.now(UTC), ""

    async def recover(self, request: Recover) -> None:
        """This computer as the keeper again, from the recovery code: the family comes back
        from its folder, the one in this account's Drive the code opens. It says so in the
        record at once, so the computer it replaces sees the record move on, and stops keeping
        the family."""
        async with self.lock:
            with self._plainly():
                drive, session = self._ready(set_up=False)
                folder = request.folder or await self._opened_by(drive, request.code)
                self._clear_local()
                # The family folder's files alone: relatives' requests and changes, gathered
                # here later beside them, are never sent up into it as the keeper's.
                mirror = self._family_mirror(drive, folder, session.email)
                await self._reach(mirror.pull)
                try:
                    keeper = await asyncio.to_thread(
                        Keeper.recover, self.local, self.data, request.code
                    )
                except (RefusedError, ValueError, OSError) as error:
                    self._clear_local()
                    raise RuleError(
                        "not_recovered",
                        "That recovery code doesn't open this family folder. Check it, and try "
                        "again.",
                    ) from error
                name = keeper.state["members"].get(keeper.device, {}).get("name", "")
                family = keeper.state["people"].get("about", {}).get("name", "")
                await asyncio.to_thread(
                    keeper.publish, [Joined(device=keeper.device, name=name, role="keeper")]
                )
                self.computer, self.mirror = keeper, mirror
                self.setup = Setup("keeper", folder, family, name, session.email, recovering=True)
                self._save_setup()
                await self._take_in(backup_first=True)  # if a photo's still to come: next round
            await self._in_step()

    async def _family_folders(self, drive: DriveLike) -> list[str]:
        """The family folders in this account's own Drive: its folders named as family folders
        are, since 0.4.0 or before, that hold a family."""
        found: list[str] = []
        for folder in await asyncio.to_thread(drive.own_folders, FOLDER_NAME, starting=True):
            if FOLDER_NAMED.fullmatch(folder.name) is None:
                continue
            children = await asyncio.to_thread(drive.children, folder.id)
            if any(child.name == "family.json" and not child.folder for child in children):
                found.append(folder.id)
        return found

    async def _opened_by(self, drive: DriveLike, code: str) -> str:
        """The family folder in this account's own Drive that the recovery code opens: the one
        whose newest recovery file it unlocks."""
        found = await self._family_folders(drive)
        if not found:
            raise RuleError(
                "no_family_folder_found",
                "There's no family folder in this Google account's Drive. Sign in with the "
                "account that started it.",
            )
        for folder in found:
            if await asyncio.to_thread(self._opens, drive, folder, code):
                return folder
        raise RuleError(
            "not_recovered",
            "That recovery code doesn't open any family folder in this Google account's Drive. "
            "Check it, and try again.",
        )

    @staticmethod
    def _opens(drive: DriveLike, folder: str, code: str) -> bool:
        """Whether the recovery code opens a family folder's newest recovery file."""
        children = {child.name: child for child in drive.children(folder)}
        family, recovery = children.get("family.json"), children.get("recovery")
        if family is None or recovery is None or not recovery.folder:
            return False
        versions = [
            (int(item.name.removesuffix(".bin")), item)
            for item in drive.children(recovery.id)
            if item.name.endswith(".bin") and item.name.removesuffix(".bin").isdigit()
        ]
        if not versions:
            return False
        version, newest = max(versions, key=lambda found: found[0])
        return Keeper.opens(drive.download(family.id), drive.download(newest.id), version, code)

    async def _reach[T](self, work: Callable[[], T]) -> T:
        """Drive's work, with its errors in plain words."""
        with self._plainly():
            return await asyncio.to_thread(work)

    # The keeper's

    async def invite(self, request: Invite) -> None:
        """Share the family folder with a relative's Google account; then the invitation is
        theirs to have. A computer of the keeper's own, with the keeper's own account, reaches
        the folder already: it needs only the invitation."""
        async with self.lock:
            with self._plainly():
                _, drive, setup = self._keeper()
                if request.email.casefold() == self._own_account().casefold():
                    return
                await self._reach(lambda: drive.share(setup.folder, request.email))
                # Asked back before Drive stopped sharing with it after a removal: it stays
                # shared.
                wanted = request.email.casefold()
                setup.unshare = [email for email in setup.unshare if email.casefold() != wanted]
                self._save_setup()

    async def admit(self, request: Admit) -> None:
        """Let a computer in, with a role. One turned away isn't asking any more: it asks
        again, as a new computer, if it was turned away by mistake."""
        async with self.lock:
            with self._plainly():
                keeper, _, setup = self._keeper()
                asks = await asyncio.to_thread(keeper.asking, frozenset(setup.refused))
                ask = next((ask for ask in asks if ask.device == request.device), None)
                if ask is None:
                    raise NotFoundError("That computer isn't asking to join.")
                await asyncio.to_thread(keeper.admit, ask, request.role)
            await self._in_step()

    async def refuse(self, request: OneComputer) -> None:
        async with self.lock:
            _, _, setup = self._keeper()
            if request.device not in setup.refused:
                setup.refused.append(request.device)
                self._save_setup()

    async def remove(self, request: OneComputer) -> None:
        """Let a computer go: it can't read what's published after, and if it was the last of
        its Google account's computers, the folder isn't shared with that account any more.
        What Drive can't do just now, the next round does."""
        async with self.lock:
            with self._plainly():
                keeper, _, setup = self._keeper()
                known = keeper.known.get(request.device)
                if known is None or request.device == keeper.device:
                    raise NotFoundError("That computer isn't in the family.")
                if known.role == "removed":
                    return
                email = self._email_of(request.device)
                others = [
                    device
                    for device, other in keeper.known.items()
                    if device not in (request.device, keeper.device)
                    and other.role != "removed"
                    and self._email_of(device).casefold() == email.casefold()
                ]
                # A computer of the keeper's own: the keeper's account keeps its folder.
                if email and not others and email.casefold() != self._own_account().casefold():
                    setup.unshare.append(email)  # noted before the removal: never forgotten
                    self._save_setup()
                await asyncio.to_thread(keeper.remove, request.device)
            await self._in_step()

    async def new_recovery_code(self) -> str:
        """A new recovery code, for one lost or seen by someone else (0.3.1): the keeper's keys
        locked with it in the newest recovery file, which a new computer opens. Once that's in
        Drive, the older files, locked with the old code, go to Drive's bin, and the old code
        opens nothing."""
        async with self.lock:
            with self._plainly():
                keeper, _, setup = self._keeper()
                code, older = await asyncio.to_thread(keeper.new_recovery)
                setup.retire = sorted(set(setup.retire) | set(older))
                self._save_setup()
                self._keep_code(code)
            await self._in_step()
            return code

    async def leave(self) -> None:
        """This computer out of its family folder (0.3.1): it keeps the family as it is, and
        can change it as its own again; it can join a family folder afresh, or start one.
        What it kept for the family folder is set aside, never deleted: its keys go with it.
        The keeper's computer may leave only once another keeps the family, or its part can't
        be opened here: otherwise the family would stop reaching everyone."""
        async with self.lock:
            if self.setup is None and not self.broken:
                raise RuleError("no_family_folder", "This computer takes part in no family folder.")
            if not self._may_leave():
                raise RuleError(
                    "keeper_stays",
                    "The keeper's computer can't leave the family folder: the family would stop "
                    "reaching everyone.",
                )
            if self.signing_in is not None:
                self.signing_in.close()
                self.signing_in = None
            # The keeper's own Google project stays, to keep the family again; a relative's
            # was the keeper's, and goes with the rest (0.4.0).
            keep_client = self.setup is None or self.setup.role == "keeper"
            if self.dir.exists():
                stamp = datetime.now().astimezone().strftime("%Y-%m-%dT%H-%M-%S")
                aside = self.dir.with_name(f"familyfolder-left-{stamp}")
                number = 1
                while aside.exists():
                    number += 1
                    aside = self.dir.with_name(f"familyfolder-left-{stamp}-{number}")
                await asyncio.to_thread(self.dir.rename, aside)
                if keep_client and (aside / CLIENT).is_file():
                    self.dir.mkdir(parents=True, exist_ok=True)
                    await asyncio.to_thread(shutil.copy2, aside / CLIENT, self.dir / CLIENT)
            if not keep_client:
                self.client = None
            self.invited = None
            self.session = self.drive = self.mirror = None
            self.setup, self.computer = None, None
            self.recovery_code, self.broken, self.problem = None, "", ""
            self.pending, self.waiting, self.last_sync = 0, [], None
            self.moving, self._before, self.lost = False, None, False

    async def _entries_here(self) -> Entries:
        """The family as this computer's database holds it, as entries, its files named as the
        family folder names them and their sealed copies kept, once (entries.py)."""
        computer, setup = self.computer, self.setup
        if computer is None or setup is None:
            return {}
        graph = await self._graph()
        named_path = self.dir / "named.json"
        named = {
            path: tuple(value)
            for path, value in (
                json.loads(named_path.read_text(encoding="utf-8")) if named_path.is_file() else {}
            ).items()
        }
        entries = await asyncio.to_thread(
            family_entries,
            graph,
            self.ctx.data_dir,
            setup.family,
            computer.put_file,
            named,
        )
        await asyncio.to_thread(self._write_text, named_path, json.dumps(named))
        return entries

    async def _publish(self, source: Source | None = None) -> int:
        """Publish what changed in the family since it was last published; how many entries.
        `source`: the computer's proposal the changes came from, if they did."""
        keeper, setup = self.computer, self.setup
        if not isinstance(keeper, Keeper) or setup is None:
            return 0
        entries = await self._entries_here()
        changes = changes_between(keeper.state["people"], entries)
        if not changes:
            return 0
        seq = await asyncio.to_thread(keeper.publish, list(changes), source)
        if setup.snapshot == 0 or seq - setup.snapshot >= SNAPSHOT_EVERY:
            await asyncio.to_thread(keeper.snapshot)
            setup.snapshot = seq
        setup.published = datetime.now(UTC).isoformat(timespec="seconds")
        self._save_setup()
        return len(changes)

    # A relative's

    def _fetch(self, name: str) -> bytes | None:
        computer = self.computer
        return computer.get_file(name) if computer is not None else None

    def _read(self, path: Path) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except OSError, ValueError:
            return None

    def _write(self, path: Path, value: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_text(json.dumps(value), encoding="utf-8")
        partial.replace(path)

    async def _take_in(self, *, backup_first: bool = False) -> bool:
        """Restore the family the record holds, if it changed since; False while a photo or
        a story hasn't arrived yet. The first time, what was here is backed up first: a family
        of its own, entered before it joined, isn't in the folder. On a computer that sends its
        changes, its own changes go back on top: those since the family last arrived, or,
        once the keeper has answered what it sent, only those made since it sent them. On any
        other, where people were moved on its tree since the family last arrived stays (0.3.1).
        After the first time, this computer's Trash stays too: it never travels."""
        computer, setup = self.computer, self.setup
        if computer is None or setup is None:
            return True
        entries: Entries = computer.state["people"]
        if not entries:
            return True
        fingerprint = _fingerprint(entries)
        answered = setup.answered > setup.rebuilt
        if fingerprint == setup.restored and not answered:
            return True
        family = entries
        received_path = self.dir / "received.json"
        was = self._read(received_path)
        if was is not None and self.proposing:
            mine = await self._entries_here()
            since, arranged_on = was, None
            if answered:
                sent = self._read(self.dir / "sent" / f"{setup.answered}.json")
                if isinstance(sent, dict):
                    since, arranged_on = sent["family"], was
            family = rebased(since, mine, entries, arranged_on=arranged_on)
        elif was is not None and isinstance(computer, Member):
            family = arranged(entries, was, await self._entries_here())
        received = self.dir / "received"
        received.mkdir(parents=True, exist_ok=True)
        archive = await asyncio.to_thread(
            build_archive,
            family,
            self._fetch,
            self.ctx.data_dir,
            received,
            keep_trash=bool(setup.restored),
        )
        if archive is None:
            return False
        try:
            await self._restore(archive, backup_first or not setup.restored)
        finally:
            archive.unlink(missing_ok=True)
        await asyncio.to_thread(self._write, received_path, entries)
        setup.family = str(entries.get("about", {}).get("name", setup.family))
        setup.restored = fingerprint
        setup.restored_seq = computer.applied
        setup.received = datetime.now(UTC).isoformat(timespec="seconds")
        setup.rebuilt = setup.answered
        setup.recovering = False
        self._save_setup()
        for path in (self.dir / "sent").glob("*.json"):
            if path.stem.isdigit() and int(path.stem) <= setup.answered:
                path.unlink(missing_ok=True)  # answered: what was sent before is settled
        self._replaced()
        return True

    async def _send(self) -> None:
        """Send the keeper this computer's family, if what it changed is new since it last
        sent it. Changed back as it was, it's sent once more, so the keeper's inbox
        doesn't keep what's no longer asked."""
        computer, setup = self.computer, self.setup
        if not isinstance(computer, Member) or setup is None or not self.proposing:
            return
        received: Entries | None = self._read(self.dir / "received.json")
        if not received:
            return  # nothing has arrived to change yet
        family = await self._entries_here()
        mine = own_changes(received, family)
        self.pending = _counted(mine)
        sent_dir = self.dir / "sent"
        last = max(
            (int(path.stem) for path in sent_dir.glob("*.json") if path.stem.isdigit()), default=0
        )
        sent = self._read(sent_dir / f"{last}.json") if last else None
        if isinstance(sent, dict) and sent.get("changes") == json.loads(_canonical(mine)):
            return  # sent already, as it is
        if not mine and not (isinstance(sent, dict) and sent.get("changes")):
            return  # nothing changed here, and nothing waiting
        packed = await asyncio.to_thread(
            lambda: pack(family_to_send(family, received, self.ctx.data_dir))
        )
        seq = await asyncio.to_thread(
            computer.send,
            [],
            family=packed,
            answered=setup.answered,
            base=setup.restored_seq,
            changed=self.pending,
        )
        await asyncio.to_thread(
            self._write, sent_dir / f"{seq}.json", {"family": family, "changes": mine}
        )
        setup.sent_at = datetime.now(UTC).isoformat(timespec="seconds")
        self._save_setup()

    def _heard_back(self, computer: Member, setup: Setup, waiting: set[int]) -> None:
        """What the keeper answered since the last round: the newest proposal answered, and
        every one before it, which it stood for."""
        answered = max(waiting - set(computer.waiting), default=0)
        if answered <= setup.answered:
            return
        setup.answered = answered
        for seq in [seq for seq in computer.waiting if seq <= answered]:
            computer.waiting.pop(seq)
        computer.save()
        self._save_setup()

    # The keeper's review of what relatives' computers send

    async def _gather_changes(self, keeper: Keeper, setup: Setup) -> None:
        """The changes waiting from relatives' computers: each one's newest proposal. One that
        changes nothing is answered at once; a trusted computer's comes in by itself, unless
        it clashes, takes something out or asks about a look-alike."""
        waiting: list[FolderChanges] = []
        for arrived in await asyncio.to_thread(keeper.newest):
            proposal = arrived.proposal
            if proposal.changed == 0:
                await asyncio.to_thread(keeper.answer, arrived.device, proposal.seq, [], "")
                continue
            known = keeper.known.get(arrived.device)
            if known is None:
                continue
            if known.role == "trusted" and await self._trusted(keeper, setup, arrived):
                continue
            waiting.append(
                FolderChanges(
                    device=arrived.device,
                    name=arrived.name,
                    email=setup.accounts.get(arrived.device, ""),
                    role=known.role,
                    proposal=proposal.seq,
                    sent_at=datetime.fromisoformat(proposal.made),
                )
            )
        self.waiting = waiting

    async def _trusted(self, keeper: Keeper, setup: Setup, arrived: Arrived) -> bool:
        """A trusted computer's changes, in by themselves unless they clash, take something
        out or ask about a look-alike; whether they came in."""
        try:
            sent = await asyncio.to_thread(self._read_sent, keeper, setup, arrived)
            plan = await returns.plan_sent(self.ctx, sent)
            if plan.questions or any(change.clash or change.removes for change in plan.changes):
                return False  # for the keeper
            if not plan.changes:
                await asyncio.to_thread(keeper.answer, sent.device, sent.proposal, [], "")
                return True
            result = await returns.run_sent(self.ctx, self.history, sent, {}, None)
        except RuleError, RefusedError:
            return False  # for the keeper, who sees why
        except Exception:  # never let one computer's changes stop the family's keeping in step
            log.exception("A trusted computer's changes couldn't come in by themselves")
            return False
        await self._answered(keeper, sent, result.left_out, "")
        return True

    def _read_sent(self, keeper: Keeper, setup: Setup, arrived: Arrived) -> returns.Sent:
        """What a computer sent, read strictly, and the family it was made on, from the
        keeper's own record: what it's compared with. What can't be read, or compared, can
        still be turned down."""
        proposal = arrived.proposal
        try:
            found = unpack(proposal.family)
            sent_at = datetime.fromisoformat(proposal.made)
            returned = sent_family(found, arrived.device)
            entries: Entries = keeper.state_at(proposal.base)["people"]
            stories: dict[str, Any] = {}
            for key, value in entries.items():
                parts = key.split("/")
                if len(parts) == 4 and parts[:2] == ["file", "people"] and parts[3] == BIOGRAPHY:
                    data = keeper.get_file(value["blob"])
                    if data is not None:
                        text = data.decode("utf-8", errors="replace")
                        stories[parts[2]] = biography_from(text).model_dump(mode="json")
        except (UnpackError, ReturnedError, RefusedError, ValueError) as error:
            raise RuleError(
                "unreadable_changes",
                f"What {arrived.name} sent can't be read here ({error}). Take none of it: "
                "their computer hears so, and they can make their changes again.",
            ) from error
        people, links = records(entries)
        base = Base(people=people, links=links, stories=stories, ids={})
        return returns.Sent(
            returned=returned,
            base=base,
            device=arrived.device,
            proposal=proposal.seq,
            computer=arrived.name,
            email=setup.accounts.get(arrived.device, ""),
            sent_at=sent_at,
            packed=base64.b64decode(proposal.family),
        )

    async def _arrived(self, keeper: Keeper, device: str, proposal: int) -> Arrived:
        """A computer's newest changes, when they're the ones the keeper is looking at."""
        arrived = next(
            (found for found in await asyncio.to_thread(keeper.newest) if found.device == device),
            None,
        )
        if arrived is None:
            raise NotFoundError("Those changes aren't waiting any more.")
        if arrived.proposal.seq != proposal:
            raise RuleError(
                "newer_changes",
                f"{arrived.name} has sent newer changes since: look at them again.",
            )
        return arrived

    async def _sent(self, device: str, proposal: int) -> returns.Sent:
        keeper, _, setup = self._keeper()
        arrived = await self._arrived(keeper, device, proposal)
        return await asyncio.to_thread(self._read_sent, keeper, setup, arrived)

    async def _answered(
        self, keeper: Keeper, sent: returns.Sent, left_out: list[str], note: str
    ) -> None:
        """Publish what came in, marked as from the computer's proposal; and answer it with a
        note when something wasn't taken, or the keeper has a word to say."""
        source = Source(device=sent.device, proposal=sent.proposal, note=bool(left_out or note))
        published = await self._publish(source)
        if left_out or note or not published:
            await asyncio.to_thread(keeper.answer, sent.device, sent.proposal, left_out, note)
        else:
            await asyncio.to_thread(keeper.settle, sent.device, sent.proposal)
        self.waiting = [changes for changes in self.waiting if changes.device != sent.device]

    async def review(self, device: str, proposal: int, request: ReviewChanges) -> ChangesPreview:
        """What a relative's computer sent, for the keeper to tick. Nothing is written."""
        with self._plainly():
            sent = await self._sent(device, proposal)
            return await returns.preview_sent(self.ctx, sent, request.answers)

    async def bring_in(self, device: str, request: BringIn) -> ImportDone:
        """Bring in what's ticked of a computer's changes (a backup first, one Undo step, Take
        back later); publish it to everyone, and answer the computer. The keeper's own changes
        not yet published go first, as the keeper's: the relative's come in a change set of
        their own, marked as theirs."""
        async with self.lock:
            with self._plainly():
                keeper, _, _ = self._keeper()
                sent = await self._sent(device, request.proposal)
                await self._publish()
                result = await returns.run_sent(
                    self.ctx, self.history, sent, request.answers, request.chosen
                )
                await self._answered(keeper, sent, result.left_out, request.note)
            await self._in_step()
            return result.done

    async def turn_down(self, device: str, request: TurnDown) -> None:
        """Take none of a computer's changes, and tell it so, with the keeper's note. Changes
        that can't be read here are turned down too: the computer hears that none was taken."""
        async with self.lock:
            with self._plainly():
                keeper, _, setup = self._keeper()
                arrived = await self._arrived(keeper, device, request.proposal)
                try:
                    sent = await asyncio.to_thread(self._read_sent, keeper, setup, arrived)
                    left = returns.everything_left(await returns.plan_sent(self.ctx, sent))
                except RuleError as error:
                    if error.code != "unreadable_changes":
                        raise
                    left = [UNREADABLE]
                await asyncio.to_thread(
                    keeper.answer, device, arrived.proposal.seq, left, request.note
                )
                self.waiting = [changes for changes in self.waiting if changes.device != device]
            await self._in_step()

    # Rebuilding the family folder, and following it (0.4.0)

    def _moving(self) -> None:
        """The keeper moving the family folder: the next sign-in may be another account's."""
        if not isinstance(self.computer, Keeper) or self.setup is None or self.setup.replaced:
            raise RuleError("not_the_keeper", "Only the family's keeper can move its folder.")
        self.moving = True

    async def move_account(self) -> str:
        """The keeper moving the family folder to another Google account: signed out here, and a
        sign-in started that may be another account's; then `rebuild`."""
        async with self.lock:
            self._moving()
            if self._before is None:
                self._before = self.session
            (self.dir / "google.bin").unlink(missing_ok=True)
            self.session = self.drive = self.mirror = None
        return await self.sign_in()

    async def rebuild(self) -> None:
        """The family folder made again in Drive, from this computer's copy: the keeper's, when
        it's lost from Drive, or to move it to the Google account signed in now, or into the
        family's new Google project. Every file goes up as it was, so the keys and the record
        stay the same; it's shared again with every relative's account, and their computers
        follow it. The old folder, if it's still there and this project made it, goes to
        Drive's bin, so they move; otherwise the keeper is asked to delete it."""
        async with self.lock:
            with self._plainly():
                keeper, drive, setup = self._keeper()
                _, session = self._ready(set_up=True)
                old = setup.folder
                await asyncio.to_thread(keeper.repair)  # every file of its own, here
                root = await self._reach(
                    lambda: drive.create_folder(f"{FOLDER_NAME} ({keeper.family})", None)
                )
                for name in SUBFOLDERS:
                    await self._reach(partial(drive.create_folder, name, root.id))
                (self.dir / "mirror.json").unlink(missing_ok=True)
                mirror = self._family_mirror(drive, root.id, session.email)
                await self._reach(mirror.pull)  # the folders just made, known
                await self._reach(mirror.push)
                own = session.email.casefold()
                emails = {
                    email
                    for device, email in setup.accounts.items()
                    if device in keeper.known and keeper.known[device].role != "removed"
                }
                with contextlib.suppress(DriveError, OfflineError):
                    # Invited, but not joined yet: still welcome.
                    emails |= set(await asyncio.to_thread(drive.shared_with, old))
                emails -= set(setup.unshare)
                for email in sorted(emails, key=str.casefold):
                    if email.casefold() != own:
                        await self._reach(partial(drive.share, root.id, email))
                # The old folder to Drive's bin, by the sign-in that kept it, so relatives'
                # computers find it gone and follow; said, if it can't be.
                before = self._before
                binning = self._make_drive(before) if before is not None else drive
                same = before is None and session.email.casefold() == setup.account.casefold()
                try:
                    await asyncio.to_thread(binning.trash, old)
                    setup.moved_from = ""
                except DriveError as error:
                    setup.moved_from = "" if error.status == 404 and same else old
                except GoogleError, OfflineError:
                    setup.moved_from = old
                if before is not None and before.email.casefold() != session.email.casefold():
                    await asyncio.to_thread(before.sign_out)
                setup.folder, setup.account, setup.unshare = root.id, session.email, []
                self._save_setup()
                self._before = None
                self.mirror, self.moving, self.lost = mirror, False, False
                log.info("The family folder was rebuilt: %s", "moved" if old else "made again")
            await self._in_step()

    def _follow(self) -> bool:
        """A relative's computer whose family folder has gone: the same family's folder, if its
        keeper rebuilt or moved it, found among the folders shared with this account (or in its
        own Drive, for a computer of the keeper's own) by the family's id and its keeper's
        signing key; whether this computer moved to it. Its own folder is shared with the
        account that holds the family's now. Every file there is checked as before, so a folder
        that only looks like the family's can't take it in."""
        computer, setup, drive, session = self.computer, self.setup, self.drive, self.session
        if not isinstance(computer, Member) or setup is None or drive is None or session is None:
            return False
        folders = [
            *drive.shared_folders(FOLDER_NAME),
            *drive.own_folders(FOLDER_NAME, starting=True),
        ]
        for folder in folders:
            if folder.id == setup.folder or FOLDER_NAMED.fullmatch(folder.name) is None:
                continue
            found = self._family_in(drive, folder)
            if (
                found is None
                or found.family != computer.family
                or bytes.fromhex(found.keeper_sign) != computer.keeper
            ):
                continue
            if setup.own_folder and folder.owner.casefold() != session.email.casefold():
                drive.share(setup.own_folder, folder.owner)
            setup.folder = folder.id
            (self.dir / "mirror.json").unlink(missing_ok=True)
            self._save_setup()
            self._make_mirror()
            log.info("The family folder moved: this computer follows it")
            return True
        return False

    def _make_own_folder(self, mirror: Mirror, computer: Member, setup: Setup) -> None:
        """A relative's computer's own folder made again (0.4.0): its family moved to another
        Google project, whose client can't write in a folder the old one made. Shared with the
        keeper's account, as the first was; what it wrote goes up into it."""
        drive = mirror.drive
        own = drive.create_folder(f"{OWN_FOLDER} ({computer.family}, {computer.device})", None)
        keeper = mirror.owner("family.json")
        if keeper and keeper.casefold() != self._own_account().casefold():
            drive.share(own.id, keeper)
        setup.own_folder = own.id
        self._save_setup()

    def old_folder_deleted(self) -> None:
        """The keeper's word that the old family folder, left in Drive after a move, is gone."""
        if self.setup is not None and self.setup.moved_from:
            self.setup.moved_from = ""
            self._save_setup()

    # Keeping in step

    async def _round(self) -> None:
        """One round with Drive. The keeper's computer brings down what's new in the family
        folder and in relatives' own folders, puts back what went missing, publishes and sends
        up; then it stops sharing with the accounts it removed, as what went up first is locked
        with keys they don't have. A relative's brings down, takes in, and sends up what it
        wrote, to its own folder."""
        computer, mirror, setup = self.computer, self.mirror, self.setup
        if computer is None or mirror is None or setup is None:
            return
        note = ""
        await asyncio.to_thread(mirror.pull)
        if isinstance(computer, Keeper):
            overtaken = bool(setup.replaced) or await asyncio.to_thread(computer.overtaken)
            if overtaken:
                # Another computer keeps the family now: this one writes nothing more, so the
                # record never splits in two.
                if not setup.replaced:
                    setup.replaced = datetime.now(UTC).isoformat(timespec="seconds")
                    self._save_setup()
                    log.warning("Another computer keeps the family now: this one stopped")
                self.waiting = []
                self.last_sync, self.problem = datetime.now(UTC), REPLACED
                return
            unread = await self._gather(mirror.drive, computer, setup)
            await asyncio.to_thread(computer.repair)
            if setup.recovering and not await self._take_in(backup_first=True):
                note = "Photos and stories are still arriving: the family comes when they have."
            else:
                await self._publish()  # the keeper's own, before any relative's comes in
                await self._gather_changes(computer, setup)
            await asyncio.to_thread(mirror.push)
            await asyncio.to_thread(self._retire, mirror, computer, setup)
            for email in list(setup.unshare):
                await asyncio.to_thread(mirror.drive.unshare, setup.folder, email)
                setup.unshare.remove(email)
                self._save_setup()
            if setup.moved_from and not note:
                note = OLD_FOLDER
            if unread and not note:
                names = ", ".join(
                    computer.known[device].name if device in computer.known else "A new computer"
                    for device, _ in unread
                )
                note = (
                    f"What {names} sends you couldn't be fetched just now ({unread[0][1]}). "
                    "The rest of the family is in step: AncesTree tries again every minute."
                )
        else:
            waiting = set(computer.waiting)
            await asyncio.to_thread(computer.receive)
            self._heard_back(computer, setup, waiting)
            if computer.role == "removed":
                note = "This computer was removed from the family: nothing new reaches it."
            elif not await self._take_in():
                note = "Photos and stories are still arriving: the family comes when they have."
            else:
                await self._send()
            if not setup.own_folder:
                await asyncio.to_thread(self._make_own_folder, mirror, computer, setup)
            own = self._relatives_mirror(mirror.drive, setup.own_folder, computer.device)
            await asyncio.to_thread(own.push)
        self.last_sync, self.problem = datetime.now(UTC), note

    def _retire(self, mirror: Mirror, keeper: Keeper, setup: Setup) -> None:
        """Recovery files locked with an old recovery code: put in Drive's bin, and gone from
        here, once the newest recovery file, locked with the new code, is in Drive. Until then
        the old code still opens the newest file there."""
        if not setup.retire:
            return
        recovery = self.local / "recovery"
        versions = [path for path in recovery.glob("*.bin") if path.stem.isdigit()]
        newest = max(versions, key=lambda path: int(path.stem), default=None)
        if newest is None:
            return
        relative = newest.relative_to(self.local).as_posix()
        if relative in setup.retire or not mirror.sent(relative):
            return
        for path in list(setup.retire):
            mirror.bin(path)
            keeper.forget(path)
            setup.retire.remove(path)
            self._save_setup()

    async def _gather(
        self, drive: DriveLike, keeper: Keeper, setup: Setup
    ) -> list[tuple[str, DriveError]]:
        """Bring down what relatives' computers wrote in their own folders: this family's, by
        the family's id in their names, of the accounts the family folder is shared with, and
        of the keeper's own account, for computers of the keeper's own. Each computer's comes
        from one account only. A folder named before 0.4.0, without the family's id, is read
        only for a computer this family knows already. A folder Drive won't give just now is
        passed over, and named: one relative's trouble never holds up the rest of the
        family."""
        own = self._own_account().casefold()
        sharing = {
            email.casefold() for email in await asyncio.to_thread(drive.shared_with, setup.folder)
        } | {own}
        found = [
            *await asyncio.to_thread(drive.shared_folders, OWN_FOLDER),
            *await asyncio.to_thread(drive.own_folders, OWN_FOLDER, starting=True),
        ]
        folders: dict[str, list[str]] = {}
        for folder in sorted(found, key=lambda f: f.id):
            named = OWN_FOLDER_NAMED.fullmatch(folder.name)
            if named is None or folder.owner.casefold() not in sharing:
                continue
            family, device = named.groups()
            if family is None and device not in setup.accounts:
                continue  # a computer from before 0.4.0 that this family doesn't know
            if family is not None and family != keeper.family:
                continue  # another family's: its keeper keeps it
            if device not in setup.accounts:
                setup.accounts[device] = folder.owner
                self._save_setup()
            if setup.accounts[device].casefold() == folder.owner.casefold():
                # Another account can't speak for it; its own may have a new folder, made
                # when the family moved to another Google project (0.4.0).
                folders.setdefault(device, []).append(folder.id)
        unread: list[tuple[str, DriveError]] = []
        for device, folder_ids in folders.items():
            for folder_id in folder_ids:
                try:
                    await asyncio.to_thread(self._relatives_mirror(drive, folder_id, device).pull)
                except DriveError as error:
                    if error.status == 404:
                        continue  # gone, or no longer shared with this account, since the search
                    log.warning("A relative's own folder couldn't be read: %s", error)
                    unread.append((device, error))
                    break
        return unread

    def attach(self, loop: asyncio.AbstractEventLoop) -> None:
        """The loop that keeps the family in step: Sync now from another thread reaches it."""
        self._loop = loop
        self.now = False

    def nudge(self) -> None:
        """A change here: a round in a few seconds, rather than within the minute."""
        if self.setup is not None:
            self.nudged.set()

    def sync_soon(self) -> None:
        """Sync now, from another thread: the icon by the clock's menu, through the engine."""
        loop = self._loop
        if loop is None:
            return

        def now() -> None:
            self.now = True
            self.nudged.set()

        loop.call_soon_threadsafe(now)

    async def last_round(self, within: float = 15.0) -> None:
        """One more round before the app closes or opens another family, so nothing that could
        go is left waiting; given up after `within` seconds."""
        if self.setup is None or self.mirror is None:
            return
        try:
            await asyncio.wait_for(self.sync(), timeout=within)
        except TimeoutError:
            log.warning("The last round before closing didn't finish in time")

    async def sync(self) -> None:
        """Keep in step now, if this computer takes part; what's in the way goes in `problem`."""
        async with self.lock:
            await self._finish_sign_in()
            if self.setup is None or self.broken:
                return
            if self.mirror is None:
                self.problem = "Sign in to Google, so AncesTree can keep the family in step."
                return
            await self._in_step()

    async def _in_step(self) -> None:
        """A round with Drive. What's in the way, if anything, goes in `problem`: what was done
        here stays done, and the next round carries it on. When it went through is kept across
        restarts; and whoever listens is told (0.4.0)."""
        self.syncing = True
        before = self.last_sync
        try:
            await self._try_round()
        finally:
            self.syncing = False
            self.tried = datetime.now(UTC)
            self.went_through = self.last_sync is not None and self.last_sync != before
            setup = self.setup
            if setup is not None and self.last_sync is not None:
                done = self.last_sync.isoformat(timespec="seconds")
                if setup.in_step != done:
                    setup.in_step = done
                    self._save_setup()
            self.told()

    def told(self) -> None:
        """Whoever listens, told how things stand: never a failure of theirs in a round."""
        if self._on_round is None:
            return
        try:
            self._on_round(self)
        except Exception:
            log.exception("The family folder's listener failed")

    async def _try_round(self) -> None:
        self.lost, self.trouble = False, ""
        try:
            try:
                await self._round()
            except DriveError as error:
                # A relative's family folder gone: followed, if its keeper moved it (0.4.0).
                setup = self.setup
                if error.status != 404 or setup is None or setup.role != "member":
                    raise
                if not await asyncio.to_thread(self._follow):
                    raise
                await self._round()
        except OfflineError:
            self.trouble = "offline"
            self.problem = "No internet just now: AncesTree tries again every minute."
        except SignedOutError:
            self.trouble = "signed_out"
            self._signed_out()
            self.problem = "The sign-in to Google has ended: sign in again."
        except ProjectGoneError:
            self.trouble = "project"
            self._signed_out()
            if self.setup is not None and self.setup.role == "member":
                self.problem = (
                    "Your family's Google project has changed: paste your keeper's newest "
                    "invitation, then sign in again."
                )
            else:
                self.problem = (
                    "The family's Google project no longer has this client: give AncesTree a "
                    "client file of the project, or rebuild the family folder in another."
                )
        except GoogleError as error:
            self.trouble = "problem"
            self.problem = str(error)
        except ProtectError as error:
            self.trouble = "problem"
            self.problem = f"This computer's keys couldn't be locked or opened here ({error})."
        except DriveError as error:
            member = self.setup is not None and self.setup.role == "member"
            self.trouble = "lost" if error.status == 404 else "problem"
            if error.status == 404:
                self.lost = True
                self.problem = LOST_RELATIVE if member else LOST
            elif error.why == NOT_THIS_PROJECTS and not member:
                # A family folder made through another Google project: the one AncesTree
                # carried before 0.4.0, say. This project can read it, not change it.
                self.lost, self.trouble, self.problem = True, "foreign", FOREIGN
            else:
                self.problem = str(error)
        except RefusedError as error:
            self.trouble = "problem"
            self.problem = (
                f"Something in the family folder didn't check out ({error}), "
                "so nothing here changed."
            )


async def keep_in_step(folder: FamilyFolder, every: float = EVERY, soon: float = SOON) -> None:
    """While the app runs: in step with the family folder, a few seconds after it starts, then
    every minute; and a few seconds after a change here, or at once when asked from the icon by
    the clock (0.4.0)."""
    folder.attach(asyncio.get_running_loop())
    await asyncio.sleep(5)
    while True:
        folder.nudged.clear()
        try:
            await folder.sync()
        except Exception:  # never let the app lose its keeping in step
            log.exception("The family folder couldn't be kept in step")
        try:
            await asyncio.wait_for(folder.nudged.wait(), timeout=every)
        except TimeoutError:
            continue
        if not folder.now:
            await asyncio.sleep(soon)  # more changes may follow the first
        folder.now = False
