"""Signing in to Google from AncesTree.

Google's sign-in for installed apps: the person's own browser opens Google's page, and Google
sends them back to a port on this computer that AncesTree listens on for that one answer
(with PKCE, so an answer caught by another program is no use to it). The permission is the
narrowest that S6's test showed working: every file read, only AncesTree's own changed.

What's kept is the sign-in's refresh token and the account's address, locked on this computer
(protect.py). Access tokens live an hour and are made again from it as needed.

AncesTree's Google client is built into a release, from a secret of the release workflow's;
the maintainer's own copy stands in while developing: ~/.ancestree/google-client.json.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
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
BUILT_IN = Path(__file__).with_name("google-client.json")
OWN_COPY = Path.home() / ".ancestree" / "google-client.json"
SIGN_IN_MINUTES = 10


class GoogleError(Exception):
    """Google said no, or AncesTree has no Google client to sign in with."""


class OfflineError(Exception):
    """Google couldn't be reached: no internet, most likely. Tried again later."""


class SignedOutError(GoogleError):
    """The sign-in has ended (taken back in the Google account, or expired): sign in again."""


@dataclass(frozen=True)
class Client:
    """AncesTree's Google client, of the Desktop app type."""

    client_id: str
    client_secret: str

    @classmethod
    def find(cls) -> Client | None:
        """The client named by ANCESTREE_GOOGLE_CLIENT, if that's set (to try another client);
        else the one built into this app; else the maintainer's own copy. None if there's
        none."""
        named = os.environ.get("ANCESTREE_GOOGLE_CLIENT")
        for path in (Path(named) if named else None, BUILT_IN, OWN_COPY):
            if path is not None and path.is_file():
                installed = json.loads(path.read_text(encoding="utf-8"))["installed"]
                return cls(installed["client_id"], installed["client_secret"])
        return None


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
