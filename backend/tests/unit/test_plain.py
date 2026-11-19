"""Why something failed, said for the family, the review's #16: never a
computer's error number, a file's path or Python's words."""

import errno
import zlib
from pathlib import Path
from typing import Any

import pytest

from ancestree.config import WhichFamily
from ancestree.domain.dates import DateParseError
from ancestree.domain.plain import plainly
from ancestree.maps.packs import PACKS, Pack, PackStore
from ancestree.services import elsewhere
from ancestree.services.context import Context, RuleError

FAMILY = WhichFamily("3f9c0a1b2c3d4e5f", "Keluarga Contoh")
KEY_FILE = r"C:\Users\someone\AppData\Roaming\AncesTree\copies.key"


@pytest.mark.parametrize(
    ("error", "said"),
    [
        (OSError(errno.ENOSPC, "No space left on device", KEY_FILE), "the disk is full"),
        (PermissionError(errno.EACCES, "Permission denied", KEY_FILE), "didn't let AncesTree"),
        (OSError(errno.EIO, "Input/output error", KEY_FILE), "couldn't read or write a file"),
        (
            zlib.error("Error -3 while decompressing data: invalid stored block lengths"),
            "unexpected",
        ),
        (DateParseError("There's no month 13."), "There's no month 13."),
    ],
)
def test_errors_are_said_plainly(error: BaseException, said: str) -> None:
    words = plainly(error)
    assert said in words
    for raw in ("Errno", "AppData", "Error -3", "No space left"):
        assert raw not in words


def test_a_fetch_that_fails_unexpectedly_says_so_without_pythons_words(tmp_path: Path) -> None:
    def fetcher(pack: Pack, folder: Path, progress: Any) -> Path:
        raise zlib.error("Error -3 while decompressing data: invalid stored block lengths")

    store = PackStore(tmp_path, fetcher=fetcher)
    store.start(PACKS["world"])
    thread = store.fetching["world"].thread
    assert thread is not None
    thread.join(5)
    assert store.fetching["world"].error == (
        "The world couldn't be fetched: something unexpected went wrong. Try it again."
    )


def test_a_copies_key_that_cant_be_kept_says_why_plainly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "family"
    data.mkdir()
    ctx = Context(None, "neo4j", data, tmp_path / "backups", True, FAMILY)  # type: ignore[arg-type]
    usb = tmp_path / "usb"
    usb.mkdir()

    def full(path: Path, secret: bytes) -> None:
        raise OSError(errno.ENOSPC, "No space left on device", KEY_FILE)

    monkeypatch.setattr(elsewhere, "write_secret", full)
    with pytest.raises(RuleError) as refused:
        elsewhere.choose(ctx, str(usb), "a made-up password")
    assert refused.value.message == (
        "The copies' key couldn't be kept on this computer: the disk is full."
    )
