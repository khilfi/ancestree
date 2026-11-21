/**
 * Each run's folder, and the older ones tidied away as a run starts: the newest 3 are
 * kept, the one starting among them. Only folders the journeys made go, by their name alone,
 * `run-<time>`: never a file, a link, or a folder of any other name.
 */

import { type Dirent, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const KEEP = 3;
const RUN = /^run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

/** A run's folder name, for when it starts: `run-2026-11-19T10-00-00`, in UTC. */
export function runName(now = new Date()): string {
  return `run-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

/** The run folders in `parent` beyond the newest 3, deleted; their names. The run `starting`
 *  is kept whatever its name. One that can't be deleted, its files in use, is left. */
export function tidyRuns(parent: string, starting: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return []; // no runs yet
  }
  // A link's own kind, never what it leads to: a link isn't a folder the journeys made.
  const runs = entries
    .filter((entry) => entry.isDirectory() && RUN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const kept = new Set([starting, ...runs.filter((name) => name !== starting).slice(0, KEEP - 1)]);
  const deleted: string[] = [];
  for (const name of runs.filter((each) => !kept.has(each)).reverse()) {
    try {
      rmSync(join(parent, name), { recursive: true, maxRetries: 3 });
      deleted.push(name);
    } catch (error) {
      console.log(`An older run's folder couldn't be deleted, and is left: ${name} (${error})`);
    }
  }
  return deleted;
}
