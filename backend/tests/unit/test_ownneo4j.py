"""The app's own Neo4j: fetching, checking and unpacking it, and how it's set up.

Nothing here fetches anything or starts Neo4j. The integration tests run on the app's own
Neo4j with ANCESTREE_TEST_NEO4J=own (tests/integration/conftest.py).
"""

from __future__ import annotations

import hashlib
import io
import platform
import sys
import tarfile
import threading
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, ClassVar

import pytest

from ancestree.ownneo4j import runtime as runtime_module
from ancestree.ownneo4j.runtime import (
    JAVA,
    NEO4J,
    Download,
    FetchError,
    Runtime,
    fetch,
    this_system,
    unpack,
)
from ancestree.ownneo4j.server import FAMILY_SIZED, OwnNeo4j, StoppedError

SHIPPED = """# Neo4j's own settings, as shipped (a few of them)
server.default_listen_address=0.0.0.0
server.jvm.additional=-XX:+UseG1GC
#server.jvm.additional=-Dnot.this.one=1
server.jvm.additional=-Djdk.nio.maxCachedBufferSize=1024
db.tx_log.rotation.retention_policy=2 days
dbms.usage_report.enabled=true
"""


def made_up_runtime(tmp_path: Path, system: tuple[str, str] = ("windows", "x64")) -> Runtime:
    runtime = Runtime(tmp_path / "runtime", system)
    (runtime.neo4j_home / "conf").mkdir(parents=True)
    (runtime.neo4j_home / "conf" / "neo4j.conf").write_text(SHIPPED, encoding="utf-8")
    return runtime


@pytest.fixture
def admin_calls() -> list[tuple[str, ...]]:
    return []


@pytest.fixture
def own(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, admin_calls: list[tuple[str, ...]]
) -> OwnNeo4j:
    neo4j = OwnNeo4j(tmp_path / "neo4j", made_up_runtime(tmp_path), ["helper"])
    monkeypatch.setattr(neo4j, "_admin", lambda *arguments: admin_calls.append(arguments))
    return neo4j


def conf_lines(own: OwnNeo4j) -> list[str]:
    return (own.conf_dir / "neo4j.conf").read_text(encoding="utf-8").splitlines()


def test_it_listens_on_this_computer_alone_and_reports_nothing(own: OwnNeo4j) -> None:
    settings = own.settings(7690, None, FAMILY_SIZED)

    assert settings["server.default_listen_address"] == "127.0.0.1"
    assert settings["server.bolt.listen_address"] == "127.0.0.1:7690"
    assert settings["server.http.enabled"] == "false"
    assert settings["server.https.enabled"] == "false"
    assert settings["dbms.routing.enabled"] == "false"
    for off in (
        "dbms.usage_report.enabled",
        "client.allow_telemetry",
        "server.bolt.telemetry.enabled",
        "server.fleet_discovery.enabled",
        "dbms.fleet_manager.enabled",
        "dbms.security.allow_csv_import_from_file_urls",
    ):
        assert settings[off] == "false", off
    browser = own.settings(7690, 7691, FAMILY_SIZED)
    assert browser["server.http.enabled"] == "true"
    assert browser["server.http.listen_address"] == "127.0.0.1:7691"


def test_its_settings_take_the_place_of_neo4js_own_and_keep_the_rest(
    own: OwnNeo4j, admin_calls: list[tuple[str, ...]]
) -> None:
    own.configure(7690)
    lines = conf_lines(own)

    assert [line for line in lines if line.startswith("server.default_listen_address")] == [
        "server.default_listen_address=127.0.0.1"
    ]
    assert [line for line in lines if line.startswith("dbms.usage_report.enabled")] == [
        "dbms.usage_report.enabled=false"
    ]
    assert "db.tx_log.rotation.retention_policy=2 days" in lines
    assert "#server.jvm.additional=-Dnot.this.one=1" in lines
    assert admin_calls == [("dbms", "set-initial-password", own.password())]


def test_the_password_is_set_in_neo4j_only_before_its_first_start(
    own: OwnNeo4j, admin_calls: list[tuple[str, ...]]
) -> None:
    (own.store / "data" / "databases" / "system").mkdir(parents=True)
    own.configure(7690)
    assert admin_calls == []


def test_the_server_starts_as_neo4js_launcher_would_start_it(own: OwnNeo4j) -> None:
    own.configure(7690)
    home = own.runtime.neo4j_home

    command = own.server_command()

    assert command[0] == str(own.runtime.java_program)
    folders = (home / "plugins", own.conf_dir, home / "lib")
    assert command[1:3] == ["-cp", ";".join(str(folder / "*") for folder in folders)]
    assert command[3:9] == [
        "-XX:+UseG1GC",
        "-Djdk.nio.maxCachedBufferSize=1024",
        "--sun-misc-unsafe-memory-access=allow",
        "-Dfile.encoding=UTF-8",
        "-Xms128m",
        "-Xmx384m",
    ]
    assert command[9:] == [
        "org.neo4j.server.Neo4jCommunity",
        f"--home-dir={home}",
        f"--config-dir={own.conf_dir}",
        "--console-mode",
    ]


def test_on_macos_and_linux_the_class_path_takes_colons(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    own = OwnNeo4j(tmp_path / "neo4j", made_up_runtime(tmp_path, ("linux", "x64")), ["helper"])
    monkeypatch.setattr(own, "_admin", lambda *arguments: None)
    own.configure(7690)

    classpath = own.server_command()[2]

    assert classpath.count(":") >= 2
    assert ";" not in classpath


def test_the_password_is_made_once(own: OwnNeo4j) -> None:
    first = own.password()
    assert own.password() == first
    assert len(first) >= 32
    if sys.platform != "win32":
        assert (own.root / "password").stat().st_mode & 0o777 == 0o600


def test_asked_to_stop_while_starting_it_stops_at_once(own: OwnNeo4j) -> None:
    stopping = threading.Event()
    stopping.set()
    with pytest.raises(StoppedError):
        own.wait_ready(timeout=60, stopping=stopping)


def test_only_what_comes_over_https_is_fetched(tmp_path: Path) -> None:
    with pytest.raises(FetchError, match="https"):
        fetch(Download("http://example.org/neo4j.zip", "0" * 64), tmp_path, lambda *a: None)


class FakeResponse(io.BytesIO):
    headers: ClassVar[dict[str, str]] = {}

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def serving(monkeypatch: pytest.MonkeyPatch, data: bytes) -> list[str]:
    asked: list[str] = []

    def urlopen(request: Any, timeout: float) -> FakeResponse:
        asked.append(request.full_url)
        return FakeResponse(data)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return asked


def test_a_download_that_doesnt_match_its_fingerprint_isnt_kept(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    serving(monkeypatch, b"not what was pinned")
    download = Download("https://example.org/neo4j.zip", hashlib.sha256(b"pinned").hexdigest())

    with pytest.raises(FetchError, match="fingerprint"):
        fetch(download, tmp_path, lambda *a: None)
    assert list(tmp_path.iterdir()) == []


def test_a_download_that_matches_is_kept_and_not_fetched_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked = serving(monkeypatch, b"pinned")
    download = Download("https://example.org/neo4j.zip", hashlib.sha256(b"pinned").hexdigest())

    first = fetch(download, tmp_path, lambda *a: None)
    again = fetch(download, tmp_path, lambda *a: None)

    assert first == again == tmp_path / "neo4j.zip"
    assert first.read_bytes() == b"pinned"
    assert asked == ["https://example.org/neo4j.zip"]


def zipped(tmp_path: Path, members: dict[str, bytes]) -> Path:
    path = tmp_path / "archive.zip"
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return path


def test_an_archive_unpacks_whole_into_place(tmp_path: Path) -> None:
    archive = zipped(tmp_path, {"neo4j-x/lib/a.jar": b"jar", "neo4j-x/conf/neo4j.conf": b"#"})
    target = tmp_path / "runtime" / "neo4j-community"

    unpack(archive, target)

    assert (target / "lib" / "a.jar").read_bytes() == b"jar"
    assert not (tmp_path / "runtime" / "neo4j-community.unpacking").exists()


def test_an_archive_reaching_outside_its_folder_is_refused(tmp_path: Path) -> None:
    archive = zipped(tmp_path, {"neo4j-x/lib/a.jar": b"jar", "../../outside.txt": b"no"})

    with pytest.raises(FetchError, match="outside"):
        unpack(archive, tmp_path / "runtime" / "neo4j")
    assert not list(tmp_path.rglob("outside.txt"))

    tarred = tmp_path / "archive.tar.gz"
    with tarfile.open(tarred, "w:gz") as archive_file:
        info = tarfile.TarInfo("../outside.txt")
        info.size = 2
        archive_file.addfile(info, io.BytesIO(b"no"))
    with pytest.raises(tarfile.FilterError):
        unpack(tarred, tmp_path / "runtime" / "java")
    assert not list(tmp_path.rglob("outside.txt"))


def test_an_archive_holding_more_than_one_folder_is_refused(tmp_path: Path) -> None:
    archive = zipped(tmp_path, {"one/a": b"1", "two/b": b"2"})
    with pytest.raises(FetchError, match="one folder"):
        unpack(archive, tmp_path / "runtime" / "neo4j")


def test_nothing_is_fetched_once_it_is_all_here(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = Runtime(tmp_path / "runtime", ("windows", "x64"))
    (runtime.neo4j_home / "lib").mkdir(parents=True)
    runtime.java_program.parent.mkdir(parents=True)
    runtime.java_program.write_bytes(b"java")

    def refuse(*arguments: object) -> Path:
        raise AssertionError("fetched although it was all here")

    monkeypatch.setattr(runtime_module, "fetch", refuse)
    assert runtime.ready()
    assert runtime.install(lambda *a: None) is False


def test_older_versions_are_tidied_away_after_an_update(tmp_path: Path) -> None:
    runtime = Runtime(tmp_path / "runtime", ("windows", "x64"))
    for folder in (
        runtime.neo4j_home,
        runtime.java,
        runtime.root / "neo4j-community-2026.07.0",
        runtime.root / "jdk-25.0.3+9-jre",
    ):
        folder.mkdir(parents=True)

    assert runtime.tidy() == ["jdk-25.0.3+9-jre", "neo4j-community-2026.07.0"]
    assert sorted(path.name for path in runtime.root.iterdir()) == sorted(
        [runtime.neo4j_home.name, runtime.java.name]
    )


def test_every_system_has_neo4j_and_its_java_pinned() -> None:
    for download in [*NEO4J.values(), *JAVA.values()]:
        assert download.url.startswith("https://")
        assert len(download.sha256) == 64
        assert int(download.sha256, 16) >= 0
    assert {("windows", "x64"), ("mac", "aarch64"), ("linux", "x64")} <= set(JAVA)


def test_a_mac_with_apple_silicon_is_named_as_its_java_is(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(platform, "machine", lambda: "arm64")
    assert this_system() == ("mac", "aarch64")
    assert Runtime(Path("x"), this_system()).java_home == Path("x/jdk-25.0.4+7-jre/Contents/Home")
