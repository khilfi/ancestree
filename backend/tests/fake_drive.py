"""A stand-in for Google Drive's API: one Drive, seen by several accounts.

Each account reads everything shared with it and changes only its own files, as the
permission D41 chose allows ("read every file, change only AncesTree's own"). As in Drive:

- a folder shared to read takes nothing from the account it's shared with; shared to edit, as
  Drive's own page can, it takes their files;
- sharing a folder, or no longer sharing it, is refused while the folder holds another
  account's file: the permission doesn't reach that file, and the change would;
- a folder an account can't reach is a 404 to look up, but lists as empty.

`offline` makes every call fail as if the internet were gone; a call named in `failing` fails
as Drive's own trouble would.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

from ancestree.familyfolder.drive import DriveError, RemoteFile, md5
from ancestree.familyfolder.google import OfflineError

NOT_ALLOWED = "The user does not have sufficient permissions for this file."


@dataclass
class _Item:
    id: str
    name: str
    parent: str | None
    owner: str
    folder: bool
    data: bytes = b""
    shared: dict[str, str] = field(default_factory=dict)  # each account's role, by address


class Cloud:
    """Google's side: every file, whoever's it is."""

    def __init__(self) -> None:
        self.items: dict[str, _Item] = {}
        self._ids = itertools.count(1)
        self.offline = False
        self.failing: set[str] = set()  # calls that fail, as when Drive has trouble
        self.calls = 0

    def new_id(self) -> str:
        return f"id{next(self._ids):04d}"

    def as_account(self, email: str) -> FakeDrive:
        return FakeDrive(self, email)

    def path(self, item_id: str) -> str:
        item = self.items[item_id]
        return item.name if item.parent is None else f"{self.path(item.parent)}/{item.name}"

    def find(self, path: str) -> _Item:
        return next(item for item in self.items.values() if self.path(item.id) == path)

    def inside(self, item: _Item, folder_id: str) -> bool:
        """Whether an item is in a folder, at any depth."""
        while item.parent is not None:
            if item.parent == folder_id:
                return True
            item = self.items[item.parent]
        return False


class FakeDrive:
    """One account's view of the cloud."""

    def __init__(self, cloud: Cloud, email: str) -> None:
        self.cloud = cloud
        self.email = email

    def account(self) -> str:
        self._touch("account")
        return self.email

    def _touch(self, call: str) -> None:
        if self.cloud.offline:
            raise OfflineError("no internet (a stand-in's)")
        if call in self.cloud.failing:
            raise DriveError(500, "Internal Error")
        self.cloud.calls += 1

    def _remote(self, item: _Item) -> RemoteFile:
        return RemoteFile(
            id=item.id,
            name=item.name,
            folder=item.folder,
            md5=None if item.folder else md5(item.data),
            owner=item.owner,
        )

    def _role(self, item: _Item) -> str | None:
        """This account's part in an item: its own, or shared with it there or above."""
        roles: set[str] = set()
        while True:
            if item.owner == self.email:
                return "owner"
            if (role := item.shared.get(self.email.casefold())) is not None:
                roles.add(role)
            if item.parent is None:
                return "writer" if "writer" in roles else "reader" if roles else None
            item = self.cloud.items[item.parent]

    def _item(self, item_id: str) -> _Item:
        item = self.cloud.items.get(item_id)
        if item is None or self._role(item) is None:
            raise DriveError(404, f"File not found: {item_id}.")
        return item

    def _into(self, parent: str) -> None:
        if self._role(self._item(parent)) == "reader":
            raise DriveError(403, NOT_ALLOWED)

    def _sharing(self, file_id: str) -> _Item:
        """A folder of this account's whose sharing may change: nobody else's file is in it."""
        item = self._item(file_id)
        if item.owner != self.email:
            raise DriveError(403, NOT_ALLOWED)
        for other in self.cloud.items.values():
            if other.owner != self.email and self.cloud.inside(other, item.id):
                raise DriveError(
                    403,
                    f"The user has not granted the app write access to the child file "
                    f"{other.id}, which would be affected by the operation on the parent.",
                )
        return item

    def get(self, file_id: str) -> RemoteFile:
        self._touch("get")
        return self._remote(self._item(file_id))

    def children(self, folder_id: str) -> list[RemoteFile]:
        self._touch("children")
        return [
            self._remote(item)
            for item in self.cloud.items.values()
            if item.parent == folder_id and self._role(item) is not None
        ]

    def download(self, file_id: str) -> bytes:
        self._touch("download")
        return self._item(file_id).data

    def create_folder(self, name: str, parent: str | None) -> RemoteFile:
        self._touch("create_folder")
        if parent is not None:
            self._into(parent)
        item = _Item(self.cloud.new_id(), name, parent, self.email, folder=True)
        self.cloud.items[item.id] = item
        return self._remote(item)

    def upload(self, name: str, parent: str, data: bytes) -> RemoteFile:
        self._touch("upload")
        self._into(parent)
        item = _Item(self.cloud.new_id(), name, parent, self.email, folder=False, data=data)
        self.cloud.items[item.id] = item
        return self._remote(item)

    def replace(self, file_id: str, data: bytes) -> RemoteFile:
        self._touch("replace")
        item = self._item(file_id)
        if item.owner != self.email:
            raise DriveError(403, NOT_ALLOWED)
        item.data = data
        return self._remote(item)

    def share(self, file_id: str, email: str, role: str = "reader") -> None:
        """As AncesTree shares, to read; to edit only as Drive's own page could."""
        self._touch("share")
        self._sharing(file_id).shared[email.casefold()] = role

    def unshare(self, file_id: str, email: str) -> bool:
        self._touch("unshare")
        return self._sharing(file_id).shared.pop(email.casefold(), None) is not None

    def shared_with(self, file_id: str) -> list[str]:
        self._touch("shared_with")
        return list(self._item(file_id).shared)

    def shared_folders(self, name: str = "") -> list[RemoteFile]:
        self._touch("shared_folders")
        return [
            self._remote(item)
            for item in self.cloud.items.values()
            if item.folder
            and self.email.casefold() in item.shared
            and item.owner != self.email
            and item.name.startswith(name)
        ]

    def own_folders(self, name: str) -> list[RemoteFile]:
        self._touch("own_folders")
        return [
            self._remote(item)
            for item in self.cloud.items.values()
            if item.folder and item.name == name and item.owner == self.email
        ]

    def tamper(self, file_id: str, data: bytes) -> None:
        """What an editor could do in Drive's own web page: change anyone's file."""
        self.cloud.items[file_id].data = data

    def delete(self, file_id: str) -> None:
        """Gone for good, and whatever was in it."""
        gone = [file_id] + [
            i for i, item in self.cloud.items.items() if self.cloud.inside(item, file_id)
        ]
        for item_id in gone:
            del self.cloud.items[item_id]
