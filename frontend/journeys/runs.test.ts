import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tidyRuns } from "./runs";

// The test's own folders, deleted after each test.
const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function madeUp(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  made.push(folder);
  return folder;
}

/** A made-up journeys' folder, holding run folders of these names, each with a file inside. */
function parentWith(...runs: string[]): string {
  const parent = madeUp("journeys-runs-test-");
  for (const run of runs) {
    mkdirSync(join(parent, run, "engine"), { recursive: true });
    writeFileSync(join(parent, run, "engine.log"), "a run's log");
  }
  return parent;
}

describe("the journeys' run folders, the newest 3 kept", () => {
  it("deletes the older run folders, and keeps the newest 3 with the one starting", () => {
    const parent = parentWith(
      "run-2026-11-17T09-00-00",
      "run-2026-11-18T09-00-00",
      "run-2026-11-19T09-00-00",
      "run-2026-11-19T10-00-00",
      "run-2026-11-19T11-00-00",
    );
    expect(tidyRuns(parent, "run-2026-11-19T11-00-00")).toEqual([
      "run-2026-11-17T09-00-00",
      "run-2026-11-18T09-00-00",
    ]);
    expect(readdirSync(parent).sort()).toEqual([
      "run-2026-11-19T09-00-00",
      "run-2026-11-19T10-00-00",
      "run-2026-11-19T11-00-00",
    ]);
  });

  it("deletes nothing while there are 3 or fewer", () => {
    const parent = parentWith("run-2026-11-18T09-00-00", "run-2026-11-19T09-00-00");
    expect(tidyRuns(parent, "run-2026-11-19T09-00-00")).toEqual([]);
    expect(readdirSync(parent)).toHaveLength(2);
  });

  it("never deletes anything whose name isn't a run's, nor a file, nor a link", () => {
    const parent = parentWith(
      "run-2026-11-01T09-00-00",
      "run-2026-11-02T09-00-00",
      "run-2026-11-03T09-00-00",
      "run-2026-11-19T09-00-00",
      "run-notes",
      "Run-2026-10-05T09-00-00",
      "run-2026-11-01T09-00-00-copy",
      "my-run-2026-11-01T09-00-00",
      "family",
    );
    writeFileSync(join(parent, "run-2026-10-01T09-00-00"), "a file, not a run's folder");
    // A link named as a run, to somewhere else: neither it nor what it leads to goes.
    const elsewhere = madeUp("journeys-runs-elsewhere-");
    writeFileSync(join(elsewhere, "keep.txt"), "not the journeys'");
    symlinkSync(elsewhere, join(parent, "run-2026-10-02T09-00-00"), "junction");

    expect(tidyRuns(parent, "run-2026-11-19T09-00-00")).toEqual(["run-2026-11-01T09-00-00"]);
    for (const kept of [
      "run-notes",
      "Run-2026-10-05T09-00-00",
      "run-2026-11-01T09-00-00-copy",
      "my-run-2026-11-01T09-00-00",
      "family",
      "run-2026-10-01T09-00-00",
      "run-2026-10-02T09-00-00",
    ]) {
      expect(existsSync(join(parent, kept)), kept).toBe(true);
    }
    expect(existsSync(join(elsewhere, "keep.txt"))).toBe(true);
  });

  it("never deletes the run starting, whatever its name sorts as", () => {
    const parent = parentWith(
      "run-2026-11-01T09-00-00",
      "run-2026-11-17T09-00-00",
      "run-2026-11-18T09-00-00",
      "run-2026-11-19T09-00-00",
    );
    // A clock set back: the run starting has the oldest name.
    expect(tidyRuns(parent, "run-2026-11-01T09-00-00")).toEqual(["run-2026-11-17T09-00-00"]);
    expect(existsSync(join(parent, "run-2026-11-01T09-00-00", "engine.log"))).toBe(true);
  });

  it("leaves a parent folder that isn't there as it is", () => {
    expect(tidyRuns(join(tmpdir(), "journeys-runs-test-not-there"), "run-x")).toEqual([]);
  });
});
