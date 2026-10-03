"""Google Drive's API, as much of it as the family folder needs.

Blocking calls over https, each with the account's access token. A file uploaded appears whole
or not at all, so nobody ever reads half of one.

When Drive says it's busy (too many requests, or a passing fault of its own), a call waits and
tries again a few times, as Google asks, before the round gives up until the next minute.
"""

from __future__ import annotations

import hashlib
import json
import random
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from ancestree.familyfolder.google import OfflineError

API = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3"
FOLDER = "application/vnd.google-apps.folder"
FIELDS = "id,name,mimeType,md5Checksum,size,owners(emailAddress)"
# Up to this size a file goes up in one request; larger, in a resumable upload.
ONE_REQUEST = 5 * 1024 * 1024
# Drive's "busy" answers, tried again after a wait: too many requests, and its own passing
# faults. A 403 counts only when Drive gives a rate limit as its reason.
BUSY = frozenset({429, 500, 502, 503, 504})
RATE_LIMITED = frozenset({"rateLimitExceeded", "userRateLimitExceeded"})
WAITS = (1.0, 2.0, 4.0)  # seconds before each try again, unless Drive says how long
LONGEST_WAIT = 30.0


class DriveError(Exception):
    """Drive said no: `status` is its HTTP status; `why`, its reason's code, if it gave one."""

    def __init__(self, status: int, reason: str, why: str = "") -> None:
        super().__init__(f"Google Drive said no ({status}): {reason}")
        self.status = status
        self.reason = reason
        self.why = why

    @property
    def busy(self) -> bool:
        """Drive was too busy, or had a passing fault: worth trying again shortly."""
        return self.status in BUSY or (self.status == 403 and self.why in RATE_LIMITED)


@dataclass(frozen=True)
class RemoteFile:
    id: str
    name: str
    folder: bool
    md5: str | None  # none for folders
    owner: str  # the address of the account the file belongs to


class DriveLike(Protocol):
    """What the family folder asks of Drive; tests stand a fake in for it."""

    def account(self) -> str: ...
    def get(self, file_id: str) -> RemoteFile: ...
    def children(self, folder_id: str) -> list[RemoteFile]: ...
    def download(self, file_id: str) -> bytes: ...
    def create_folder(self, name: str, parent: str | None) -> RemoteFile: ...
    def upload(self, name: str, parent: str, data: bytes) -> RemoteFile: ...
    def replace(self, file_id: str, data: bytes) -> RemoteFile: ...
    def trash(self, file_id: str) -> None: ...
    def share(self, file_id: str, email: str) -> None: ...
    def unshare(self, file_id: str, email: str) -> bool: ...
    def shared_with(self, file_id: str) -> list[str]: ...
    def shared_folders(self, name: str = "") -> list[RemoteFile]: ...
    def own_folders(self, name: str, *, starting: bool = False) -> list[RemoteFile]: ...


def _remote(item: dict[str, Any]) -> RemoteFile:
    owners = item.get("owners") or [{}]
    return RemoteFile(
        id=item["id"],
        name=item["name"],
        folder=item.get("mimeType") == FOLDER,
        md5=item.get("md5Checksum"),
        owner=str(owners[0].get("emailAddress", "")),
    )


def _quoted(text: str) -> str:
    """Text inside quotes, in a Drive search."""
    return text.replace("\\", "\\\\").replace("'", "\\'")


def _id(file_id: str) -> str:
    """A file's id as part of an address. Drive's ids are letters, digits, - and _, but one
    that isn't can't change the address it's in."""
    return urllib.parse.quote(file_id, safe="")


def md5(data: bytes) -> str:
    """Drive's own checksum, compared to see whether a file changed."""
    return hashlib.md5(data, usedforsecurity=False).hexdigest()


def _refused(error: urllib.error.HTTPError) -> DriveError:
    """Drive's refusal, in its own words: its message, and its reason's code."""
    raw = error.read()
    try:
        said = json.loads(raw)["error"]
        reason = str(said["message"])
        why = str((said.get("errors") or [{}])[0].get("reason", ""))
    except ValueError, KeyError, TypeError, IndexError, AttributeError:
        reason, why = raw[:200].decode(errors="replace"), ""
    return DriveError(error.code, reason, why)


def _wait_before(error: DriveError, headers: Any, attempt: int) -> float:
    """How long to wait before trying again: as long as Drive asks, within reason, or a little
    longer each time, never all at once with every other computer."""
    asked = headers.get("Retry-After") if headers is not None else None
    if asked is not None:
        try:
            return min(max(float(asked), 0.0), LONGEST_WAIT)
        except ValueError:
            pass  # a date rather than seconds: wait as usual
    return WAITS[attempt] + random.uniform(0, WAITS[attempt] / 2)  # noqa: S311 - not for secrets


class Drive:
    """One account's Google Drive, through `token()`: a fresh access token each time."""

    def __init__(
        self, token: Callable[[], str], pause: Callable[[float], None] = time.sleep
    ) -> None:
        self.token = token
        self.pause = pause  # how a call waits before trying again: tests don't wait

    def _call(
        self,
        method: str,
        url: str,
        body: bytes | None = None,
        kind: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        """One call to Drive, tried again while Drive says it's busy, a few times at most."""
        attempt = 0
        while True:
            sent = {"Authorization": f"Bearer {self.token()}", **(headers or {})}
            if kind:
                sent["Content-Type"] = kind
            request = urllib.request.Request(  # noqa: S310 - Drive's own addresses, https
                url, data=body, method=method, headers=sent
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                    return response.read(), dict(response.headers)
            except urllib.error.HTTPError as error:
                refused = _refused(error)
                if not refused.busy or attempt >= len(WAITS):
                    raise refused from error
                self.pause(_wait_before(refused, error.headers, attempt))
                attempt += 1
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                raise OfflineError("Google Drive can't be reached just now") from error

    def _json(self, method: str, path: str, payload: object = None, **query: str) -> Any:
        url = f"{API}/{path}" + ("?" + urllib.parse.urlencode(query) if query else "")
        body = None if payload is None else json.dumps(payload).encode()
        raw, _ = self._call(method, url, body, "application/json" if body else None)
        return json.loads(raw) if raw else {}

    def account(self) -> str:
        """The signed-in account's address."""
        return str(self._json("GET", "about", fields="user(emailAddress)")["user"]["emailAddress"])

    def get(self, file_id: str) -> RemoteFile:
        """A file or folder this account can reach. Drive says 404 for one it can't; so does
        this, for one in the trash."""
        item = self._json("GET", f"files/{_id(file_id)}", fields=f"{FIELDS},trashed")
        if item.get("trashed"):
            raise DriveError(404, f"File in the trash: {file_id}.")
        return _remote(item)

    def _search(self, search: str) -> list[RemoteFile]:
        """Every file a Drive search finds, page by page."""
        found: list[RemoteFile] = []
        page = ""
        while True:
            query = {"q": search, "fields": f"nextPageToken,files({FIELDS})", "pageSize": "1000"}
            if page:
                query["pageToken"] = page
            answer = self._json("GET", "files", **query)
            found.extend(_remote(item) for item in answer.get("files", []))
            page = answer.get("nextPageToken", "")
            if not page:
                return found

    def children(self, folder_id: str) -> list[RemoteFile]:
        """What's in a folder: nothing, not a 404, for a folder this account can't reach."""
        return self._search(f"'{_quoted(folder_id)}' in parents and trashed = false")

    def download(self, file_id: str) -> bytes:
        raw, _ = self._call("GET", f"{API}/files/{_id(file_id)}?alt=media")
        return raw

    def create_folder(self, name: str, parent: str | None) -> RemoteFile:
        meta: dict[str, object] = {"name": name, "mimeType": FOLDER}
        if parent:
            meta["parents"] = [parent]
        return _remote(self._json("POST", "files", meta, fields=FIELDS))

    def upload(self, name: str, parent: str, data: bytes) -> RemoteFile:
        meta: dict[str, object] = {"name": name, "parents": [parent]}
        if len(data) <= ONE_REQUEST:
            boundary = "ancestree-" + secrets.token_hex(12)
            body = (
                (
                    f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                    f"{json.dumps(meta)}\r\n--{boundary}\r\n"
                    "Content-Type: application/octet-stream\r\n\r\n"
                ).encode()
                + data
                + f"\r\n--{boundary}--\r\n".encode()
            )
            url = f"{UPLOAD}/files?uploadType=multipart&fields={FIELDS}"
            raw, _ = self._call("POST", url, body, f"multipart/related; boundary={boundary}")
            return _remote(json.loads(raw))
        return self._resumable("POST", f"{UPLOAD}/files?uploadType=resumable", meta, data)

    def replace(self, file_id: str, data: bytes) -> RemoteFile:
        """New contents for a file this app made."""
        if len(data) <= ONE_REQUEST:
            url = f"{UPLOAD}/files/{_id(file_id)}?uploadType=media&fields={FIELDS}"
            raw, _ = self._call("PATCH", url, data, "application/octet-stream")
            return _remote(json.loads(raw))
        url = f"{UPLOAD}/files/{_id(file_id)}?uploadType=resumable"
        return self._resumable("PATCH", url, {}, data)

    def _resumable(self, method: str, url: str, meta: dict[str, object], data: bytes) -> RemoteFile:
        _, headers = self._call(
            method,
            f"{url}&fields={urllib.parse.quote(FIELDS)}",
            json.dumps(meta).encode(),
            "application/json; charset=UTF-8",
            {"X-Upload-Content-Length": str(len(data))},
        )
        session = next(value for key, value in headers.items() if key.lower() == "location")
        raw, _ = self._call("PUT", session, data, "application/octet-stream")
        return _remote(json.loads(raw))

    def trash(self, file_id: str) -> None:
        """To the account's trash, where Drive keeps it 30 days: never deleted outright."""
        self._json("PATCH", f"files/{_id(file_id)}", {"trashed": True}, fields="id")

    def share(self, file_id: str, email: str) -> None:
        """Let this Google account read the folder: only its owner writes in it. Google sends no
        email."""
        grant = {"role": "reader", "type": "user", "emailAddress": email}
        self._json(
            "POST", f"files/{_id(file_id)}/permissions", grant, sendNotificationEmail="false"
        )

    def unshare(self, file_id: str, email: str) -> bool:
        """Stop sharing with this account; whether it was shared with it."""
        answer = self._json(
            "GET", f"files/{_id(file_id)}/permissions", fields="permissions(id,emailAddress,role)"
        )
        for permission in answer.get("permissions", []):
            same = str(permission.get("emailAddress", "")).casefold() == email.casefold()
            if same and permission.get("role") != "owner":
                gone = f"{API}/files/{_id(file_id)}/permissions/{_id(str(permission['id']))}"
                self._call("DELETE", gone)
                return True
        return False

    def shared_with(self, file_id: str) -> list[str]:
        """The Google accounts a file of this account's is shared with."""
        answer = self._json(
            "GET", f"files/{_id(file_id)}/permissions", fields="permissions(emailAddress,role,type)"
        )
        return [
            str(permission.get("emailAddress", ""))
            for permission in answer.get("permissions", [])
            if permission.get("type") == "user" and permission.get("role") != "owner"
        ]

    def own_folders(self, name: str, *, starting: bool = False) -> list[RemoteFile]:
        """Folders of this name that belong to this account; or, `starting`, those whose names
        start with it."""
        if not starting:
            return self._search(
                f"name = '{_quoted(name)}' and mimeType = '{FOLDER}' and 'me' in owners "
                "and trashed = false"
            )
        search = (
            f"name contains '{_quoted(name.split()[0])}' and mimeType = '{FOLDER}' "
            "and 'me' in owners and trashed = false"
        )
        return [folder for folder in self._search(search) if folder.name.startswith(name)]

    def shared_folders(self, name: str = "") -> list[RemoteFile]:
        """Folders others have shared with this account; those whose names start with `name`."""
        search = f"sharedWithMe = true and mimeType = '{FOLDER}' and trashed = false"
        if name:
            # Drive matches a name by the starts of its words: the first word narrows the
            # search, and the whole start is checked here.
            search += f" and name contains '{_quoted(name.split()[0])}'"
        return [folder for folder in self._search(search) if folder.name.startswith(name)]
