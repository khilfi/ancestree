"""Neo4j started, watched and stopped with the app: on this computer only, reporting nothing."""

from __future__ import annotations

import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from neo4j import GraphDatabase
from neo4j.exceptions import Neo4jError, ServiceUnavailable

from ancestree.ownneo4j.runtime import Runtime


@dataclass(frozen=True)
class Memory:
    heap_initial: str
    heap_max: str
    pagecache: str


# Enough for a family of a few thousand, with room for the app's biggest queries.
FAMILY_SIZED = Memory(heap_initial="128m", heap_max="384m", pagecache="64m")


class StoppedError(Exception):
    """Asked to stop while Neo4j was still starting."""


def _setting_name(line: str) -> str:
    text = line.strip()
    return "" if not text or text.startswith("#") else text.split("=", 1)[0].strip()


class OwnNeo4j:
    """The database in `root`: conf/ (its settings), store/ (the family) and a password."""

    def __init__(self, root: Path, runtime: Runtime, helper: Sequence[str]) -> None:
        self.root = root
        self.runtime = runtime
        # How to run a small helper that presses Ctrl+C in Neo4j's console (Windows).
        self.helper = list(helper)
        self.conf_dir = root / "conf"
        self.store = root / "store"
        self.bolt_port = 0
        self.memory = FAMILY_SIZED
        self.process: subprocess.Popen[bytes] | None = None

    @property
    def uri(self) -> str:
        return f"bolt://127.0.0.1:{self.bolt_port}"

    def password(self) -> str:
        """Made once, kept in this folder, readable by this user alone where that's possible."""
        path = self.root / "password"
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
        self.root.mkdir(parents=True, exist_ok=True)
        value = secrets.token_urlsafe(24)
        path.write_text(value, encoding="utf-8")
        if sys.platform != "win32":
            path.chmod(0o600)
        return value

    def settings(self, bolt_port: int, browser_port: int | None, memory: Memory) -> dict[str, str]:
        """Ours, in place of Neo4j's own where they differ."""
        return {
            "server.directories.data": (self.store / "data").as_posix(),
            "server.directories.logs": (self.store / "logs").as_posix(),
            "server.directories.run": (self.store / "run").as_posix(),
            "server.directories.import": (self.store / "import").as_posix(),
            # This computer only: Bolt for the app, and Neo4j Browser if asked for.
            "server.default_listen_address": "127.0.0.1",
            "server.bolt.listen_address": f"127.0.0.1:{bolt_port}",
            "server.bolt.advertised_address": f"127.0.0.1:{bolt_port}",
            "server.http.enabled": "true" if browser_port else "false",
            "server.http.listen_address": f"127.0.0.1:{browser_port or 7474}",
            "server.https.enabled": "false",
            "dbms.routing.enabled": "false",
            # Reporting nothing to Neo4j, and announcing nothing to the local network.
            "dbms.usage_report.enabled": "false",
            "client.allow_telemetry": "false",
            "server.bolt.telemetry.enabled": "false",
            "server.fleet_discovery.enabled": "false",
            "dbms.fleet_manager.enabled": "false",
            "dbms.security.allow_csv_import_from_file_urls": "false",
            "server.memory.heap.initial_size": memory.heap_initial,
            "server.memory.heap.max_size": memory.heap_max,
            "server.memory.pagecache.size": memory.pagecache,
        }

    def configure(
        self, bolt_port: int, browser_port: int | None = None, memory: Memory = FAMILY_SIZED
    ) -> None:
        """Neo4j's shipped settings with ours in their place, and the password, the first time."""
        self.bolt_port = bolt_port
        self.memory = memory
        ours = self.settings(bolt_port, browser_port, memory)
        shipped = (self.runtime.neo4j_home / "conf" / "neo4j.conf").read_text(encoding="utf-8")
        kept = [line for line in shipped.splitlines() if _setting_name(line) not in ours]
        lines = [*kept, "", "# AncesTree's own settings", *(f"{k}={v}" for k, v in ours.items())]
        self.conf_dir.mkdir(parents=True, exist_ok=True)
        (self.conf_dir / "neo4j.conf").write_text("\n".join(lines) + "\n", encoding="utf-8")
        if not (self.store / "data" / "databases" / "system").exists():
            self._admin("dbms", "set-initial-password", self.password())

    def _environment(self) -> dict[str, str]:
        environment = dict(os.environ)
        environment.update(
            JAVA_HOME=str(self.runtime.java_home),
            NEO4J_HOME=str(self.runtime.neo4j_home),
            NEO4J_CONF=str(self.conf_dir),
        )
        return environment

    def launcher(self, entry: str, *arguments: str) -> list[str]:
        """Neo4j's launcher, which starts the server itself: it only waits, so it's kept small."""
        small = ["-Xms16m", "-Xmx64m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1"]
        home = self.runtime.neo4j_home
        return [
            str(self.runtime.java_program),
            *small,
            "-cp",
            str(home / "lib" / "*"),
            f"-Dbasedir={home}",
            entry,
            *arguments,
        ]

    def server_command(self) -> list[str]:
        """The server itself, started just as Neo4j's launcher starts it, without the launcher.

        The launcher adds to the settings' `server.jvm.additional` flags only the heap, UTF-8
        and, on Java 24 and later, leave to use sun.misc.Unsafe. A test checks this against
        the launcher's own command for the pinned version.
        """
        home = self.runtime.neo4j_home
        separator = ";" if self.runtime.system[0] == "windows" else ":"
        classpath = separator.join(
            str(folder / "*") for folder in (home / "plugins", self.conf_dir, home / "lib")
        )
        conf = (self.conf_dir / "neo4j.conf").read_text(encoding="utf-8").splitlines()
        additional = [
            line.split("=", 1)[1].strip()
            for line in conf
            if _setting_name(line) == "server.jvm.additional"
        ]
        return [
            str(self.runtime.java_program),
            "-cp",
            classpath,
            *additional,
            "--sun-misc-unsafe-memory-access=allow",
            "-Dfile.encoding=UTF-8",
            f"-Xms{self.memory.heap_initial}",
            f"-Xmx{self.memory.heap_max}",
            "org.neo4j.server.Neo4jCommunity",
            f"--home-dir={home}",
            f"--config-dir={self.conf_dir}",
            "--console-mode",
        ]

    def _admin(self, *arguments: str) -> None:
        subprocess.run(  # noqa: S603 - Neo4j's own tool, from the runtime unpacked here
            self.launcher("org.neo4j.server.startup.Neo4jAdminCommand", *arguments),
            env=self._environment(),
            cwd=self.runtime.neo4j_home,
            check=True,
            capture_output=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

    def start(self) -> None:
        logs = self.store / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        command = self.server_command()
        with (logs / "console.log").open("ab") as console:
            if sys.platform == "win32":
                # A console of its own, hidden, so Ctrl+C can reach Neo4j alone (see stop). A
                # process started to ignore Ctrl+C passes that on, so clear it for Neo4j first.
                import ctypes

                ctypes.WinDLL("kernel32").SetConsoleCtrlHandler(None, False)
                hidden = subprocess.STARTUPINFO()
                hidden.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                hidden.wShowWindow = 0  # SW_HIDE
                self.process = subprocess.Popen(  # noqa: S603 - Neo4j, from the runtime here
                    command,
                    env=self._environment(),
                    cwd=self.runtime.neo4j_home,
                    stdin=subprocess.DEVNULL,
                    stdout=console,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NEW_CONSOLE,
                    startupinfo=hidden,
                )
            else:
                self.process = subprocess.Popen(  # noqa: S603 - Neo4j, from the runtime here
                    command,
                    env=self._environment(),
                    cwd=self.runtime.neo4j_home,
                    stdin=subprocess.DEVNULL,
                    stdout=console,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,  # its own process group, to stop it whole
                )

    def wait_ready(self, timeout: float = 180.0, stopping: threading.Event | None = None) -> float:
        """Seconds until the family's database answers; StoppedError if asked to stop first."""
        started = time.monotonic()
        password = self.password()
        while True:
            if stopping is not None and stopping.is_set():
                raise StoppedError
            if self.process is not None and self.process.poll() is not None:
                raise RuntimeError(
                    f"Neo4j stopped while starting (code {self.process.returncode}): "
                    f"see {self.store / 'logs'}"
                )
            try:
                # A plain session: execute_query would retry, and log each try.
                with (
                    GraphDatabase.driver(self.uri, auth=("neo4j", password)) as driver,
                    driver.session(database="neo4j") as session,
                ):
                    session.run("RETURN 1").consume()
                return time.monotonic() - started
            except ServiceUnavailable, Neo4jError, OSError:
                if time.monotonic() - started > timeout:
                    message = f"Neo4j didn't answer within {timeout:.0f} seconds"
                    raise TimeoutError(message) from None
                time.sleep(0.25)

    def stop(self, timeout: float = 30.0) -> str:
        """Ask Neo4j to stop as if Ctrl+C were pressed; kill it only if it doesn't."""
        process = self.process
        if process is None or process.poll() is not None:
            return "already stopped"
        if sys.platform == "win32":
            subprocess.run(  # noqa: S603 - the app's own Ctrl+C helper
                [*self.helper, str(process.pid)],
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )
        else:
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout)
            return "stopped cleanly"
        except subprocess.TimeoutExpired:
            if sys.platform == "win32":
                system = Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32"
                subprocess.run(  # noqa: S603 - Windows' own taskkill, by its full path
                    [str(system / "taskkill.exe"), "/PID", str(process.pid), "/T", "/F"],
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    capture_output=True,
                    check=False,
                )
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            return "killed"


def send_ctrl_c(pid: int) -> None:
    """Windows: press Ctrl+C in the console of process `pid` (run as a helper with no console)."""
    import ctypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.FreeConsole()
    if not kernel32.AttachConsole(pid):
        raise SystemExit(f"Couldn't reach the console of process {pid}")
    kernel32.SetConsoleCtrlHandler(None, True)  # the helper itself ignores it
    kernel32.GenerateConsoleCtrlEvent(0, 0)  # CTRL_C_EVENT, to everything on that console
    time.sleep(0.5)
    kernel32.FreeConsole()


if __name__ == "__main__":  # the helper: python -m ancestree.ownneo4j.server <pid>
    send_ctrl_c(int(sys.argv[1]))
