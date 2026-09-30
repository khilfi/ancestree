"""The app's own Neo4j, started for real, when ANCESTREE_NEO4J_RUNTIME names a folder
with Neo4j and Java fetched (skipped otherwise).

The app starts Neo4j's server without its launcher: these check that it starts it just as
the launcher would, for the pinned version, and that it listens and reports as it should.
"""

from __future__ import annotations

import os
import re
import shlex
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
from neo4j import GraphDatabase

from ancestree.ownneo4j.runtime import Runtime
from ancestree.ownneo4j.server import OwnNeo4j

pytestmark = pytest.mark.integration

HELPER = [sys.executable, "-m", "ancestree.ownneo4j.server"]


@pytest.fixture
def runtime() -> Runtime:
    folder = os.environ.get("ANCESTREE_NEO4J_RUNTIME", "")
    runtime = Runtime(Path(folder))
    if not folder or not runtime.ready():
        pytest.skip("ANCESTREE_NEO4J_RUNTIME must name a folder with Neo4j and Java fetched")
    return runtime


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


POWERSHELL = (
    Path(os.environ.get("SYSTEMROOT", r"C:\Windows"))
    / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
)  # fmt: skip


def powershell(command: str) -> str:
    done = subprocess.run(  # noqa: S603 - Windows' own PowerShell, by its full path
        [str(POWERSHELL), "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        check=True,
    )
    return done.stdout.strip()


def children(pid: int) -> list[int]:
    """The Java processes that `pid` started."""
    if sys.platform == "win32":
        query = f"Get-CimInstance Win32_Process -Filter 'ParentProcessId={pid}'"
        found = powershell(f"({query} | Where-Object Name -eq 'java.exe').ProcessId")
        return [int(child) for child in found.split()]
    kids = []
    for stat in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = stat.read_text().rsplit(")", 1)[1].split()
        except OSError:
            continue
        if int(fields[1]) == pid:
            kids.append(int(stat.parent.name))
    return kids


def command_line(pid: int) -> list[str]:
    if sys.platform == "win32":
        line = powershell(f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine")
        return [part.strip('"') for part in shlex.split(line, posix=False)]
    return Path(f"/proc/{pid}/cmdline").read_bytes().decode().split("\0")[:-1]


def heap_bytes(flag: str) -> int:
    """-Xms128m and -Xms131072k are the same heap."""
    match = re.fullmatch(r"-xm[sx](\d+)([kmg])", flag.lower())
    assert match, flag
    return int(match[1]) * {"k": 1 << 10, "m": 1 << 20, "g": 1 << 30}[match[2]]


def test_the_server_starts_as_neo4js_launcher_would_start_it(
    runtime: Runtime, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if sys.platform == "darwin":
        pytest.skip("reads processes' command lines on Windows and Linux")
    own = OwnNeo4j(tmp_path / "neo4j", runtime, HELPER)
    own.configure(free_port())
    ours = own.server_command()
    launcher = own.launcher("org.neo4j.server.startup.Neo4jCommand", "console")
    monkeypatch.setattr(own, "server_command", lambda: launcher)  # the launcher, this once
    own.start()
    assert own.process is not None
    try:
        deadline = time.monotonic() + 60
        while not (servers := children(own.process.pid)) and time.monotonic() < deadline:
            time.sleep(0.5)
        assert servers, "the launcher started no server"
        theirs = command_line(servers[0])
    finally:
        assert own.stop() == "stopped cleanly"

    heap = ("-Xms", "-Xmx")
    assert [p for p in theirs if not p.startswith(heap)] == [
        p for p in ours if not p.startswith(heap)
    ]
    assert sorted(heap_bytes(p) for p in theirs if p.startswith(heap)) == sorted(
        heap_bytes(p) for p in ours if p.startswith(heap)
    )


def test_it_listens_on_this_computer_alone_reports_nothing_and_stops_cleanly(
    runtime: Runtime, tmp_path: Path
) -> None:
    own = OwnNeo4j(tmp_path / "neo4j", runtime, HELPER)
    own.configure(free_port())
    own.start()
    try:
        own.wait_ready()
        names = [
            "server.default_listen_address",
            "server.http.enabled",
            "dbms.routing.enabled",
            "dbms.usage_report.enabled",
            "client.allow_telemetry",
            "server.fleet_discovery.enabled",
            "dbms.fleet_manager.enabled",
        ]
        with GraphDatabase.driver(own.uri, auth=("neo4j", own.password())) as driver:
            records, _, _ = driver.execute_query(
                "SHOW SETTINGS YIELD name, value WHERE name IN $names RETURN name, value",
                names=names,
            )
        settings = {record["name"]: record["value"] for record in records}
        assert settings.pop("server.default_listen_address") == "127.0.0.1"
        assert settings == dict.fromkeys(names[1:], "false")
    finally:
        assert own.stop() == "stopped cleanly"
