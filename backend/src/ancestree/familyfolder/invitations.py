"""Invitations (0.4.0): what a family's keeper sends a relative, for their AncesTree to join.

An invitation holds the family's Google project, as its client of the Desktop app type, which
the relative's AncesTree signs in through; and which family it is, as the id in its family
folder's family.json. Nothing of the family's own: no name, no keys. Drive still lets in only
the accounts the keeper shared the folder with, and the keeper still checks each computer's
code, so an invitation passed on by mistake lets no one in.

It's one line of text, to send in a message and paste back:

    ATI1-<the client and the family, as JSON in base64url>-<six hex digits of its SHA-256>

The check at the end catches one cut short on the way.

Since 0.4.2 the keeper signs it with the family's keeper key ("sig", in the same JSON, which
0.4.0 and 0.4.1 pass over). A computer already in the family moves to another Google project
only on an invitation that key signed: one made by anyone else, naming the family, can't send
its relatives to sign in elsewhere.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass, replace

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from ancestree.familyfolder.google import CLIENT_ID, Client

PREFIX = "ATI1"
FAMILY = re.compile(r"[0-9a-f]{16}")
_FOUND = re.compile(PREFIX + r"-([A-Za-z0-9_-]+)-([0-9a-f]{6})")
_NOT_WHOLE = (
    "That invitation isn't whole: part of it was lost on the way. Copy all of it, and paste it "
    "again."
)
# What the keeper signs (0.4.2): a line saying what it is, so a signature made for anything else
# never holds for an invitation, then the invitation's own fields.
_SIGNED = b"AncesTree invitation, signed by its family's keeper\n"
_SIGNATURE_BYTES = 64


class InvitationError(ValueError):
    """Not an invitation AncesTree can read: in plain words."""


@dataclass(frozen=True)
class Invitation:
    client: Client
    family: str  # the family folder's family id
    signature: bytes = b""  # the keeper's, over the rest (0.4.2); none in one made before

    def _fields(self) -> dict[str, str]:
        return {
            "client": self.client.client_id,
            "secret": self.client.client_secret,
            "project": self.client.project,
            "family": self.family,
        }

    def _signed_part(self) -> bytes:
        return _SIGNED + json.dumps(self._fields(), separators=(",", ":"), sort_keys=True).encode()

    def signed(self, keeper: Ed25519PrivateKey) -> Invitation:
        """The same invitation, signed with the family's keeper key."""
        return replace(self, signature=keeper.sign(self._signed_part()))

    def signed_by(self, keeper: bytes) -> bool:
        """Whether the family's keeper, whose public key this is, signed it as it stands."""
        if not self.signature:
            return False
        try:
            Ed25519PublicKey.from_public_bytes(keeper).verify(self.signature, self._signed_part())
        except InvalidSignature, ValueError:
            return False
        return True

    def text(self) -> str:
        fields: dict[str, str] = self._fields()
        if self.signature:
            fields["sig"] = base64.urlsafe_b64encode(self.signature).rstrip(b"=").decode()
        body = json.dumps(fields, separators=(",", ":"), sort_keys=True).encode()
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
            sig = saved.get("sig", "")
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            raise InvitationError(_NOT_WHOLE) from error
        unusable = InvitationError(
            "That invitation can't be used: ask your family's keeper for a new one."
        )
        if (
            not isinstance(client_id, str)
            or not CLIENT_ID.fullmatch(client_id)
            or not isinstance(secret, str)
            or not secret
            or not isinstance(project, str)
            or not isinstance(family, str)
            or not FAMILY.fullmatch(family)
            or not isinstance(sig, str)
        ):
            raise unusable
        try:
            signature = base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4)) if sig else b""
        except (binascii.Error, ValueError) as error:
            raise unusable from error
        if sig and len(signature) != _SIGNATURE_BYTES:
            raise unusable
        return cls(Client(client_id, secret, project, invited=True), family, signature)
