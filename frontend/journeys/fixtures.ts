/**
 * What every journey has: the engine's address; pages that reach nothing outside this
 * computer, on a clock that stands still; the example family, fresh at the start of each test;
 * and pictures taken once the page has settled, to compare with those kept.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type APIRequestContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { refused } from "./rules";

/** The day the pages believe it is, so ages, "today" and the like stay as pictured. */
const TODAY = new Date("2026-11-19T10:00:00+08:00");
const ENGINE_BACK_IN = 180_000; // ms: the engine starting again on another family

export type Options = {
  /** Whether the test starts on the example family, fresh; the first journey starts before. */
  example: boolean;
};

type PictureOptions = { mask?: Locator[] };

type Fixtures = {
  family: undefined;
  /** A picture of the page, named for what it shows and the window's size. */
  picture: (name: string, options?: PictureOptions) => Promise<void>;
};

/** The engine, until it answers with the example family open, started again on it. */
export async function exampleOpened(request: APIRequestContext): Promise<void> {
  const until = Date.now() + ENGINE_BACK_IN;
  while (Date.now() < until) {
    try {
      // Only the example family has people: the family before it had none.
      const graph = await request.get("/api/graph", { timeout: 5_000 });
      if (graph.ok() && ((await graph.json()) as { people: unknown[] }).people.length > 0) return;
    } catch {
      // Starting again: nothing answers for a few seconds.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("The engine never came back with the example family");
}

/** The example family open: added and opened as Look around first does, if it isn't. */
async function openExample(request: APIRequestContext): Promise<void> {
  const families = (await (await request.get("/api/desktop/families")).json()) as {
    families: { open: boolean; example?: boolean }[];
  };
  if (families.families.some((family) => family.open && family.example)) return;
  const added = (await (await request.post("/api/desktop/families/example")).json()) as {
    added: string;
  };
  await request.post(`/api/desktop/families/${added.added}/open`);
  await exampleOpened(request);
}

/** A backup of the example family as it first opened, made once a run, to go back to. */
async function freshBackup(request: APIRequestContext): Promise<string> {
  const kept = join(process.env.JOURNEYS_RUN ?? ".", "fresh.json");
  if (existsSync(kept)) return (JSON.parse(readFileSync(kept, "utf8")) as { name: string }).name;
  const made = await request.post("/api/exports", { data: { format: "archive" } });
  expect(made.ok(), "a backup of the fresh family").toBe(true);
  const { name } = (await made.json()) as { name: string };
  writeFileSync(kept, JSON.stringify({ name }));
  return name;
}

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
    for (let quiet = 0; quiet < 3; ) {
      quiet = open === 0 ? quiet + 1 : 0;
      await page.waitForTimeout(100);
    }
  };
}

/** The tree's view still: it glides to someone found, and photos come into view as it goes,
 *  each fetched as it does. Nothing to wait for where there's no tree. */
export async function treeStill(page: Page): Promise<void> {
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

/** Settled: the tree still, nothing on its way, the fonts in, and every picture in view drawn. */
async function settled(page: Page, quiet: () => Promise<void>): Promise<void> {
  await treeStill(page);
  await quiet();
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
}

/** What changes from day to day, whatever the clock says: dates the engine writes. */
function changing(page: Page): Locator[] {
  return [
    page.getByText(/^Added \d{1,2} [A-Z][a-z]{2} \d{4}$/),
    page.getByRole("region", { name: "Who changed this" }).getByRole("list"),
  ];
}

/** What the top bar names, opened as a user does: its button or link where the bar has room for
 *  its words, else its item in **More**. */
export async function fromTopBar(page: Page, name: string | RegExp): Promise<void> {
  const top = page.getByRole("banner");
  // The bar drawn first: whether each shows is asked of it once, without waiting.
  await expect(top.getByRole("navigation", { name: "Views" })).toBeVisible();
  // In the bar at this width, as Family facts' ⓘ is at every width; else in More.
  const own = top.getByRole("button", { name }).or(top.getByRole("link", { name })).first();
  if (await own.isVisible()) {
    await own.click();
    return;
  }
  await top.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menu").getByRole("menuitem", { name }).click();
}

/** Someone opened as a user finds them: Search people, their name, and their line chosen. The
 *  person panel, which shows them. */
export async function findPerson(page: Page, fullName: string): Promise<Locator> {
  await page.getByRole("banner").getByRole("button", { name: "Search people" }).click();
  const search = page.getByRole("dialog", { name: "Search people" });
  await search.getByPlaceholder("Name or nickname…").fill(fullName);
  await search.getByRole("option", { name: new RegExp(`^${fullName} `) }).click();
  // The pointer out of the way: where the list was is over the tree, and someone there would
  // show their card.
  await page.mouse.move(1, 1);
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name: fullName, level: 2 })).toBeVisible();
  return panel;
}

const quietOf = new WeakMap<Page, () => Promise<void>>();

export const test = base.extend<Fixtures & Options>({
  example: [true, { option: true }],

  baseURL: async ({ baseURL }, use) => {
    const url = process.env.JOURNEYS_URL ?? baseURL;
    if (!url) throw new Error("The journeys' engine isn't running: run them with Playwright");
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

  family: [
    async ({ example, request }, use, testInfo) => {
      if (!example) {
        await use(undefined);
        return;
      }
      await openExample(request);
      const fresh = await freshBackup(request);
      await use(undefined);
      // Changed, or perhaps changed: back to the family as it first opened, its history empty.
      const history = (await (await request.get("/api/history")).json()) as {
        undo: unknown;
        redo: unknown;
      };
      if (history.undo || history.redo || testInfo.status !== testInfo.expectedStatus) {
        const back = await request.post(`/api/backups/${fresh}/restore`);
        expect(back.ok(), "the fresh family restored").toBe(true);
      }
    },
    { auto: true },
  ],

  picture: async ({ page }, use) => {
    await use(async (name, options = {}) => {
      await settled(page, quietOf.get(page) ?? (async () => {}));
      const size = page.viewportSize();
      await expect(page).toHaveScreenshot(`${name}-${size?.width}x${size?.height}.png`, {
        mask: [...changing(page), ...(options.mask ?? [])],
      });
    });
  },
});

export { expect };
