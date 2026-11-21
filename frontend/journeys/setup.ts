/**
 * Before the journeys: a folder for this run alone, and the engine on it, as on a new
 * install. The first journey opens the example family from there, as a newcomer would; the rest
 * start from that family, fresh. Each run leaves its folder for looking into afterwards: its
 * engine.log, the families' own folders, and what the journeys saved. The newest 3 are kept.
 */

import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Engine, engineSettings, freePort } from "./engine";
import { runName, tidyRuns } from "./runs";

const PAGES = resolve(import.meta.dirname, "..", "dist", "index.html");

/** This run's folder, in ANCESTREE_JOURNEYS_FOLDER or the system's temporary one; the older
 *  runs' there beyond the newest 3 deleted, as you answered on 19 Nov 2026. */
function runFolder(): string {
  const parent = process.env.ANCESTREE_JOURNEYS_FOLDER || join(tmpdir(), "ancestree-journeys");
  const name = runName();
  const run = join(parent, name);
  mkdirSync(run, { recursive: true });
  const deleted = tidyRuns(parent, name);
  if (deleted.length) console.log(`Older runs' folders deleted: ${deleted.join(", ")}`);
  return run;
}

export default async function setup(): Promise<() => Promise<void>> {
  if (!existsSync(PAGES)) {
    throw new Error("The app's pages aren't built: in frontend/, run pnpm exec vite build");
  }
  const run = runFolder();
  const engine = new Engine(run, await freePort(), engineSettings(run));
  console.log(`The journeys' engine: ${engine.url}, its folder ${run}`);
  await engine.start();
  // For the tests, which run apart from here.
  process.env.JOURNEYS_URL = engine.url;
  process.env.JOURNEYS_RUN = run;
  return () => engine.stop();
}
