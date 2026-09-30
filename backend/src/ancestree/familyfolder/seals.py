"""How the family folder's files are sealed: encrypted, signed, and bound to their place.

A sealed file is a short header (what it is, which family key locked it, who signed it), the
payload encrypted with AES-256-GCM, and an Ed25519 signature over both. The file's place in
the folder ("record/42") is part of what's encrypted and signed, so a file moved or copied
to another place doesn't check out.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import struct
from dataclasses import dataclass
from enum import IntEnum

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"ATF1"
HEADER = struct.Struct(">4sBI32s12s")  # magic, kind, key epoch, signer, nonce
SIGNATURE = 64
NO_NONCE = bytes(12)


class Kind(IntEnum):
    RECORD = 1  # a change set in the family's record: the keeper's
    SNAPSHOT = 2  # the whole family at one point in the record: the keeper's
    PROPOSAL = 3  # changes a computer sends the keeper: that computer's
    MEMBER = 4  # a computer's place in the family, with the keys locked for it: the keeper's
    JOIN = 5  # a computer asking to join: that computer's own
    NOTE = 6  # the keeper's answer to a proposal
    FILE = 7  # a photo or picture
    RECOVERY = 8  # the keeper's keys, locked with the recovery code


class RefusedError(Exception):
    """A file that doesn't check out: half-synced, damaged, or not what it claims to be."""


@dataclass(frozen=True)
class Opened:
    kind: Kind
    epoch: int
    signer: bytes
    payload: bytes


def seal(
    kind: Kind,
    place: str,
    payload: bytes,
    signer: Ed25519PrivateKey,
    key: bytes | None,
    epoch: int = 0,
) -> bytes:
    """Encrypt `payload` with `key` (unless it's None), and sign it, bound to `place`."""
    nonce = os.urandom(12) if key is not None else NO_NONCE
    signer_bytes = signer.public_key().public_bytes_raw()
    header = HEADER.pack(MAGIC, kind, epoch, signer_bytes, nonce)
    context = header + place.encode()
    body = AESGCM(key).encrypt(nonce, payload, context) if key is not None else payload
    return header + body + signer.sign(context + body)


def peek(blob: bytes) -> tuple[Kind, int, bytes]:
    """What a file says it is, which key locked it and who signed it, before any check."""
    if len(blob) < HEADER.size + SIGNATURE:
        raise RefusedError("too short: half-synced or damaged")
    magic, kind, epoch, signer, _ = HEADER.unpack_from(blob)
    if magic != MAGIC:
        raise RefusedError("not a family folder file")
    try:
        return Kind(kind), epoch, signer
    except ValueError:
        raise RefusedError("of an unknown kind") from None


def unseal(
    blob: bytes,
    place: str,
    kind: Kind,
    signers: set[bytes] | None,
    key: bytes | None,
) -> Opened:
    """Check a file and open it. `signers`: who may have written it (None: whoever says so)."""
    found, epoch, signer = peek(blob)
    if found != kind:
        raise RefusedError(f"a {found.name.lower()} where a {kind.name.lower()} belongs")
    if signers is not None and signer not in signers:
        raise RefusedError("signed by a computer that may not write it")
    header, body, signature = blob[: HEADER.size], blob[HEADER.size : -SIGNATURE], blob[-SIGNATURE:]
    context = header + place.encode()
    try:
        Ed25519PublicKey.from_public_bytes(signer).verify(signature, context + body)
    except InvalidSignature:
        raise RefusedError("its signature doesn't match: changed, or half-synced") from None
    if key is None:
        return Opened(found, epoch, signer, body)
    try:
        return Opened(found, epoch, signer, AESGCM(key).decrypt(header[-12:], body, context))
    except InvalidTag:
        raise RefusedError("it doesn't open with the family's key") from None


def seal_for(recipient: bytes, payload: bytes, context: bytes) -> bytes:
    """Lock `payload` for one computer's X25519 key alone (an ephemeral key and HKDF)."""
    ephemeral = X25519PrivateKey.generate()
    ours = ephemeral.public_key().public_bytes_raw()
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(recipient))
    key = _derive(shared, b"AncesTree sealed for" + ours + recipient + context)
    nonce = os.urandom(12)
    return ours + nonce + AESGCM(key).encrypt(nonce, payload, context)


def open_for(recipient: X25519PrivateKey, sealed: bytes, context: bytes) -> bytes:
    theirs, nonce, body = sealed[:32], sealed[32:44], sealed[44:]
    try:
        shared = recipient.exchange(X25519PublicKey.from_public_bytes(theirs))
        mine = recipient.public_key().public_bytes_raw()
        key = _derive(shared, b"AncesTree sealed for" + theirs + mine + context)
        return AESGCM(key).decrypt(nonce, body, context)
    except InvalidTag, ValueError:
        raise RefusedError("not locked for this computer") from None


def _derive(secret: bytes, info: bytes) -> bytes:
    return HKDF(SHA256(), 32, salt=None, info=info).derive(secret)


def fingerprint(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def file_name(naming: bytes, data: bytes) -> str:
    """A photo's name: a keyed fingerprint, so a known photo can't be looked for by its hash."""
    return hmac.new(naming, data, hashlib.sha256).hexdigest()[:32]


def join_code(keeper: bytes, device_sign: bytes, device_dh: bytes) -> str:
    """The code both screens show when a computer asks to join: 40 bits, read over the phone."""
    digest = hashlib.sha256(b"AncesTree join" + keeper + device_sign + device_dh).digest()
    text = base64.b32encode(digest[:5]).decode()
    return f"{text[:4]}-{text[4:]}"


def recovery_code() -> str:
    """16 random bytes, written for the recovery sheet in groups of four."""
    text = base64.b32encode(os.urandom(16)).decode().rstrip("=")
    return " ".join(text[i : i + 4] for i in range(0, len(text), 4))


def recovery_key(code: str, family: str) -> bytes:
    """The key the recovery code stands for; spaces and case don't matter when it's typed."""
    cleaned = "".join(code.split()).upper().encode()
    return Scrypt(salt=family.encode(), length=32, n=2**15, r=8, p=1).derive(cleaned)
