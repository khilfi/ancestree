"""Removing AncesTree, with the backups safe: the note AncesTree
keeps for Windows' uninstaller, with the keeper's warning; each family's backups saved to a
folder, as the uninstaller keeps them in Documents; and AncesTree's folder to the Bin on the Mac
and Linux, here with a stand-in for the bin. Made-up folders only: nothing here goes to this
computer's own bin, and nothing reads the families of the AncesTree installed on it."""

from __future__ import annotations

import configparser
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path, PureWindowsPath

import pytest

from ancestree.desktop import removing
from ancestree.desktop.families import Families
from ancestree.desktop.removing import (
    KEPT,
    NOTE,
    RemovingError,
    families_here,
    folder_names,
    note_text,
    save_backups,
    to_bin,
    write_note,
)
from ancestree.storage import system_bin
from ancestree.storage.system_bin import BinError, folder_to_bin


def with_backups(families: Families, family_id: str, *names: str) -> Path:
    backups = families.places(families.get(family_id)).backups
    backups.mkdir(parents=True, exist_ok=True)
    for name in names:
        (backups / name).write_bytes(f"a made-up backup: {name}".encode())
    return backups


def kept_here(families: Families, family_id: str, copied: datetime | None = None) -> None:
    """This computer keeps that family's family folder, as its setup.json says; and its backups
    were last copied to another place at `copied`."""
    data = families.places(families.get(family_id)).data
    (data / "familyfolder").mkdir(parents=True, exist_ok=True)
    setup = {"role": "keeper", "folder": "f", "family": "x", "computer": "c", "account": "a"}
    (data / "familyfolder" / "setup.json").write_text(json.dumps(setup), encoding="utf-8")
    if copied is not None:
        elsewhere = {"folder": "E:\\", "locked": True, "copied": copied.isoformat()}
        (data / "elsewhere.json").write_text(json.dumps(elsewhere), encoding="utf-8")


def two_families(root: Path) -> tuple[Families, str, str]:
    families = Families.load(root, "Keluarga Contoh")
    first = families.open.id
    second = families.add("Keluarga Ibu").id
    return families, first, second


def read_note(root: Path) -> configparser.ConfigParser:
    """The note, as Windows' uninstaller reads it: UTF-16 with its byte-order mark."""
    data = (root / NOTE).read_bytes()
    assert data.startswith(b"\xff\xfe")  # little-endian UTF-16, as Windows reads Unicode
    text = data.decode("utf-16")
    assert "\r\n" in text
    note = configparser.ConfigParser(interpolation=None, comment_prefixes=(";",))
    note.read_string(text)
    return note


def test_the_keepers_warning_is_in_the_plans_words() -> None:
    """The plan's sentences, for the family this computer keeps."""
    assert removing.keeps(["My family"]) == (
        "This computer keeps My family. If you delete it, keeping the family again needs your "
        "recovery code, your Google project's client file and the keeper's Google account."
    )
    assert removing.not_copied("My family", several=False) == (
        "None of its backups has been copied to another place in the last 7 days."
    )
    assert removing.keeps([]) == ""
    several = removing.keeps(["Keluarga Contoh", "Keluarga Ibu", "Keluarga Ayah"])
    assert several.startswith(
        "This computer keeps Keluarga Contoh, Keluarga Ibu and Keluarga Ayah."
    )
    assert "keeping each again" in several
    assert "Keluarga Ibu" in removing.not_copied("Keluarga Ibu", several=True)
    assert "Hand the family to someone else…" in removing.first(several=False)
    assert timedelta(days=7) == removing.RECENT


def test_the_note_lists_each_family_its_backups_and_whether_its_kept_here(tmp_path: Path) -> None:
    families, first, second = two_families(tmp_path)
    with_backups(families, first, "ancestree-backup-2026-11-01T09-00-00-automatic.zip")
    with_backups(families, second, "ancestree-backup-2026-11-02T09-00-00.zip")
    copied = datetime(2026, 11, 10, 8, 0, tzinfo=UTC)
    kept_here(families, second, copied)

    assert write_note(families) is True
    note = read_note(tmp_path)

    assert note["AncesTree"]["families"] == "2"
    assert note["AncesTree"]["warning"] == removing.keeps(["Keluarga Ibu"])
    assert note["AncesTree"]["first"] == removing.first(several=False)
    one, two = note["family1"], note["family2"]
    assert (one["name"], one["backups"], one["folder"]) == (
        "Keluarga Contoh",
        "backups",  # the first family's, in AncesTree's own folder
        "Keluarga Contoh",
    )
    assert (one["keeper"], one["copied"], one["stale"]) == ("0", "0", "")
    assert two["backups"] == f"families\\{second}\\backups"  # as the uninstaller joins it
    assert (two["keeper"], two["copied"]) == ("1", str(int(copied.timestamp())))
    assert two["stale"] == removing.not_copied("Keluarga Ibu", several=False)

    assert write_note(families) is False  # as it was: not written again


def test_a_name_of_every_kind_is_in_the_note_as_it_is(tmp_path: Path) -> None:
    """Windows reads a note in UTF-16 as Unicode: a name in Jawi, or with accents, shows whole."""
    families = Families.load(tmp_path, "كلوارݢ چونتوه")
    families.add("Famille modèle")
    write_note(families)
    note = read_note(tmp_path)
    assert note["family1"]["name"] == "كلوارݢ چونتوه"
    assert note["family2"]["name"] == "Famille modèle"


def test_the_note_follows_the_families_list(tmp_path: Path) -> None:
    """Each time families.json is saved, the engine writes the note again."""
    families = Families.load(tmp_path, "Keluarga Contoh")
    families.saved = write_note
    added = families.add("Keluarga Ibu")
    assert read_note(tmp_path)["AncesTree"]["families"] == "2"
    families.rename(added.id, "Ibu")
    assert read_note(tmp_path)["family2"]["name"] == "Ibu"
    families.remove(added.id)
    note = read_note(tmp_path)
    assert note["AncesTree"]["families"] == "2"  # one in the Trash, still on this computer
    assert note["family2"]["folder"] == "Ibu (removed)"


def test_a_family_in_ancestrees_bin_keeps_its_backups_too(tmp_path: Path) -> None:
    """The user's answer of 19 Nov 2026: a family removed under 30 days ago can still be put
    back, so its backups are kept as every family's are, in a folder of its name and
    "(removed)": by the uninstaller, from the note, and by Save the backups to a folder…."""
    families, first, second = two_families(tmp_path / "app")
    with_backups(families, first, "ancestree-backup-2026-11-01T09-00-00-automatic.zip")
    with_backups(families, second, "ancestree-backup-2026-11-02T09-00-00.zip")
    kept_here(families, second)
    removed = families.remove(second)

    write_note(families)
    note = read_note(tmp_path / "app")
    assert note["AncesTree"]["families"] == "2"
    two = note["family2"]
    assert (two["name"], two["folder"], two["removed"]) == (
        "Keluarga Ibu",
        "Keluarga Ibu (removed)",
        "1",
    )
    assert two["backups"] == str(PureWindowsPath(removed.folder, "backups"))
    assert two["keeper"] == "0"  # out of the list: no keeper's warning for it
    assert note["AncesTree"]["warning"] == ""
    assert note["family1"]["removed"] == "0"

    stick = tmp_path / "USB stick"
    stick.mkdir()
    saved = save_backups(families, stick)
    assert (saved.families, saved.backups) == (2, 2)
    kept = stick / KEPT / "Keluarga Ibu (removed)" / "ancestree-backup-2026-11-02T09-00-00.zip"
    assert kept.read_bytes() == b"a made-up backup: ancestree-backup-2026-11-02T09-00-00.zip"
    assert [each.removed for each in families_here(families)] == [False, True]


def test_backups_saved_by_hand_count_as_copied_elsewhere(tmp_path: Path) -> None:
    families = Families.load(tmp_path, "Keluarga Contoh")
    kept_here(families, families.open.id, datetime(2026, 9, 1, tzinfo=UTC))
    saved = datetime(2026, 11, 18, 21, 0, tzinfo=UTC)
    families.note(families.open.id, saved=saved.isoformat())
    [here] = families_here(families)
    assert here.copied == saved  # the later of the two
    assert "copied=" + str(int(saved.timestamp())) in note_text([here])


@pytest.mark.parametrize(
    ("names", "folders"),
    [
        (["Keluarga Contoh"], ["Keluarga Contoh"]),
        (["Keluarga: Ibu / Ayah?"], ["Keluarga- Ibu - Ayah-"]),
        (["Keluarga Contoh", "keluarga contoh"], ["Keluarga Contoh", "keluarga contoh (2)"]),
        (["CON", "nul.txt", "Lpt1"], ["CON family", "nul.txt family", "Lpt1 family"]),
        (["...", "Keluarga. "], ["A family", "Keluarga"]),
    ],
)
def test_each_familys_folder_is_named_as_windows_allows(
    names: list[str], folders: list[str]
) -> None:
    assert folder_names(names) == folders


def test_every_familys_backups_are_saved_to_a_folder_each(tmp_path: Path) -> None:
    families, first, second = two_families(tmp_path / "app")
    with_backups(families, first, "ancestree-backup-2026-11-01T09-00-00-automatic.zip")
    with_backups(
        families,
        second,
        "ancestree-backup-2026-11-02T09-00-00.zip",
        "ancestree-backup-2026-11-03T09-00-00-automatic.zip",
    )
    stick = tmp_path / "USB stick"
    stick.mkdir()

    saved = save_backups(families, stick)

    assert (saved.folder, saved.families, saved.backups, saved.copied) == (stick / KEPT, 2, 3, 3)
    assert sorted(path.name for path in (stick / KEPT / "Keluarga Ibu").iterdir()) == [
        "ancestree-backup-2026-11-02T09-00-00.zip",
        "ancestree-backup-2026-11-03T09-00-00-automatic.zip",
    ]
    copy = stick / KEPT / "Keluarga Contoh" / "ancestree-backup-2026-11-01T09-00-00-automatic.zip"
    assert copy.read_bytes() == f"a made-up backup: {copy.name}".encode()
    assert (families.places(families.get(first)).backups / copy.name).is_file()  # left there

    again = save_backups(families, stick)
    assert (again.backups, again.copied) == (3, 0)  # there already

    # Another file of a backup's name is never written over.
    copy.write_bytes(b"not that backup")
    save_backups(families, stick)
    assert copy.read_bytes() == b"not that backup"
    assert (copy.parent / "ancestree-backup-2026-11-01T09-00-00-automatic (2).zip").is_file()
    assert not list((stick / KEPT).rglob("*.partial"))


def test_backups_are_never_saved_into_ancestrees_own_folder_or_nowhere(tmp_path: Path) -> None:
    families = Families.load(tmp_path / "app", "Keluarga Contoh")
    added = families.add("Keluarga Ibu")
    for inside_it in (tmp_path / "app", families.places(added).backups):
        with pytest.raises(RemovingError) as inside:
            save_backups(families, inside_it)
        assert inside.value.code == "inside_ancestree"
    with pytest.raises(RemovingError) as nowhere:
        save_backups(families, tmp_path / "unplugged")
    assert nowhere.value.code == "no_such_folder"
    with pytest.raises(RemovingError):
        save_backups(families, Path("relative"))


class Bin:
    """The system's bin, here: what was sent to it."""

    def __init__(self) -> None:
        self.sent: list[Path] = []

    def __call__(self, path: Path) -> str:
        self.sent.append(path)
        return f"/the bin/{path.name}"


def test_ancestrees_folder_goes_to_the_bin_whole_on_the_mac_and_linux(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    Families.load(tmp_path, "Keluarga Contoh")
    bin_ = Bin()
    for platform in ("darwin", "linux"):
        monkeypatch.setattr(sys, "platform", platform)
        assert to_bin(tmp_path, bin_) == f"/the bin/{tmp_path.name}"
    assert bin_.sent == [tmp_path, tmp_path]


def test_only_ancestrees_own_folder_goes_and_never_on_windows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bin_ = Bin()
    monkeypatch.setattr(sys, "platform", "linux")
    with pytest.raises(RemovingError) as not_ours:
        to_bin(tmp_path, bin_)  # no families.json: not AncesTree's
    assert not_ours.value.code == "not_ancestree"
    Families.load(tmp_path, "Keluarga Contoh")
    monkeypatch.setattr(sys, "platform", "win32")
    with pytest.raises(RemovingError) as windows:
        to_bin(tmp_path, bin_)
    assert windows.value.code == "uninstaller"
    assert bin_.sent == []


def test_a_folder_goes_to_the_freedesktop_trash_whole(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Linux's Trash, in a made-up home: AncesTree's folder as one item, put back whole."""
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    root = tmp_path / "data" / "app.ancestree.desktop"
    (root / "backups").mkdir(parents=True)
    (root / "backups" / "ancestree-backup-2026-11-01T09-00-00.zip").write_bytes(b"kept")

    landed = Path(system_bin._freedesktop(root))

    assert not root.exists()
    assert landed == tmp_path / "data" / "Trash" / "files" / "app.ancestree.desktop"
    assert (landed / "backups" / "ancestree-backup-2026-11-01T09-00-00.zip").read_bytes() == b"kept"
    assert (tmp_path / "data" / "Trash" / "info" / "app.ancestree.desktop.trashinfo").is_file()


def test_a_folder_never_goes_to_windows_recycle_bin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "platform", "win32")
    with pytest.raises(BinError, match="uninstaller"):
        folder_to_bin(tmp_path)
    assert tmp_path.is_dir()
    with pytest.raises(BinError, match="isn't there"):
        folder_to_bin(tmp_path / "nowhere")
