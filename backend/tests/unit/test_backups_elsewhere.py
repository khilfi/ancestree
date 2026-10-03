"""Copies of the backups in a second place (0.4.0): a USB stick, another disk, or a cloud's
folder. Made-up backups and folders only."""

from __future__ import annotations

from pathlib import Path

import pytest

from ancestree.config import WhichFamily
from ancestree.exchange.locked import MAGIC, key_for, unlock
from ancestree.services import elsewhere
from ancestree.services.context import Context, RuleError

FAMILY = WhichFamily("3f9c0a1b2c3d4e5f", "Keluarga Contoh")


@pytest.fixture
def ctx(tmp_path: Path) -> Context:
    data = tmp_path / "family"
    data.mkdir()
    return Context(None, "neo4j", data, tmp_path / "backups", True, FAMILY)  # type: ignore[arg-type]


def backups(ctx: Context, *names: str) -> None:
    ctx.backups.mkdir(exist_ok=True)
    for name in names:
        (ctx.backups / name).write_bytes(b"a made-up archive: " + name.encode())


def test_every_backup_is_copied_to_the_familys_own_folder_there(
    ctx: Context, tmp_path: Path
) -> None:
    usb = tmp_path / "usb"
    usb.mkdir()
    backups(ctx, "ancestree-backup-2026-10-01T09-00-00.zip")
    elsewhere.choose(ctx, str(usb), None)
    assert elsewhere.catch_up(ctx) == 1
    inside = usb / "AncesTree 3f9c0a1b2c3d4e5f"  # by the family's id, never its name
    assert [path.name for path in inside.iterdir()] == ["ancestree-backup-2026-10-01T09-00-00.zip"]

    backups(ctx, "ancestree-backup-2026-10-02T09-00-00-automatic.zip")
    assert elsewhere.catch_up(ctx) == 1  # only what isn't there yet
    status = elsewhere.status(ctx)
    assert status is not None
    assert (status.copies, status.waiting, status.locked, status.problem) == (2, 0, False, "")
    assert status.inside == str(inside)
    assert status.copied is not None


def test_copies_locked_with_a_password_open_with_it_alone(ctx: Context, tmp_path: Path) -> None:
    cloud = tmp_path / "OneDrive"
    cloud.mkdir()
    backups(ctx, "ancestree-backup-2026-10-01T09-00-00.zip")
    elsewhere.choose(ctx, str(cloud), "a made-up password")
    assert elsewhere.catch_up(ctx) == 1
    [copy] = (cloud / "AncesTree 3f9c0a1b2c3d4e5f").iterdir()
    assert copy.name == "ancestree-backup-2026-10-01T09-00-00.locked"
    assert copy.read_bytes().startswith(MAGIC)
    assert b"a made-up archive" not in copy.read_bytes()
    assert "a made-up password" not in (ctx.data_dir / elsewhere.SETTINGS).read_text("utf-8")
    opened = unlock(copy, tmp_path / "opened.zip", key_for(copy, "a made-up password"))
    assert opened.read_bytes() == b"a made-up archive: ancestree-backup-2026-10-01T09-00-00.zip"


def test_a_place_out_of_reach_waits_and_catches_up(ctx: Context, tmp_path: Path) -> None:
    usb = tmp_path / "usb"
    usb.mkdir()
    elsewhere.choose(ctx, str(usb), None)
    usb.rmdir()  # the USB stick taken out
    backups(ctx, "ancestree-backup-2026-10-01T09-00-00.zip")
    assert elsewhere.catch_up(ctx) == 0
    status = elsewhere.status(ctx)
    assert status is not None
    assert (status.reachable, status.waiting) == (False, 1)
    assert "can't be reached" in status.problem

    usb.mkdir()  # back
    assert elsewhere.catch_up(ctx) == 1
    status = elsewhere.status(ctx)
    assert status is not None
    assert (status.reachable, status.waiting, status.problem) == (True, 0, "")


def test_the_last_30_daily_copies_are_kept_and_those_made_by_hand_for_ever(
    ctx: Context, tmp_path: Path
) -> None:
    usb = tmp_path / "usb"
    usb.mkdir()
    daily = [f"ancestree-backup-2026-09-{day:02d}T09-00-00-automatic.zip" for day in range(1, 31)]
    backups(ctx, *daily, "ancestree-backup-2026-09-01T12-00-00.zip")
    elsewhere.choose(ctx, str(usb), None)
    elsewhere.catch_up(ctx)
    (ctx.backups / daily[0]).unlink()  # tidied here, as the 31st arrives
    backups(ctx, "ancestree-backup-2026-10-01T09-00-00-automatic.zip")
    elsewhere.catch_up(ctx)
    there = {path.name for path in (usb / "AncesTree 3f9c0a1b2c3d4e5f").iterdir()}
    assert len(there) == 31  # 30 daily, and the one made by hand
    assert daily[0] not in there
    assert "ancestree-backup-2026-09-01T12-00-00.zip" in there


def test_what_cant_be_chosen_is_said(ctx: Context, tmp_path: Path) -> None:
    for folder, password, code in (
        (str(tmp_path / "nowhere"), None, "no_such_folder"),
        ("relative/path", None, "no_such_folder"),
        (str(ctx.backups), None, "same_place"),
        (str(tmp_path), "short", "short_password"),
    ):
        ctx.backups.mkdir(exist_ok=True)
        with pytest.raises(RuleError) as refused:
            elsewhere.choose(ctx, folder, password)
        assert refused.value.code == code
    assert elsewhere.status(ctx) is None


def test_stopping_leaves_the_copies_made(ctx: Context, tmp_path: Path) -> None:
    usb = tmp_path / "usb"
    usb.mkdir()
    backups(ctx, "ancestree-backup-2026-10-01T09-00-00.zip")
    elsewhere.choose(ctx, str(usb), "a made-up password")
    elsewhere.catch_up(ctx)
    elsewhere.stop(ctx)
    assert elsewhere.status(ctx) is None
    assert not (ctx.data_dir / elsewhere.KEY).exists()
    assert len(list((usb / "AncesTree 3f9c0a1b2c3d4e5f").iterdir())) == 1


def test_places_found_are_folders_there_now() -> None:
    for place in elsewhere.places():
        assert Path(place.path).is_dir()
        assert place.kind in ("disk", "cloud")
