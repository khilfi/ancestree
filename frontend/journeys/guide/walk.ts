/**
 * What every picture of the guide has: the journeys' page set-up (nothing outside this computer,
 * no download, a clock that stands still); the family folder, the families on this computer, the
 * updates and the folders answered with made-up answers, as the family folder's pictures have
 * always been staged; and each picture taken once the page has settled, then made smaller, to
 * 256 colours, into public/guide (or GUIDE_OUT).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { engineSettings } from "../engine";
import { refused } from "../rules";

const FRONTEND = resolve(import.meta.dirname, "..", "..");
const REPO = resolve(FRONTEND, "..");
export const OUT = process.env.GUIDE_OUT || join(REPO, "public", "guide");

/** The pages' clock, the same for every picture of a run (setup.ts): the engine dates what it
 *  makes, backups and the Trash, by the real one, and the two agree. */
export const TODAY = new Date(
  Number(process.env.GUIDE_CLOCK) || Math.ceil(Date.now() / 60_000) * 60_000,
);
export const ago = (minutes: number) => new Date(TODAY.getTime() - minutes * 60_000).toISOString();

/** The app's version, and the next, for About and the update bar. */
const VERSION = (
  JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
    version: string;
  }
).version;
const NEXT = VERSION.replace(/\d+$/, (patch) => String(Number(patch) + 1));

/** A made-up user's folders, never this computer's. */
const ROOT = "C:\\Users\\you\\AppData\\Local\\app.ancestree.desktop";

// ---------------------------------------------------------------------------------------------
// The made-up answers

export const KEEPER = "keeper@example.com";
export const RELATIVE = "relative@example.com";
export const OTHER = "other@example.com";
export const CODE = "K7QM-2TXA";
export const PROJECT = "keluarga-contoh";
export const RECOVERY = "HQ7M RXTA 2LNC WD4K PZ8E 6VGB 3F";

/** A made-up invitation, as long as a real one, in its letters: the same every time. */
export const INVITATION = (() => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let seed = 20261120;
  const next = () => {
    // Mulberry32: a small generator of steady, even-looking numbers.
    seed = (seed + 0x6d2b79f5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
  let text = "";
  for (let index = 0; index < 560; index += 1) text += letters[next() % 64];
  return `ATI1-${text}-c5d86a`;
})();

/** The invitation as the keeper's Copy gives it (FamilyFolderSection's invitationMessage). */
export const INVITATION_MESSAGE = [
  "You're invited to our family's AncesTree.",
  "1. Install AncesTree: https://github.com/khilfi/ancestree/releases/latest",
  "   The guide shows each step: https://github.com/khilfi/ancestree/blob/main/GUIDE.md",
  "2. In AncesTree, open Settings → You and your family → Family folder, and paste this invitation:",
  INVITATION,
  "3. Sign in to Google with the account I invited, and ask to join. Then read me the code it shows.",
].join("\n");

type Role = "keeper" | "member" | "";

/** The families on this computer: Keluarga Contoh, not marked as the example family, so its
 *  bar shows only where a picture is of it; another family, kept by a relative; and, for
 *  Families' picture, one in the Trash. */
export function families(
  role: Role = "keeper",
  more: { others?: boolean; removed?: boolean; name?: string } = { others: true },
) {
  const list = [
    {
      id: "c0e1a2b3c4d5e6f7",
      name: more.name ?? "Keluarga Contoh",
      open: true,
      role,
      in_step: role ? ago(2) : null,
      added: "2026-10-03T10:00:00+08:00",
      example: false,
    },
  ];
  if (more.others) {
    list.push({
      id: "b1a2c3d4e5f60718",
      name: "Keluarga Ibu",
      open: false,
      role: "member",
      in_step: ago(180),
      added: "2026-10-05T10:00:00+08:00",
      example: false,
    });
  }
  return {
    open: "c0e1a2b3c4d5e6f7",
    families: list,
    removed: more.removed
      ? [{ id: "a9b8c7d6e5f40312", name: "Keluarga Latihan", removed: ago(60 * 24 * 3) }]
      : [],
  };
}

const MEMBERS = {
  home: {
    device: "d-home",
    name: "Home PC",
    role: "keeper",
    email: KEEPER,
    you: true,
    own: false,
    helps: false,
  },
  makLong: {
    device: "d-mak-long",
    name: "Mak Long's laptop",
    role: "contributor",
    email: RELATIVE,
    you: false,
    own: false,
    helps: false,
  },
  pakNgah: {
    device: "d-pak-ngah",
    name: "Pak Ngah's PC",
    role: "viewer",
    email: OTHER,
    you: false,
    own: false,
    helps: false,
  },
};

const BLANK = {
  available: false,
  email: null,
  signing_in: false,
  setup: null,
  family: "",
  role: null,
  code: null,
  members: [],
  asking: [],
  last_sync: null,
  received: null,
  problem: "",
  recovery_code: null,
  pending: 0,
  sent_at: null,
  answers: [],
  changes: [],
  broken: false,
  replaced: false,
  may_leave: false,
  project: "",
  project_invited: false,
  invited: false,
  syncing: false,
  tried: null,
  through: false,
  trouble: "",
  lost: false,
  moving: false,
  old_folder_left: false,
  published: null,
  role_changed: null,
  offer_made: null,
  offer_here: null,
  handed: null,
  helping: null,
  helped: [],
};

export type Status = Record<string, unknown>;

/** Not in a family folder yet: no project chosen, not signed in. */
export const noFolder = (more: Status = {}): Status => ({ ...BLANK, ...more });

/** The keeper's computer, Home PC, in step two minutes ago, with two relatives' computers. */
export const keeper = (more: Status = {}): Status => ({
  ...BLANK,
  available: true,
  email: KEEPER,
  setup: "keeper",
  family: "Keluarga Contoh",
  role: "keeper",
  members: [MEMBERS.home, MEMBERS.makLong, MEMBERS.pakNgah],
  last_sync: ago(2),
  tried: ago(2),
  through: true,
  project: PROJECT,
  published: ago(2),
  ...more,
});

/** Mak Long's laptop, let in as a Contributor. */
export const relative = (more: Status = {}): Status => ({
  ...BLANK,
  available: true,
  email: RELATIVE,
  setup: "member",
  family: "Keluarga Contoh",
  role: "contributor",
  members: [
    { ...MEMBERS.home, you: false },
    { ...MEMBERS.makLong, you: true },
  ],
  last_sync: ago(2),
  received: ago(2),
  tried: ago(2),
  through: true,
  project: PROJECT,
  project_invited: true,
  may_leave: true,
  ...more,
});

export type Staging = {
  /** The families on this computer; null for the engine's own answer, the example family's. */
  families?: ReturnType<typeof families> | null;
  /** The family folder's state; the keeper's, in step, if none is given. */
  folder?: Status;
  /** A new version ready, for the update bar. */
  update?: boolean;
  /** An empty family, as on a new install. */
  empty?: boolean;
  /** A relative's changes, for the keeper to review. */
  review?: unknown;
};

/** The made-up answers given to the app's own requests, in place of the engine's. */
export async function stage(page: Page, staging: Staging = {}): Promise<void> {
  const listed = staging.families === undefined ? families() : staging.families;
  if (listed) {
    await page.route(/\/api\/desktop\/families$/, (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: listed }) : route.fallback(),
    );
  }
  const folder = staging.folder ?? keeper();
  // Nothing of the family folder ever reaches the engine, let alone Google.
  await page.route(/\/api\/family-folder(\/|$|\?)/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/family-folder/invitation") {
      return route.fulfill({ json: { invitation: INVITATION, project: PROJECT } });
    }
    if (path === "/api/family-folder/shared") return route.fulfill({ json: [] });
    if (path.endsWith("/review")) return route.fulfill({ json: staging.review ?? {} });
    return route.fulfill({ json: folder });
  });
  await page.route(/\/api\/desktop\/update$/, (route) =>
    route.fulfill({
      json: {
        current: VERSION,
        available: staging.update
          ? { version: NEXT, notes: `Small things put right since ${VERSION}.` }
          : null,
        checking: false,
        checked_at: ago(1),
        problem: null,
      },
    }),
  );
  // The folders under a made-up user's, never this computer's.
  await page.route(/\/api\/health$/, async (route) => {
    const answer = await route.fetch();
    const health = (await answer.json()) as Record<string, unknown>;
    await route.fulfill({
      response: answer,
      json: { ...health, data_folder: `${ROOT}\\family`, backup_folder: `${ROOT}\\backups` },
    });
  });
  await page.route(/\/api\/backups$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const answer = await route.fetch();
    const list = (await answer.json()) as { folder: string; backups: { folder: string }[] };
    await route.fulfill({
      response: answer,
      json: {
        ...list,
        folder: `${ROOT}\\backups`,
        family_name: "Keluarga Contoh",
        backups: list.backups.map((backup) => ({
          ...backup,
          folder: backup.folder === list.folder ? `${ROOT}\\backups` : backup.folder,
        })),
      },
    });
  });
  if (staging.empty) {
    await page.route(/\/api\/family\/me$/, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { person: null } })
        : route.fallback(),
    );
    await page.route(/\/api\/graph(\?|$)/, async (route) => {
      const answer = await route.fetch();
      const graph = (await answer.json()) as Record<string, unknown>;
      const emptied = Object.fromEntries(
        Object.entries(graph).map(([key, value]) => [key, Array.isArray(value) ? [] : value]),
      );
      await route.fulfill({ response: answer, json: emptied });
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Settling, and taking the picture

/** Requests on their way, so a picture waits until none is. */
function watchRequests(page: Page): () => Promise<void> {
  let open = 0;
  page.on("request", () => {
    open += 1;
  });
  const done = () => {
    open = Math.max(0, open - 1);
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return async () => {
    for (let quiet = 0; quiet < 5; ) {
      quiet = open === 0 ? quiet + 1 : 0;
      await page.waitForTimeout(100);
    }
  };
}

const quietOf = new WeakMap<Page, () => Promise<void>>();

/** The tree's view still; nothing to wait for where there's no tree. */
async function viewStill(page: Page): Promise<void> {
  let before: string | null | undefined;
  for (let same = 0; same < 3; ) {
    const now = await page.evaluate(
      () => document.querySelector(".react-flow__viewport")?.getAttribute("style") ?? null,
    );
    same = now === before ? same + 1 : 0;
    before = now;
    await page.waitForTimeout(100);
  }
}

/** Settled: the view still, nothing on its way, the fonts in, every picture in view drawn. */
async function settled(page: Page): Promise<void> {
  await viewStill(page);
  await (quietOf.get(page) ?? (async () => {}))();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => {
      const box = image.getBoundingClientRect();
      const seen =
        box.width > 0 &&
        box.bottom > 0 &&
        box.right > 0 &&
        box.top < window.innerHeight &&
        box.left < window.innerWidth;
      return !seen || image.complete;
    }),
  );
  await page.waitForTimeout(300);
}

export type Box = { x: number; y: number; width: number; height: number };

export type Shot = {
  /** Only this part of the page, in its pixels. */
  clip?: Box;
  /** Only this element, with `margin` pixels around it. */
  element?: Locator;
  margin?: number;
};

/** The picture taken into the run's folder, then made smaller into the guide's, as `name`. */
export async function shoot(page: Page, name: string, shot: Shot = {}): Promise<void> {
  await settled(page);
  // The pointer away, so nothing shows a hover card by chance.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  let clip = shot.clip;
  if (shot.element) {
    const box = await shot.element.boundingBox();
    if (!box) throw new Error(`${name}: its element isn't on screen`);
    const margin = shot.margin ?? 0;
    clip = {
      x: Math.max(0, Math.round(box.x - margin)),
      y: Math.max(0, Math.round(box.y - margin)),
      width: Math.round(box.width + 2 * margin),
      height: Math.round(box.height + 2 * margin),
    };
  }
  const run = process.env.GUIDE_RUN ?? ".";
  mkdirSync(join(run, "pictures"), { recursive: true });
  const taken = join(run, "pictures", `${name}.png`);
  await page.screenshot({ path: taken, clip, animations: "disabled", caret: "hide" });
  // Made smaller by the repository's own Python, as its tools are run: from backend/.
  const made = spawnSync(
    "uv",
    [
      "run",
      "--no-sync",
      "python",
      "../scripts/smaller_picture.py",
      taken,
      join(OUT, `${name}.png`),
    ],
    { cwd: join(REPO, "backend"), env: engineSettings(run), encoding: "utf8", windowsHide: true },
  );
  if (made.status !== 0) throw new Error(`${name}: not made smaller: ${made.stderr}`);
  console.log(`${name}: ${made.stdout.trim()}`);
}

// ---------------------------------------------------------------------------------------------
// The test, with the journeys' page set-up

export const test = base.extend<{ fresh: undefined }>({
  baseURL: async ({ baseURL }, use) => {
    const url = process.env.GUIDE_URL ?? baseURL;
    if (!url) throw new Error("The guide's engine isn't running: run the walk with Playwright");
    await use(url);
  },
  context: async ({ context }, use, testInfo) => {
    await context.route("**/*", (route) => {
      const request = route.request();
      const why = refused(request.url(), request.method());
      if (why === null) return route.fallback();
      testInfo.annotations.push({
        type: "refused",
        description: `${request.method()} ${request.url()}: ${why}`,
      });
      return route.abort("blockedbyclient");
    });
    await context.clock.setFixedTime(TODAY);
    await use(context);
  },
  page: async ({ page }, use) => {
    quietOf.set(page, watchRequests(page));
    await use(page);
  },
  // After each picture: anything changed, back to the family as the walk began.
  fresh: [
    async ({ request }, use) => {
      await use(undefined);
      const history = (await (await request.get("/api/history")).json()) as {
        undo: unknown;
        redo: unknown;
      };
      if ((history.undo || history.redo) && process.env.GUIDE_FRESH) {
        const back = await request.post(`/api/backups/${process.env.GUIDE_FRESH}/restore`);
        expect(back.ok(), "the family as the walk began").toBe(true);
      }
    },
    { auto: true },
  ],
});

export { expect };
