/**
 * Before the guide's pictures: a run folder, as the journeys' are, with the world's map pack and
 * places linked into its engine's maps folder from ANCESTREE_GUIDE_MAPS; the journeys' engine
 * started on it; the example family opened, as Look around first opens it; a made-up person put
 * in the Trash, for its picture; and the family backed up and restored from that backup, so Undo
 * has nothing to take back, and the walk goes back to it after a picture that changes anything.
 */

import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Engine, engineSettings, freePort } from "../engine";
import { runName, tidyRuns } from "../runs";

const FRONTEND = resolve(import.meta.dirname, "..", "..");
const PAGES = join(FRONTEND, "dist", "index.html");
const PACKS = resolve(FRONTEND, "..", "backend", "src", "ancestree", "maps", "packs.json");
const TRASHED = "Hamid bin Osman"; // made up, of the example family's names
const BACK_IN = 180_000; // ms: the engine starting again on the example family

/** The world's pack and places, as the app fetches them the first time its map opens: their
 *  names for the build and the places' copy the app pins, and the pack's size. */
function worldFiles(): { pack: string; places: string; size: number } {
  const pins = JSON.parse(readFileSync(PACKS, "utf8")) as {
    build: string;
    places: { snapshot: string };
    packs: { key: string; size: number }[];
  };
  const world = pins.packs.find((pack) => pack.key === "world");
  if (!world) throw new Error(`No world pack in ${PACKS}`);
  return {
    pack: `world-${pins.build}.pmtiles`,
    places: `places-world-${pins.places.snapshot}.tsv.gz`,
    size: world.size,
  };
}

/** The world's pack and places, linked (copied where a link can't be made) from the folder
 *  ANCESTREE_GUIDE_MAPS names. Never fetched: without them, the walk stops and says why. */
function linkMaps(into: string): void {
  const { pack, places, size } = worldFiles();
  const from = process.env.ANCESTREE_GUIDE_MAPS;
  const missing = [pack, places].filter((name) => !from || !existsSync(join(from, name)));
  if (!from || missing.length) {
    throw new Error(
      `The guide's pictures of the map need the world's map pack and places, ${pack} and ` +
        `${places}, as the app fetches them the first time its map opens. Set ` +
        "ANCESTREE_GUIDE_MAPS to a folder that holds them, such as a practice engine's maps " +
        `folder once its map has been opened.${from ? ` Not in ${from}: ${missing.join(", ")}.` : ""}` +
        " The walk never fetches them.",
    );
  }
  if (statSync(join(from, pack)).size !== size) {
    throw new Error(`${join(from, pack)} isn't the pack the app pins: its size differs`);
  }
  mkdirSync(into, { recursive: true });
  for (const name of [pack, places]) {
    try {
      linkSync(join(from, name), join(into, name));
    } catch {
      copyFileSync(join(from, name), join(into, name));
    }
  }
}

async function call(url: string, method = "GET", body?: unknown): Promise<unknown> {
  const answer = await fetch(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!answer.ok) throw new Error(`${method} ${url}: ${answer.status} ${await answer.text()}`);
  return answer.json();
}

/** The example family added and opened, as Look around first does: the engine starts again on
 *  it, and fills it as it first opens. */
async function openExample(url: string): Promise<void> {
  const added = (await call(`${url}/api/desktop/families/example`, "POST")) as { added: string };
  await call(`${url}/api/desktop/families/${added.added}/open`, "POST");
  const until = Date.now() + BACK_IN;
  while (Date.now() < until) {
    try {
      const graph = (await call(`${url}/api/graph`)) as { people: unknown[] };
      if (graph.people.length > 0) return; // the family before it had no one
    } catch {
      // Starting again: nothing answers for a few seconds.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("The engine never came back with the example family");
}

/** Someone in the Trash, then the family backed up and restored, its history empty: that
 *  backup's name, to go back to. */
async function ready(url: string): Promise<string> {
  const added = (await call(`${url}/api/persons`, "POST", {
    full_name: TRASHED,
    gender: "male",
  })) as { person: { id: string } };
  await call(`${url}/api/persons/${added.person.id}`, "DELETE");
  const made = (await call(`${url}/api/exports`, "POST", { format: "archive" })) as {
    name: string;
  };
  await call(`${url}/api/backups/${made.name}/restore`, "POST");
  return made.name;
}

export default async function setup(): Promise<() => Promise<void>> {
  if (!existsSync(PAGES)) {
    throw new Error("The app's pages aren't built: in frontend/, run pnpm exec vite build");
  }
  // A run folder beside the journeys' own, the newest 3 of them kept.
  const parent = process.env.ANCESTREE_JOURNEYS_FOLDER || join(tmpdir(), "ancestree-journeys");
  const name = runName();
  const run = join(parent, name);
  mkdirSync(run, { recursive: true });
  tidyRuns(parent, name);
  linkMaps(join(run, "engine", "maps"));
  const engine = new Engine(run, await freePort(), engineSettings(run));
  console.log(`The guide's engine: ${engine.url}, its folder ${run}`);
  await engine.start();
  await openExample(engine.url);
  process.env.GUIDE_URL = engine.url;
  process.env.GUIDE_RUN = run;
  process.env.GUIDE_FRESH = await ready(engine.url);
  // The pages' clock for every picture: the next whole minute after the Trash's person went in,
  // so the Trash says 30 days left, not 31.
  process.env.GUIDE_CLOCK = String(Math.ceil(Date.now() / 60_000) * 60_000);
  return () => engine.stop();
}
