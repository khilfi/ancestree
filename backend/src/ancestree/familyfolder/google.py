"""Signing in to Google from AncesTree.

Google's sign-in for installed apps: the person's own browser opens Google's page, and Google
sends them back to a port on this computer that AncesTree listens on for that one answer
(with PKCE, so an answer caught by another program is no use to it). The permission is the
narrowest that S6's test showed working: every file read, only AncesTree's own changed.

What's kept is the sign-in's refresh token and the account's address, locked on this computer
(protect.py). Access tokens live an hour and are made again from it as needed.

The Google client is the family's own (0.4.0): no release carries one. The keeper sets up a
Google Cloud project for the family, and gives AncesTree the file Google's console gives for
its client of the Desktop app type; relatives' computers take it from the keeper's invitation
(invitations.py). Each family keeps its client with it, locked as the sign-in is.
ANCESTREE_GOOGLE_CLIENT names a client file to use instead, while developing.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from ancestree.familyfolder.protect import read_secret, write_secret

SCOPES = (
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
)
AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"  # noqa: S105 - Google's address, not a secret
REVOKE = "https://oauth2.googleapis.com/revoke"
SIGN_IN_MINUTES = 10
# A client's id, as Google makes it: the project's number, then the client's own part.
CLIENT_ID = re.compile(r"(\d+)-[0-9a-z]+\.apps\.googleusercontent\.com")


class GoogleError(Exception):
    """Google said no, or AncesTree has no Google client to sign in with."""


class OfflineError(Exception):
    """Google couldn't be reached: no internet, most likely. Tried again later."""


class SignedOutError(GoogleError):
    """The sign-in has ended (taken back in the Google account, or expired): sign in again."""


class ProjectGoneError(GoogleError):
    """Google doesn't know the client any more, or the sign-in was made with another (0.4.0):
    the family's project, or its client, changed."""


class ClientFileError(ValueError):
    """A file that isn't a Google client AncesTree can sign in with: in plain words."""


@dataclass(frozen=True)
class Client:
    """A family's Google client, of the Desktop app type, from the family's own Google project.
    `invited`: it came with a keeper's invitation, so the project is that keeper's family's."""

    client_id: str
    client_secret: str
    project: str = ""  # the project's id, as the console's file names it
    invited: bool = False

    @property
    def number(self) -> str:
        """The project's number, which starts every one of its clients' ids: one project's
        clients reach the same files in Drive."""
        found = CLIENT_ID.fullmatch(self.client_id)
        return found.group(1) if found else self.client_id

    @property
    def name(self) -> str:
        """The project, as the keeper would know it."""
        return self.project or f"project {self.number}"

    @classmethod
    def from_file(cls, text: str) -> Client:
        """The client in the file Google's console gives for it."""
        try:
            found = json.loads(text)
        except ValueError as error:
            raise ClientFileError(
                "That isn't the file Google gives for a client: it can't be read as one."
            ) from error
        if not isinstance(found, dict):
            raise ClientFileError("That isn't the file Google gives for a client.")
        if "installed" not in found and "web" in found:
            raise ClientFileError(
                "That client is for a web application. AncesTree needs one for a Desktop app: "
                "create one of that type in your Google project, and choose its file."
            )
        installed = found.get("installed")
        client_id = installed.get("client_id") if isinstance(installed, dict) else None
        secret = installed.get("client_secret") if isinstance(installed, dict) else None
        if not isinstance(client_id, str) or not CLIENT_ID.fullmatch(client_id):
            raise ClientFileError(
                "That file holds no Desktop app client: choose the file Google's console gives "
                "when you download the client."
            )
        if not isinstance(secret, str) or not secret.strip():
            raise ClientFileError("That client's file has no secret in it: download it again.")
        project = installed.get("project_id") if isinstance(installed, dict) else None
        return cls(client_id, secret.strip(), project if isinstance(project, str) else "")

    @classmethod
    def find(cls, kept: Path) -> Client | None:
        """The client named by ANCESTREE_GOOGLE_CLIENT, if that's set (to try another client
        while developing); else the family's own, kept in `kept`. None if there's none yet."""
        named = os.environ.get("ANCESTREE_GOOGLE_CLIENT")
        if named and Path(named).is_file():
            return cls.from_file(Path(named).read_text(encoding="utf-8"))
        stored = read_secret(kept)
        if stored is None:
            return None
        saved = json.loads(stored)
        return cls(
            saved["client_id"],
            saved["client_secret"],
            saved.get("project", ""),
            bool(saved.get("invited", False)),
        )

    def keep(self, path: Path) -> None:
        """Kept with the family, locked on this computer as the sign-in is."""
        write_secret(path, json.dumps(asdict(self)).encode())


@dataclass
class Tokens:
    """A sign-in: its refresh token, whose account it is, and the access token now in use."""

    refresh: str
    email: str = ""
    access: str = ""
    expires: float = 0.0

    def save(self, path: Path) -> None:
        write_secret(path, json.dumps({"refresh": self.refresh, "email": self.email}).encode())

    @classmethod
    def load(cls, path: Path) -> Tokens | None:
        stored = read_secret(path)
        if stored is None:
            return None
        saved = json.loads(stored)
        return cls(refresh=saved["refresh"], email=saved.get("email", ""))


def _post(url: str, form: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(  # noqa: S310 - Google's own addresses, https
        url, data=urllib.parse.urlencode(form).encode(), method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            answer: dict[str, Any] = json.load(response)
            return answer
    except urllib.error.HTTPError as error:
        try:
            said = json.loads(error.read())
        except ValueError:
            said = {}
        if said.get("error") == "invalid_grant":
            raise SignedOutError("The sign-in to Google has ended: sign in again.") from error
        if said.get("error") in ("invalid_client", "unauthorized_client"):
            raise ProjectGoneError(
                "Google doesn't know the family's Google project's client any more."
            ) from error
        reason = said.get("error_description") or f"Google said no ({error.code})"
        raise GoogleError(reason) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise OfflineError("Google can't be reached just now") from error


class Session:
    """A signed-in account's access to Google, renewed as it runs out."""

    def __init__(self, client: Client, tokens: Tokens) -> None:
        self.client = client
        self.tokens = tokens
        self._lock = threading.Lock()

    @property
    def email(self) -> str:
        return self.tokens.email

    def access_token(self) -> str:
        with self._lock:
            if self.tokens.access and time.time() < self.tokens.expires - 60:
                return self.tokens.access
            answer = _post(
                TOKEN,
                {
                    "client_id": self.client.client_id,
                    "client_secret": self.client.client_secret,
                    "refresh_token": self.tokens.refresh,
                    "grant_type": "refresh_token",
                },
            )
            self.tokens.access = answer["access_token"]
            self.tokens.expires = time.time() + float(answer.get("expires_in", 3600))
            return self.tokens.access

    def sign_out(self) -> None:
        """Give the sign-in back to Google, so it can't be used again."""
        # Forgotten here anyway, if Google can't be told: the Google account can take it back.
        with contextlib.suppress(GoogleError, OfflineError):
            _post(REVOKE, {"token": self.tokens.refresh})


class SignIn:
    """One sign-in under way: the page to open in the browser, and this computer's end of it,
    listening for Google's answer on a port of its own until it comes or time runs out."""

    def __init__(self, client: Client, hint: str = "") -> None:
        self.client = client
        self.verifier = secrets.token_urlsafe(64)
        self.state = secrets.token_urlsafe(24)
        self.answer: dict[str, str] | None = None
        self.arrived = threading.Event()
        self.started = time.monotonic()
        sign_in = self

        class Back(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
                if query.get("state") == sign_in.state and sign_in.answer is None:
                    sign_in.answer = query
                    sign_in.arrived.set()
                    text = "Done. You can close this tab and go back to AncesTree."
                    if "error" in query:
                        text = "Nothing was changed. You can close this tab."
                else:
                    text = "This sign-in is out of date. Start again in AncesTree."
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                page = f"<p style='font: 18px system-ui; margin: 2rem'>{text}</p>"
                self.wfile.write(page.encode())

            def log_message(self, format: str, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Back)
        self.redirect = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        challenge = hashlib.sha256(self.verifier.encode()).digest()
        params = {
            "client_id": client.client_id,
            "redirect_uri": self.redirect,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "code_challenge": base64.urlsafe_b64encode(challenge).rstrip(b"=").decode(),
            "code_challenge_method": "S256",
            "state": self.state,
            "access_type": "offline",
            "prompt": "select_account consent",
        }
        if hint:
            params["login_hint"] = hint
        self.url = f"{AUTH}?{urllib.parse.urlencode(params)}"

    @property
    def expired(self) -> bool:
        return time.monotonic() - self.started > SIGN_IN_MINUTES * 60

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def finish(self) -> Tokens | None:
        """The sign-in, once Google has answered; None while it hasn't. Raises when the
        person said no, or Google refused."""
        if self.answer is None:
            return None
        self.close()
        if "error" in self.answer:
            raise GoogleError(
                "The sign-in was cancelled."
                if self.answer["error"] == "access_denied"
                else f"Google said no: {self.answer['error']}"
            )
        answer = _post(
            TOKEN,
            {
                "code": self.answer.get("code", ""),
                "client_id": self.client.client_id,
                "client_secret": self.client.client_secret,
                "redirect_uri": self.redirect,
                "grant_type": "authorization_code",
                "code_verifier": self.verifier,
            },
        )
        granted = set(answer.get("scope", "").split())
        if not set(SCOPES) <= granted:
            raise GoogleError(
                "Both boxes need ticking on Google's page: AncesTree can't keep the family "
                "in step without them. Sign in again."
            )
        if "refresh_token" not in answer:
            raise GoogleError("Google gave no lasting sign-in. Sign in again.")
        return Tokens(
            refresh=answer["refresh_token"],
            access=answer["access_token"],
            expires=time.time() + float(answer.get("expires_in", 3600)),
        )
