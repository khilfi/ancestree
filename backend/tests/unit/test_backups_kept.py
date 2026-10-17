"""Backups kept for 3 months: every backup over 92 days old
to the system's bin, here a stand-in for it, the newest 3 always kept; one added from elsewhere
counted from when it came; the copies in another place kept the same way; one that can't go
staying, and Settings told what went. Made-up backups and folders only: no test here sends
anything to this computer's own bin (test_system_bin.py does, on GitHub's machines)."""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from ancestree.config import WhichFamily
from ancestree.services import elsewhere, keeping
from ancestree.services.context import Context
from ancestree.services.exports import list_backups
from ancestree.storage.system_bin import BinError, bin_name

FAMILY = WhichFamily("3f9c0a1b2c3d4e5f", "Keluarga Contoh")
NOW = datetime(2026, 10, 17, 9, 0).astimezone()


@pytest.fixture
def ctx(tmp_path: Path) -> Context:
    data = tmp_path / "family"
    data.mkdir()
    return Context(None, "neo4j", data, tmp_path / "backups", True, FAMILY)  # type: ignore[arg-type]


class StandIn:
    """The system's bin, here: what's sent to it is moved into a folder of its own."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        folder.mkdir()

    def __call__(self, path: Path) -> None:
        path.replace(self.folder / path.name)

    def holds(self) -> set[str]:
        return {path.name for path in self.folder.iterdir()}


@pytest.fixture
def bin(tmp_path: Path) -> StandIn:
    return StandIn(tmp_path / "bin")


def made(folder: Path, days_ago: float, kind: str = "", came_days_ago: float | None = None) -> str:
    """A backup made `days_ago`, kept in `folder` since `came_days_ago` (when it was made)."""
    folder.mkdir(parents=True, exist_ok=True)
    when = NOW - timedelta(days=days_ago)
    path = folder / f"ancestree-backup-{when:%Y-%m-%dT%H-%M-%S}{kind}"
    path.write_bytes(b"a made-up archive")
    came = (NOW - timedelta(days=days_ago if came_days_ago is None else came_days_ago)).timestamp()
    os.utime(path, (came, came))
    return path.name


def here(folder: Path) -> set[str]:
    return {path.name for path in folder.iterdir()}


def test_backups_of_100_days_ago_go_to_the_bin_and_those_of_80_stay(
    ctx: Context, bin: StandIn
) -> None:
    kept = [
        made(ctx.backups, 1, "-automatic.zip"),
        made(ctx.backups, 30, ".zip"),  # with Back up now
        made(ctx.backups, 60, "-automatic.zip"),
        made(ctx.backups, 80, ".zip"),  # the safety one before an import
    ]
    gone = [
        made(ctx.backups, 100, "-automatic.zip"),
        made(ctx.backups, 100.5, ".zip"),
        made(ctx.backups, 400, "-automatic-2.zip"),
    ]
    (ctx.backups / "notes.txt").write_text("not a backup")

    done = keeping.tidy(ctx.backups, NOW, bin)

    assert sorted(done.binned) == sorted(gone)
    assert (done.stayed, done.why) == ([], "")
    assert here(ctx.backups) == {*kept, "notes.txt"}
    assert bin.holds() == set(gone)
    assert keeping.tidy(ctx.backups, NOW, bin).binned == []


def test_92_days_is_the_line(ctx: Context, bin: StandIn) -> None:
    newest = [made(ctx.backups, day, ".zip") for day in (1, 2, 3)]
    on_the_line = made(ctx.backups, 92, ".zip")
    just_over = made(ctx.backups, 92.01, ".zip")
    keeping.tidy(ctx.backups, NOW, bin)
    assert here(ctx.backups) == {*newest, on_the_line}
    assert bin.holds() == {just_over}


def test_with_only_old_backups_the_newest_3_stay(ctx: Context, bin: StandIn) -> None:
    """A family not opened for months never loses every backup at once."""
    old = [made(ctx.backups, days, ".zip") for days in (200, 210, 220, 230, 240)]
    keeping.tidy(ctx.backups, NOW, bin)
    assert here(ctx.backups) == set(old[:3])
    assert bin.holds() == set(old[3:])


def test_one_added_from_elsewhere_counts_from_when_it_came(ctx: Context, bin: StandIn) -> None:
    """The user's word of 17 Oct 2026: added to be restored, it isn't taken away at once."""
    for days in (1, 2, 3):
        made(ctx.backups, days, "-automatic.zip")
    added = made(ctx.backups, 400, ".zip", came_days_ago=0)
    added_long_ago = made(ctx.backups, 400, "-2.zip", came_days_ago=95)
    keeping.tidy(ctx.backups, NOW, bin)
    assert added in here(ctx.backups)
    assert bin.holds() == {added_long_ago}


def test_one_that_cant_go_stays_and_says_why(ctx: Context) -> None:
    for days in (1, 2, 3):
        made(ctx.backups, days, ".zip")
    old = made(ctx.backups, 120, ".zip")

    def no_bin(path: Path) -> None:
        raise BinError("E:\\ has no Recycle Bin, or it's set to delete at once")

    done = keeping.tidy(ctx.backups, NOW, no_bin)
    assert (done.binned, done.stayed) == ([], [old])
    assert "has no Recycle Bin" in done.why
    assert old in here(ctx.backups)  # never deleted for good


def test_copies_in_another_place_are_kept_the_same_way(
    ctx: Context, tmp_path: Path, bin: StandIn
) -> None:
    usb = tmp_path / "usb"
    usb.mkdir()
    elsewhere.choose(ctx, str(usb), None)
    there = elsewhere.family_folder(ctx, usb)
    kept = [made(there, days, "-automatic.zip") for days in (1, 50, 80)]
    kept.append(made(there, 85, ".locked"))  # a locked copy
    gone = [made(there, 100, "-automatic.locked"), made(there, 300, ".zip")]

    note = keeping.keep_three_months(ctx, NOW, bin)

    assert here(there) == set(kept)
    assert bin.holds() == set(gone)
    assert (note.backups, note.copies, note.stayed) == (0, 2, 0)


@pytest.mark.anyio
async def test_settings_is_told_what_went_to_the_bin(ctx: Context, bin: StandIn) -> None:
    assert (await list_backups(ctx)).binned is None  # nothing has gone yet
    for days in (1, 2, 3):
        made(ctx.backups, days, ".zip")
    for days in (100, 101, 102, 103):
        made(ctx.backups, days, "-automatic.zip")

    keeping.keep_three_months(ctx, NOW, bin)

    said = (await list_backups(ctx)).binned
    assert said is not None
    assert (said.at, said.backups, said.copies, said.bin, said.stayed) == (NOW, 4, 0, bin_name(), 0)
    assert len(here(ctx.backups)) == 3

    # An hour on, nothing more is due: what went last is still said.
    keeping.keep_three_months(ctx, NOW + timedelta(hours=1), bin)
    again = (await list_backups(ctx)).binned
    assert again is not None
    assert (again.at, again.backups) == (NOW, 4)


@pytest.mark.anyio
async def test_settings_is_told_what_couldnt_go_until_it_has(ctx: Context, bin: StandIn) -> None:
    for days in (1, 2, 3):
        made(ctx.backups, days, ".zip")
    old = made(ctx.backups, 120, ".zip")

    def refused(path: Path) -> None:
        raise BinError("the Mac said no")

    keeping.keep_three_months(ctx, NOW, refused)
    said = (await list_backups(ctx)).binned
    assert said is not None
    assert (said.at, said.stayed, said.why) == (None, 1, "the Mac said no")
    assert old in here(ctx.backups)

    keeping.keep_three_months(ctx, NOW + timedelta(hours=1), bin)
    gone = (await list_backups(ctx)).binned
    assert gone is not None
    assert (gone.backups, gone.stayed, gone.why) == (1, 0, "")
