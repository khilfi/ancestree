/**
 * The engine for the journeys: AncesTree's own, run from the code on a folder of its own,
 * with its own Neo4j, as the desktop app's shell runs it. Like the shell, it starts the engine
 * again when the app opens another family, on the same port, so the pages find it there.
 */

import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const BACKEND = resolve(import.meta.dirname, "..", "..", "backend");
const READY_IN = 180_000; // ms: Neo4j's first start on a slow machine, and the example family
const STOP_IN = 60_000; // ms: Neo4j closes in about 10 seconds
const WINDOWS = process.platform === "win32";

/** A free port on this computer, for the engine to keep across its restarts. */
export function freePort(): Promise<number> {
  return new Promise((done, failed) => {
    const probe = createServer();
    probe.on("error", failed);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address ? done(address.port) : failed(address),
      );
    });
  });
}

/**
 * What the engine is given: its folders, and the address lookup pointed at nothing, so nothing
 * of the family leaves the computer. Away from CI, the Neo4j and Java already fetched for the
 * tests, and never a download of its own; in CI, on GitHub's machines, it may fetch them.
 */
export function engineSettings(run: string, environment = process.env): NodeJS.ProcessEnv {
  const runtime = environment.ANCESTREE_NEO4J_RUNTIME;
  if (!environment.CI) {
    if (!runtime) {
      throw new Error(
        "Set ANCESTREE_NEO4J_RUNTIME to the Neo4j fetched for the tests, as check.ps1 is run " +
          "(C:\\dev\\toolchains\\ancestree-neo4j): without it, the engine would download Neo4j " +
          "and Java, 330 MB, for this run alone.",
      );
    }
    const inside = existsSync(runtime) ? readdirSync(runtime) : [];
    if (!inside.some((name) => name.startsWith("neo4j-community-"))) {
      throw new Error(
        `ANCESTREE_NEO4J_RUNTIME (${runtime}) holds no Neo4j: the engine would download one ` +
          "into it. Fetch it once, from backend/: uv run ancestree fetch-neo4j <folder>",
      );
    }
  }
  // uv, where its installer puts it, as check.ps1 finds it. Windows calls the variable Path.
  const path = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  return {
    ...environment,
    [path]: [join(homedir(), ".local", "bin"), environment[path] ?? ""].join(delimiter),
    ANCESTREE_DOWNLOADS: join(run, "Downloads"),
    PHOTON_URL: "http://127.0.0.1:9/api/",
    PYTHONUNBUFFERED: "1",
  };
}

type Stage = { stage?: string; [key: string]: unknown };

export class Engine {
  readonly url: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private exited: Promise<void> = Promise.resolve();
  private restarting: Promise<void> | null = null;
  private problem: string | null = null;
  private readonly log: string;

  constructor(
    readonly run: string,
    readonly port: number,
    private readonly environment: NodeJS.ProcessEnv,
  ) {
    this.url = `http://127.0.0.1:${port}`;
    this.log = join(run, "engine.log");
    mkdirSync(join(run, "Downloads"), { recursive: true });
  }

  /** Started, and answering; stopped at once if it starts fetching where it mustn't. */
  async start(): Promise<void> {
    const child = spawn(
      "uv",
      [
        "run",
        "--no-sync", // the packages as they are: nothing fetched
        "python",
        "../desktop/engine/engine.py",
        "--data",
        join(this.run, "engine"),
        "--managed",
        "--port",
        String(this.port),
      ],
      // Its own process group away from Windows, so the whole of it can be ended at once.
      { cwd: BACKEND, env: this.environment, windowsHide: true, detached: !WINDOWS },
    );
    this.child = child;
    this.problem = null;
    this.exited = new Promise((done) => child.once("exit", () => done()));
    child.stderr.on("data", (chunk: Buffer) => appendFileSync(this.log, chunk));
    let ready: () => void = () => {};
    let failed: (error: Error) => void = () => {};
    const answered = new Promise<void>((done, fail) => {
      ready = done;
      failed = fail;
    });
    let rest = "";
    child.stdout.on("data", (chunk: Buffer) => {
      appendFileSync(this.log, chunk);
      rest += chunk.toString("utf8");
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const event = parse(line);
        if (event.stage === "ready") ready();
        else if (event.stage === "restart") void this.restart();
        else if (
          (event.stage === "download" || event.stage === "waiting-for-internet") &&
          !this.environment.CI
        ) {
          // It doesn't hear "stop" while it fetches.
          this.problem = `The engine began to fetch from the internet (${event.stage}): ended`;
          end(child);
          failed(new Error(this.problem));
        }
      }
    });
    child.once("exit", (code) =>
      failed(new Error(this.problem ?? `The engine ended (${code}): see ${this.log}`)),
    );
    const timer = setTimeout(() => {
      end(child);
      failed(new Error(`The engine wasn't ready in ${READY_IN / 1000} s: see ${this.log}`));
    }, READY_IN);
    try {
      await answered;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stopped as the shell stops it: "stop" on its input, then Neo4j closes and it ends. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    if (child.exitCode === null) {
      child.stdin.end("stop\n");
      const timer = setTimeout(() => end(child), STOP_IN);
      await this.exited;
      clearTimeout(timer);
    }
  }

  /** Another family opened in the app: the engine starts again on it, as the shell does. */
  private restart(): Promise<void> {
    this.restarting ??= (async () => {
      appendFileSync(this.log, "== starting again, on the family opened\n");
      await this.stop();
      await this.start();
    })()
      .catch((error: Error) => appendFileSync(this.log, `== couldn't start again: ${error}\n`))
      .finally(() => {
        this.restarting = null;
      });
    return this.restarting;
  }
}

/** The engine ended at once, with Neo4j and everything it started. */
function end(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (WINDOWS) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function parse(line: string): Stage {
  try {
    return JSON.parse(line) as Stage;
  } catch {
    return {};
  }
}
