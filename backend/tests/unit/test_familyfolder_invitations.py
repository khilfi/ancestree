"""A family's own Google client, from the file Google's console gives, and the invitations that
carry it to relatives (0.4.0)."""

from __future__ import annotations

import base64
import hashlib
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ancestree.familyfolder.google import Client, ClientFileError
from ancestree.familyfolder.invitations import Invitation, InvitationError

OURS = "123456789012-a1b2c3d4e5f6g7h8i9j0.apps.googleusercontent.com"
OTHERS = "987654321098-theirclient.apps.googleusercontent.com"
FAMILY = "3f9c0a1b2c3d4e5f"


def client_file(**installed: object) -> str:
    return json.dumps(
        {
            "installed": {
                "client_id": OURS,
                "project_id": "keluarga-contoh",
                "client_secret": "made-up-secret",
                **installed,
            }
        }
    )


def test_a_desktop_apps_client_comes_from_its_file() -> None:
    client = Client.from_file(client_file())
    assert (client.client_id, client.client_secret, client.project) == (
        OURS,
        "made-up-secret",
        "keluarga-contoh",
    )
    assert (client.number, client.name, client.invited) == (
        "123456789012",
        "keluarga-contoh",
        False,
    )
    nameless = Client.from_file(client_file(project_id=None))
    assert nameless.name == "project 123456789012"


def test_one_projects_clients_share_its_number() -> None:
    first = Client.from_file(client_file())
    second = Client.from_file(client_file(client_id="123456789012-zz.apps.googleusercontent.com"))
    other = Client.from_file(client_file(client_id="987654321098-zz.apps.googleusercontent.com"))
    assert first.number == second.number != other.number


@pytest.mark.parametrize(
    ("text", "says"),
    [
        ("not json", "can't be read"),
        ("[1, 2]", "isn't the file"),
        (json.dumps({"web": {"client_id": OURS, "client_secret": "s"}}), "web application"),
        (client_file(client_id="someone@example.com"), "no Desktop app client"),
        (client_file(client_secret=""), "no secret"),
    ],
)
def test_a_file_that_isnt_a_desktop_apps_client_says_why(text: str, says: str) -> None:
    with pytest.raises(ClientFileError) as refused:
        Client.from_file(text)
    assert says in str(refused.value)


def test_an_invitation_reads_back_as_it_was_made() -> None:
    made = Invitation(Client.from_file(client_file()), FAMILY)
    text = made.text()
    assert text.startswith("ATI1-")
    assert not any(character.isspace() for character in text)  # one line, to paste whole
    read = Invitation.read(text)
    assert read.family == FAMILY
    assert read.client.client_id == OURS
    assert read.client.project == "keluarga-contoh"
    assert read.client.invited  # the project is the keeper's family's


def test_an_invitation_reads_from_the_message_around_it() -> None:
    text = Invitation(Client.from_file(client_file()), FAMILY).text()
    message = (
        f"Install AncesTree, then paste this:\n\n{text[:50]}\n{text[50:120]} {text[120:]}\n\nX"
    )
    assert Invitation.read(message).family == FAMILY


@pytest.mark.parametrize(
    ("change", "says"),
    [
        (lambda text: "Hello, here's the link", "isn't an AncesTree invitation"),
        (lambda text: text[:20] + text[30:], "isn't whole"),
        (lambda text: text[:-1] + ("0" if text[-1] != "0" else "1"), "isn't whole"),
    ],
)
def test_an_invitation_cut_short_or_changed_says_so(change: object, says: str) -> None:
    text = Invitation(Client.from_file(client_file()), FAMILY).text()
    with pytest.raises(InvitationError) as refused:
        Invitation.read(change(text))  # type: ignore[operator]
    assert says in str(refused.value)


def test_an_invitation_that_names_no_family_cant_be_used() -> None:
    made = Invitation(Client.from_file(client_file()), "not-a-family")
    with pytest.raises(InvitationError) as refused:
        Invitation.read(made.text())
    assert "ask your family's keeper for a new one" in str(refused.value)


def body_of(text: str) -> dict[str, str]:
    """An invitation's JSON, as any reader of it sees it."""
    encoded = text.split("-")[1]
    found: dict[str, str] = json.loads(
        base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    )
    return found


def remade(fields: dict[str, str]) -> str:
    """An invitation with these fields, whole: its check at the end made again, as anyone could."""
    body = json.dumps(fields, separators=(",", ":"), sort_keys=True).encode()
    encoded = base64.urlsafe_b64encode(body).rstrip(b"=").decode()
    return f"ATI1-{encoded}-{hashlib.sha256(body).hexdigest()[:6]}"


def test_an_invitation_holds_only_as_the_keeper_signed_it() -> None:
    """Signed with the family's keeper key (0.4.2): changed by anyone, or signed by another key,
    it doesn't hold, so it can't send a family's computers to another Google project."""
    keeper, stranger = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    public = keeper.public_key().public_bytes_raw()
    text = Invitation(Client.from_file(client_file()), FAMILY).signed(keeper).text()

    read = Invitation.read(text)
    assert read.signed_by(public)
    assert not read.signed_by(stranger.public_key().public_bytes_raw())
    for field, changed in (("project", "keluarga-lain"), ("client", OTHERS), ("secret", "x")):
        fields = body_of(text) | {field: changed}
        assert not Invitation.read(remade(fields)).signed_by(public), field
    forged = Invitation(Client.from_file(client_file(client_id=OTHERS)), FAMILY).signed(stranger)
    assert not Invitation.read(forged.text()).signed_by(public)


def test_a_signed_invitation_still_reads_where_none_was_signed() -> None:
    """0.4.0 and 0.4.1 read the same fields, and pass over the signature."""
    text = (
        Invitation(Client.from_file(client_file()), FAMILY)
        .signed(Ed25519PrivateKey.generate())
        .text()
    )
    assert set(body_of(text)) == {"client", "secret", "project", "family", "sig"}
    unsigned = Invitation.read(Invitation(Client.from_file(client_file()), FAMILY).text())
    assert unsigned.signature == b""
    assert not unsigned.signed_by(Ed25519PrivateKey.generate().public_key().public_bytes_raw())


@pytest.mark.parametrize("sig", ["not base64!", "c2hvcnQ", 7])
def test_an_invitation_with_a_broken_signature_cant_be_used(sig: object) -> None:
    fields = body_of(Invitation(Client.from_file(client_file()), FAMILY).text()) | {"sig": sig}
    with pytest.raises(InvitationError) as refused:
        Invitation.read(remade(fields))  # type: ignore[arg-type]
    assert "ask your family's keeper for a new one" in str(refused.value)
