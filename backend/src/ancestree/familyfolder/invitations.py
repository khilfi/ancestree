"""Invitations (0.4.0): what a family's keeper sends a relative, for their AncesTree to join.

An invitation holds the family's Google project, as its client of the Desktop app type, which
the relative's AncesTree signs in through; and which family it is, as the id in its family
folder's family.json. Nothing of the family's own: no name, no keys. Drive still lets in only
the accounts the keeper shared the folder with, and the keeper still checks each computer's
code, so an invitation passed on by mistake lets no one in.

It's one line of text, to send in a message and paste back:

    ATI1-<the client and the family, as JSON in base64url>-<six hex digits of its SHA-256>

The check at the end catches one cut short on the way.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass

from ancestree.familyfolder.google import CLIENT_ID, Client

PREFIX = "ATI1"
FAMILY = re.compile(r"[0-9a-f]{16}")
_FOUND = re.compile(PREFIX + r"-([A-Za-z0-9_-]+)-([0-9a-f]{6})")
_NOT_WHOLE = (
    "That invitation isn't whole: part of it was lost on the way. Copy all of it, and paste it "
    "again."
)


class InvitationError(ValueError):
    """Not an invitation AncesTree can read: in plain words."""


@dataclass(frozen=True)
class Invitation:
    client: Client
    family: str  # the family folder's family id

    def text(self) -> str:
        body = json.dumps(
            {
                "client": self.client.client_id,
                "secret": self.client.client_secret,
                "project": self.client.project,
                "family": self.family,
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        encoded = base64.urlsafe_b64encode(body).rstrip(b"=").decode()
        return f"{PREFIX}-{encoded}-{hashlib.sha256(body).hexdigest()[:6]}"

    @classmethod
    def read(cls, text: str) -> Invitation:
        """An invitation, from what was pasted: the message around it, and any line breaks a
        message app put in it, don't matter."""
        found = _FOUND.search("".join(text.split()))
        if found is None:
            raise InvitationError(
                f"That isn't an AncesTree invitation, which starts with {PREFIX}-. Copy all of "
                "it from your keeper's message, and paste it again."
            )
        encoded, check = found.groups()
        try:
            body = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        except (binascii.Error, ValueError) as error:
            raise InvitationError(_NOT_WHOLE) from error
        if hashlib.sha256(body).hexdigest()[:6] != check:
            raise InvitationError(_NOT_WHOLE)
        try:
            saved = json.loads(body)
            client_id, secret = saved["client"], saved["secret"]
            project, family = saved.get("project", ""), saved["family"]
        except (ValueError, KeyError, TypeError) as error:
            raise InvitationError(_NOT_WHOLE) from error
        if (
            not isinstance(client_id, str)
            or not CLIENT_ID.fullmatch(client_id)
            or not isinstance(secret, str)
            or not secret
            or not isinstance(project, str)
            or not isinstance(family, str)
            or not FAMILY.fullmatch(family)
        ):
            raise InvitationError(
                "That invitation can't be used: ask your family's keeper for a new one."
            )
        return cls(Client(client_id, secret, project, invited=True), family)
