/**
 * The guide's pictures (public/guide/), each a test named by its file, so one is taken again
 * with -g and its name. The family folder's screens, the update bar and Settings → About are the
 * app's own, given made-up answers (walk.ts); everything else is the example family as it opens,
 * in the journeys' engine (setup.ts). Run with pnpm run guide:pictures, never with the journeys.
 */

import type { Locator, Page } from "@playwright/test";
import { findPerson, fromTopBar } from "../fixtures";
import {
  ago,
  type Box,
  CODE,
  expect,
  families,
  INVITATION_MESSAGE,
  KEEPER,
  keeper,
  noFolder,
  PROJECT,
  RECOVERY,
  RELATIVE,
  relative,
  shoot,
  stage,
  test,
} from "./walk";

/** The tree as it opens, someone's photo drawn. */
async function openTree(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/tree$/);
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
}

/** Someone's panel, open from Search people, as the journeys open it. */
async function open(page: Page, name: string): Promise<Locator> {
  return findPerson(page, name);
}

const banner = (page: Page) => page.getByRole("banner");

// ---------------------------------------------------------------------------------------------
// The window, at 1600 × 1000

test.describe("the window", () => {
  test("app-window", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await shoot(page, "app-window");
  });

  test("app-top-bar", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const top = banner(page);
    const items: Locator[] = [
      top.getByRole("button", { name: "Family facts" }),
      top.getByRole("button", { name: /^Family: / }),
      top.getByRole("button", { name: /^Family folder: In step/ }),
      top.getByRole("navigation", { name: "Views" }),
      top.getByRole("link", { name: "Add person" }),
      top.getByRole("button", { name: /undo/i }),
      top.getByRole("button", { name: /^Search people/ }),
      top.getByRole("button", { name: /^Me: / }),
      top.getByRole("button", { name: /^More/ }),
    ];
    const boxes: Box[] = [];
    for (const item of items) {
      const box = await item.first().boundingBox();
      if (!box) throw new Error(`A part of the bar isn't on screen: ${item}`);
      boxes.push(box);
    }
    // Undo and Redo are one number.
    const undo = boxes[5];
    const redo = await top.getByRole("button", { name: /redo/i }).boundingBox();
    if (undo && redo) boxes[5] = { ...undo, width: redo.x + redo.width - undo.x };
    const bottom = (await top.boundingBox())?.height ?? 56;
    await numberTheBar(page, boxes, bottom);
    await shoot(page, "app-top-bar", { clip: { x: 0, y: 0, width: 1600, height: 131 } });
  });

  test("app-tree", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await page.getByRole("button", { name: "Zoom in" }).first().click();
    await shoot(page, "app-tree");
  });

  test("app-person", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await open(page, "Hassan bin Ismail");
    await shoot(page, "app-person");
  });

  test("app-find-result", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Find relationship" }).click();
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "Search people" });
    await search.getByPlaceholder("Name or nickname…").fill("Irfan bin Azman");
    await search.getByRole("option", { name: /^Irfan bin Azman / }).click();
    await expect(page.getByText("Irfan is Acan's grandson")).toBeVisible();
    await shoot(page, "app-find-result");
  });

  test("app-family-facts", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await fromTopBar(page, "Family facts");
    await expect(page.getByRole("complementary", { name: "Family facts" })).toBeVisible();
    await shoot(page, "app-family-facts");
  });

  test("app-family-facts-missing", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await fromTopBar(page, "Family facts");
    const facts = page.getByRole("complementary", { name: "Family facts" });
    await facts.getByRole("tab", { name: "What's missing" }).click();
    await expect(facts.getByRole("heading", { name: "Not linked to anyone" })).toBeVisible();
    await shoot(page, "app-family-facts-missing");
  });

  test("app-timeline", async ({ page }) => {
    await stage(page);
    await page.goto("/timeline");
    await expect(page.getByRole("button", { name: "Show everyone" })).toBeVisible();
    await shoot(page, "app-timeline");
  });

  test("app-dictionary", async ({ page }) => {
    await stage(page);
    await page.goto("/dictionary");
    await expect(page.getByRole("heading", { name: "Kinship dictionary" })).toBeVisible();
    await shoot(page, "app-dictionary");
  });

  test("app-example-family", async ({ page }) => {
    await stage(page, { families: null, folder: noFolder() });
    await openTree(page);
    await expect(page.getByRole("status").filter({ hasText: "the example family" })).toBeVisible();
    await shoot(page, "app-example-family");
  });

  test("app-settings-backups", async ({ page }) => {
    await stage(page);
    await page.goto("/settings/backups");
    await expect(page.getByRole("button", { name: "Back up now" })).toBeVisible();
    await shoot(page, "app-settings-backups");
  });

  test("app-settings-families", async ({ page }) => {
    await stage(page, { families: families("keeper", { others: true, removed: true }) });
    await page.goto("/settings/family#families");
    await expect(page.getByText("In the Trash")).toBeVisible();
    await shoot(page, "app-settings-families");
  });

  for (const name of ["app-settings-family-folder", "app-family-folder-project"]) {
    test(name, async ({ page }) => {
      await stage(page, { families: families("", { others: false }), folder: noFolder() });
      await page.goto("/settings/family#family-folder");
      await expect(page.getByRole("button", { name: "Choose the client's file…" })).toBeVisible();
      await page.locator("#family-folder").scrollIntoViewIfNeeded();
      await shoot(page, name);
    });
  }

  test("app-settings-import", async ({ page }) => {
    await stage(page);
    await page.goto("/settings/import");
    await expect(page.getByRole("button", { name: /Choose a file/ })).toBeVisible();
    await shoot(page, "app-settings-import");
  });

  test("app-settings-kinship", async ({ page }) => {
    await stage(page);
    await page.goto("/settings/kinship");
    await expect(page.getByText("Malay birth-order titles").first()).toBeVisible();
    await shoot(page, "app-settings-kinship");
  });

  test("app-settings-kinds", async ({ page }) => {
    await stage(page);
    await page.goto("/settings/kinship#kinds");
    await expect(page.getByRole("button", { name: "Add kind" })).toBeVisible();
    // Relationship kinds near the top, the titles' foot above it.
    await page.getByRole("heading", { name: "Relationship kinds" }).evaluate((heading) => {
      heading.scrollIntoView({ block: "start" });
      window.scrollBy(0, -160);
      document.querySelector("main")?.scrollBy(0, -160);
    });
    await shoot(page, "app-settings-kinds");
  });

  test("app-settings-trash", async ({ page }) => {
    await stage(page);
    await page.goto("/settings/trash");
    await expect(page.getByText("Hamid bin Osman")).toBeVisible();
    await shoot(page, "app-settings-trash");
  });

  test("app-life-story", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("button", { name: "Life story" }).first().click();
    const story = page.getByRole("dialog", { name: /Hassan bin Ismail: life story/ });
    await expect(story.getByRole("heading", { name: "Haji Hassan bin Ismail" })).toBeVisible();
    await shoot(page, "app-life-story");
  });

  test("app-life-story-write", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("button", { name: "Life story" }).first().click();
    const story = page.getByRole("dialog", { name: /Hassan bin Ismail: life story/ });
    await story
      .getByRole("tab", { name: "Write" })
      .or(story.getByRole("button", { name: "Write" }))
      .first()
      .click();
    for (const part of [
      "Sayings and quotes",
      "A message to the next generations",
      "Life values kept for life",
    ]) {
      const opener = story.getByRole("button", { name: part });
      if ((await opener.getAttribute("aria-expanded")) === "false") await opener.click();
    }
    await story
      .getByRole("button", { name: "Sayings and quotes" })
      .evaluate((part) => part.scrollIntoView({ block: "start" }));
    await shoot(page, "app-life-story-write");
  });

  test("app-life-story-said", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("button", { name: "Life story" }).first().click();
    const story = page.getByRole("dialog", { name: /Hassan bin Ismail: life story/ });
    await story.getByRole("button", { name: "Add your words" }).click();
    await story
      .getByRole("textbox")
      .last()
      .fill("He always had a sweet for us in his shirt pocket.");
    // At the page's foot, its last card whole: Free notes a little under the story's own bar.
    const top = await story.getByRole("button", { name: "Print" }).boundingBox();
    await story.getByRole("heading", { name: "Free notes" }).evaluate(
      (heading, under) => {
        let box: HTMLElement | null = heading.parentElement;
        while (
          box &&
          !(
            box.scrollHeight > box.clientHeight + 4 &&
            /auto|scroll/.test(getComputedStyle(box).overflowY)
          )
        ) {
          box = box.parentElement;
        }
        if (box) box.scrollTop += heading.getBoundingClientRect().top - under - 16;
      },
      (top?.y ?? 0) + (top?.height ?? 0) + 12,
    );
    await shoot(page, "app-life-story-said");
  });

  test("app-map", async ({ page }) => {
    await stage(page);
    await page.goto("/map");
    // The map loads its places the first time, which takes a while.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shoot(page, "app-map");
  });
});

const map = (page: Page) => page.getByRole("application", { name: /^Map of / });

test.describe("the map, close", () => {
  test("app-map-pins", async ({ page }) => {
    await stage(page);
    await page.goto("/map");
    // The map loads its places the first time, which takes a while.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 60_000 });
    await page
      .getByRole("button", { name: /^Kelantan/ })
      .first()
      .click();
    await page.waitForTimeout(2500);
    // Kota Bharu's circle, zoomed into until it parts: Acan's confirmed pin, and the town's
    // people about there.
    for (let step = 0; step < 4; step += 1) {
      const circle = map(page)
        .getByRole("button", { name: /^Tok Mat, .*Zoom in$/ })
        .first();
      if (!(await circle.count())) break;
      await circle.click();
      await page.waitForTimeout(2500);
    }
    await expect(map(page).getByRole("button", { name: /Acan/ }).first()).toBeVisible();
    await shoot(page, "app-map-pins");
  });

  test("app-map-bundle", async ({ page }) => {
    await stage(page);
    await page.goto("/map");
    // The map loads its places the first time, which takes a while.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 60_000 });
    await page
      .getByRole("button", { name: /^Johor/ })
      .first()
      .click();
    await page.waitForTimeout(2500);
    // Singapore's six, opened where they are.
    const six = map(page).getByRole("button", { name: /^Rashid, Kamariah, Faizal and 3 more/ });
    // The map dragged to bring them to its middle, then opened there.
    const canvas = await page.locator(".maplibregl-canvas").boundingBox();
    const at = await six.boundingBox();
    if (!canvas || !at) throw new Error("no map");
    // From an empty part of the map, by as far as the circle is from its middle.
    const shift = {
      x: canvas.x + canvas.width / 2 - (at.x + at.width / 2),
      y: canvas.y + canvas.height / 2 + 60 - (at.y + at.height / 2),
    };
    const from = { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.45 };
    const to = { x: from.x + shift.x, y: from.y + shift.y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / 20,
        from.y + ((to.y - from.y) * step) / 20,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(2000);
    await six.hover();
    await map(page).getByRole("button", { name: "Open here" }).first().click();
    await expect(map(page).getByRole("button", { name: /^Harith bin Faizal/ })).toBeVisible();
    await page.waitForTimeout(1000);
    await shoot(page, "app-map-bundle");
  });
});

// ---------------------------------------------------------------------------------------------
// Parts of the window, at twice the pixels, as the guide shows them smaller

/** The person panel, at its 440 pixels and 743 high. */
async function panelShot(page: Page, name: string): Promise<void> {
  const panel = page.getByRole("complementary", { name: "Person" });
  const box = await panel.boundingBox();
  if (!box) throw new Error(`${name}: no panel`);
  await shoot(page, name, { clip: { x: box.x, y: box.y, width: 440, height: 743 } });
}

/** The window as tall as makes the person panel 743 pixels: its top is the bar's foot. */
async function panelHeight(page: Page): Promise<void> {
  const bar = await banner(page).boundingBox();
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: size.width, height: Math.round((bar?.height ?? 57) + 743) });
}

test.describe("parts of the window", () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

  test("app-person-relatives", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await panelHeight(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("tab", { name: /^Relatives/ }).click();
    await expect(panel.getByRole("button", { name: /^Ismail bin Ahmad / })).toBeVisible();
    await panelShot(page, "app-person-relatives");
  });

  test("app-person-story", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await panelHeight(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("tab", { name: "Life story" }).click();
    await expect(panel.getByRole("button", { name: "Read" })).toBeVisible();
    await panelShot(page, "app-person-story");
  });

  test("app-person-edit", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await panelHeight(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(panel.getByLabel("Buried at")).toBeVisible();
    // Scrolled so Now starts a little under the tabs, which stay at the top: Now, Birth and
    // Death in view, and the form's foot.
    const tabs = await panel.getByRole("tablist").boundingBox();
    await panel
      .getByText("Now", { exact: true })
      .first()
      .evaluate(
        (heading, under) => {
          let box: HTMLElement | null = heading.parentElement;
          while (
            box &&
            !(
              box.scrollHeight > box.clientHeight + 4 &&
              /auto|scroll/.test(getComputedStyle(box).overflowY)
            )
          ) {
            box = box.parentElement;
          }
          if (box) box.scrollTop += heading.getBoundingClientRect().top - under - 16;
        },
        (tabs?.y ?? 0) + (tabs?.height ?? 0),
      );
    await panelShot(page, "app-person-edit");
  });

  test("app-add-person", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await panelHeight(page);
    await banner(page).getByRole("link", { name: "Add person" }).click();
    const form = page.getByRole("complementary", { name: "Person" });
    await expect(form.getByLabel("Full name")).toBeVisible();
    await panelShot(page, "app-add-person");
  });

  test("app-me", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await banner(page).getByRole("button", { name: /^Me: / }).click();
    await page.getByRole("menuitem", { name: "I'm someone else…" }).click();
    const dialog = page.getByRole("dialog", { name: "Which person are you?" });
    await expect(dialog.getByText("Adam bin Johari")).toBeVisible();
    await shoot(page, "app-me", { element: dialog, margin: 16 });
  });

  test("app-me-menu", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await banner(page).getByRole("button", { name: /^Me: / }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Forget who I am" })).toBeVisible();
    await shoot(page, "app-me-menu", { element: menu, margin: 10 });
  });

  test("app-search", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await banner(page)
      .getByRole("button", { name: /^Search people/ })
      .click();
    const search = page.getByRole("dialog", { name: "Search people" });
    await search.getByPlaceholder("Name or nickname…").fill("aina");
    await expect(search.getByRole("option", { name: /^Aina binti Osman / })).toBeVisible();
    await shoot(page, "app-search", { element: search, margin: 16 });
  });

  test("app-find-start", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const panel = await open(page, "Hassan bin Ismail");
    await panel.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Find relationship" }).click();
    const bar = page.getByRole("status").filter({ hasText: "how they're related to" });
    await expect(bar).toBeVisible();
    // The bar's words and its button, the bar running on across the tree beyond them.
    const box = await bar.boundingBox();
    const cancel = await bar.getByRole("button", { name: "Cancel" }).boundingBox();
    if (!box || !cancel) throw new Error("no bar");
    await shoot(page, "app-find-start", {
      clip: { x: box.x, y: box.y, width: cancel.x + cancel.width + 14 - box.x, height: box.height },
    });
  });

  test("app-tree-layout", async ({ page }) => {
    await stage(page);
    await page.setViewportSize({ width: 1280, height: 1000 }); // the whole menu, to Tidy up
    await openTree(page);
    const tools = await page.getByRole("button", { name: /^Layout: / }).boundingBox();
    await page.getByRole("button", { name: /^Layout: / }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Tucked in")).toBeVisible();
    // The card the menu is drawn on, round all of it.
    const card = page.locator("[data-radix-popper-content-wrapper]").filter({ has: menu });
    const box = (await card.count()) ? await card.boundingBox() : await menu.boundingBox();
    if (!tools || !box) throw new Error("no menu");
    await shoot(page, "app-tree-layout", {
      clip: { x: 0, y: tools.y - 12, width: 360, height: box.y + box.height + 12 - (tools.y - 12) },
    });
  });

  test("app-tree-filter", async ({ page }) => {
    await stage(page);
    await page.setViewportSize({ width: 1280, height: 1000 }); // the whole of it, to The others
    await openTree(page);
    const tools = await page.getByRole("button", { name: /^Layout: / }).boundingBox();
    await page.getByRole("button", { name: /^Filter/ }).click();
    const filter = page.getByRole("dialog", { name: /Filter/ });
    await expect(filter.getByText("The others", { exact: false }).first()).toBeVisible();
    // The card the Filter is drawn on, round its words.
    const card = page.locator("[data-radix-popper-content-wrapper]").filter({ has: filter });
    const box = (await card.count()) ? await card.boundingBox() : await filter.boundingBox();
    if (!tools || !box) throw new Error("no filter");
    await shoot(page, "app-tree-filter", {
      clip: { x: 0, y: tools.y - 12, width: 540, height: box.y + box.height + 12 - (tools.y - 12) },
    });
  });

  test("app-tree-centre", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const tools = await page.getByRole("button", { name: /^Layout: / }).boundingBox();
    await page.getByRole("button", { name: /^Centre/ }).click();
    const menu = page.getByRole("dialog", { name: "Families in the tree" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    if (!tools || !box) throw new Error("no menu");
    await shoot(page, "app-tree-centre", {
      clip: { x: 0, y: tools.y - 12, width: Math.round(box.x + box.width + 12), height: 362 },
    });
  });

  test("app-families", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await banner(page)
      .getByRole("button", { name: /^Family: / })
      .click();
    await expect(page.getByRole("menuitem", { name: /Keluarga Ibu/ })).toBeVisible();
    await shoot(page, "app-families", { clip: { x: 0, y: 0, width: 560, height: 250 } });
  });

  test("app-in-step", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await banner(page)
      .getByRole("button", { name: /^Family folder: In step/ })
      .click();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await shoot(page, "app-in-step", { clip: { x: 0, y: 0, width: 640, height: 250 } });
  });

  test("app-export", async ({ page }) => {
    await stage(page);
    await openTree(page);
    const more = await banner(page).getByRole("button", { name: /^More/ }).boundingBox();
    await banner(page).getByRole("button", { name: /^More/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "View-only copy…" })).toBeVisible();
    // More, and its menu under it.
    const box = await menu.boundingBox();
    if (!box || !more) throw new Error("no menu");
    const left = Math.min(box.x, more.x) - 12;
    const right = Math.max(box.x + box.width, more.x + more.width) + 12;
    await shoot(page, "app-export", {
      clip: {
        x: left,
        y: more.y - 8,
        width: right - left,
        height: box.y + box.height + 12 - (more.y - 8),
      },
    });
  });

  test("app-view-only-copy", async ({ page }) => {
    await stage(page);
    await openTree(page);
    await fromTopBar(page, "View-only copy…");
    const dialog = page.getByRole("dialog", { name: "Make a view-only copy" });
    await expect(dialog.getByRole("button", { name: "Make the copy" })).toBeVisible();
    await shoot(page, "app-view-only-copy", { element: dialog, margin: 16 });
  });
});

// ---------------------------------------------------------------------------------------------
// Settings' parts and the family folder, at twice the pixels, each part 780 pixels wide

/** A part of a Settings page, by its heading: the bordered box around it. */
function part(page: Page, title: string | RegExp): Locator {
  return page
    .getByRole("heading", { name: title, exact: typeof title === "string" })
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' border ')][1]",
    );
}

/** The window made as wide as gives `box` 780 pixels, as the guide's pictures of parts are. */
async function widen(page: Page, box: Locator, want = 780): Promise<void> {
  for (let step = 0; step < 4; step += 1) {
    const now = await box.boundingBox();
    const size = page.viewportSize();
    if (!now || !size) return;
    const off = Math.round(want - now.width);
    if (Math.abs(off) < 1) return;
    await page.setViewportSize({ width: size.width + off, height: size.height });
    await page.waitForTimeout(200);
  }
}

/** A part, 780 pixels wide, with 10 around it: 1600 pixels across. */
async function partShot(page: Page, name: string, box: Locator): Promise<void> {
  await widen(page, box);
  await box.scrollIntoViewIfNeeded();
  await shoot(page, name, { element: box, margin: 10 });
}

const ASKING = { device: "d-mak-long", name: "Mak Long's laptop", email: RELATIVE, code: CODE };
const CHANGES = {
  device: "d-mak-long",
  name: "Mak Long's laptop",
  email: RELATIVE,
  role: "contributor",
  proposal: 1,
  sent_at: ago(20),
  changed: 6,
  words_only: false,
};
const NOTE =
  "Thank you, Mak Long! I kept Muar as Aina's birth place: her birth certificate says Muar.";

/** What Mak Long's laptop sent: six changes, one of them clashing with the keeper's own. */
const REVIEW = {
  questions: [],
  left_out: [],
  second_look: [],
  changes: [
    {
      id: "c1",
      kind: "set",
      row: null,
      name: "Nor binti Hassan",
      column: "Nickname",
      before: null,
      after: "Kak Nor",
      ticked: true,
    },
    {
      id: "c2",
      kind: "set",
      row: null,
      name: "Aida binti Osman",
      column: "Occupation",
      before: null,
      after: "Teacher",
      ticked: true,
    },
    {
      id: "c3",
      kind: "set",
      row: null,
      name: "Aina binti Osman",
      column: "Birth place",
      before: "Muar",
      after: "Batu Pahat",
      clash: true,
      ticked: false,
    },
    {
      id: "c4",
      kind: "add_person",
      row: null,
      name: "Maryam binti Harith",
      detail: "b. 2026",
      ticked: true,
    },
    {
      id: "c5",
      kind: "add_link",
      row: null,
      name: "Maryam binti Harith",
      detail: "daughter of Harith bin Faizal",
      ticked: true,
    },
    {
      id: "c6",
      kind: "story",
      row: null,
      name: "Hassan bin Ismail",
      detail: "written",
      after:
        "Every Friday after prayers he walked us to the station to watch the evening train come in from Kuala Krai…",
      ticked: true,
    },
  ],
};

async function toFolder(page: Page): Promise<void> {
  await page.goto("/settings/family#family-folder");
  await expect(page.getByRole("heading", { name: "Family folder", level: 2 })).toBeVisible();
}

test.describe("Settings' parts and the family folder", () => {
  test.use({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });

  test("app-copies-elsewhere", async ({ page }) => {
    await stage(page);
    await page.goto("/settings/backups");
    await partShot(page, "app-copies-elsewhere", part(page, "Copies in another place"));
  });

  test("desktop-settings-about", async ({ page }) => {
    await stage(page);
    await page.goto("/settings/about");
    const about = page.locator("section").filter({
      has: page.getByRole("heading", { name: "About", level: 2 }),
    });
    await expect(about.getByText("This is the latest version.")).toBeVisible();
    await widen(page, about);
    // The section to its Removing: the version, Check for updates, the folders, and removing.
    const box = await about.boundingBox();
    const map = await about.getByText("The map", { exact: true }).boundingBox();
    if (!box || !map) throw new Error("no About");
    await shoot(page, "desktop-settings-about", {
      clip: {
        x: box.x - 10,
        y: box.y - 10,
        width: box.width + 20,
        height: map.y - 6 - (box.y - 10),
      },
    });
  });

  test("keeper-1-start", async ({ page }) => {
    await stage(page, {
      families: families("", { others: false }),
      folder: noFolder({ available: true, email: KEEPER, project: PROJECT }),
    });
    await toFolder(page);
    const start = part(page, "Start your family's folder, as its keeper");
    await start.getByLabel("The family's name").fill("Keluarga Contoh");
    await start.getByLabel("This computer's name").fill("Home PC");
    await partShot(page, "keeper-1-start", start);
  });

  test("keeper-2-recovery-code", async ({ page }) => {
    await stage(page, { folder: keeper({ recovery_code: RECOVERY }) });
    await toFolder(page);
    const dialog = page.getByRole("alertdialog", { name: "Your recovery code" });
    await expect(dialog).toBeVisible();
    await shoot(page, "keeper-2-recovery-code", { element: dialog, margin: 16 });
  });

  test("keeper-3-invitation", async ({ page }) => {
    await stage(page);
    await toFolder(page);
    await page.getByLabel("Invite a relative, by their Google account").fill(RELATIVE);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "The invitation to send" });
    await expect(dialog.getByRole("textbox")).toHaveValue(/ATI1-/);
    await shoot(page, "keeper-3-invitation", { element: dialog, margin: 16 });
  });

  test("keeper-4-asking-to-join", async ({ page }) => {
    await stage(page, { folder: keeper({ asking: [ASKING] }) });
    await toFolder(page);
    await partShot(page, "keeper-4-asking-to-join", part(page, "Asking to join (1)"));
  });

  test("keeper-5-changes-waiting", async ({ page }) => {
    await stage(page, { folder: keeper({ changes: [CHANGES] }), review: REVIEW });
    await toFolder(page);
    await partShot(page, "keeper-5-changes-waiting", part(page, "Changes waiting (1)"));
  });

  test("keeper-6-review", async ({ page }) => {
    await stage(page, { folder: keeper({ changes: [CHANGES] }), review: REVIEW });
    await page.setViewportSize({ width: 1000, height: 1200 }); // the whole review in view
    await toFolder(page);
    const waiting = part(page, "Changes waiting (1)");
    await waiting.getByRole("button", { name: "Review" }).click();
    await expect(waiting.getByText("Aina binti Osman")).toBeVisible();
    await waiting.getByRole("textbox").fill(NOTE);
    await partShot(page, "keeper-6-review", waiting);
  });

  test("keeper-7-computers", async ({ page }) => {
    await stage(page);
    await toFolder(page);
    await partShot(page, "keeper-7-computers", part(page, "The family's computers"));
  });

  test("keeper-8-rebuild", async ({ page }) => {
    await stage(page, {
      folder: keeper({
        lost: true,
        trouble: "lost",
        through: false,
        problem: "The family folder can't be found in your Google Drive.",
      }),
    });
    await toFolder(page);
    await partShot(
      page,
      "keeper-8-rebuild",
      part(page, "The family folder is gone from Google Drive"),
    );
  });

  test("keeper-9-change-role", async ({ page }) => {
    await stage(page);
    await toFolder(page);
    const computers = part(page, "The family's computers");
    await computers
      .getByRole("listitem")
      .filter({ hasText: "Mak Long's laptop" })
      .getByRole("button", { name: /^Change role/ })
      .click();
    const dialog = page.getByRole("alertdialog", { name: "Change what Mak Long's laptop may do" });
    await expect(dialog).toBeVisible();
    // Trusted chosen, as the guide's step has it, so Change can be clicked.
    await dialog.getByRole("radio", { name: /^Trusted/ }).click();
    await expect(dialog.getByRole("button", { name: "Change" })).toBeEnabled();
    await shoot(page, "keeper-9-change-role", { element: dialog, margin: 16 });
  });

  test("keeper-10-hand-over", async ({ page }) => {
    await stage(page);
    await toFolder(page);
    await page.getByText("Hand the family to someone else?").click();
    await page.getByRole("button", { name: "Hand the family to someone else…" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Hand the family to someone else" });
    await expect(dialog).toBeVisible();
    await shoot(page, "keeper-10-hand-over", { element: dialog, margin: 16 });
  });

  test("relative-2-invitation", async ({ page }) => {
    await stage(page, { families: families("", { others: false }), folder: noFolder() });
    await toFolder(page);
    const join = part(page, "Join your family's AncesTree");
    await join.getByRole("textbox").fill(INVITATION_MESSAGE);
    await partShot(page, "relative-2-invitation", join);
  });

  test("relative-2-join", async ({ page }) => {
    await stage(page, {
      families: families("", { others: false }),
      folder: noFolder({
        available: true,
        email: RELATIVE,
        invited: true,
        project_invited: true,
        project: PROJECT,
      }),
    });
    await toFolder(page);
    const join = part(page, "Join your family's AncesTree");
    await join.getByRole("textbox").fill("Mak Long's laptop");
    await partShot(page, "relative-2-join", join);
  });

  test("relative-3-code", async ({ page }) => {
    await stage(page, {
      families: families("member", { others: false }),
      folder: relative({
        role: "waiting",
        code: CODE,
        members: [],
        last_sync: null,
        received: null,
        tried: null,
        through: false,
      }),
    });
    await toFolder(page);
    const waiting = part(page, "Waiting to be let in");
    await widen(page, waiting);
    // The panel, and what's under it: not in step yet, the Google account, and leaving.
    const body = waiting.locator("xpath=..");
    await shoot(page, "relative-3-code", { element: body, margin: 10 });
  });

  test("relative-5-answer", async ({ page }) => {
    await stage(page, {
      families: families("member", { others: false }),
      folder: relative({
        answers: [{ proposal: 1, left_out: ["Aina binti Osman: Birth place"], note: NOTE }],
      }),
    });
    await toFolder(page);
    await partShot(page, "relative-5-answer", part(page, "The keeper's answer"));
  });

  test("relative-6-asked-to-keep", async ({ page }) => {
    await stage(page, {
      families: families("member", { others: false }),
      folder: relative({
        role: "trusted",
        offer_here: { keeper: "Home PC", made: ago(10), own: false },
      }),
    });
    await toFolder(page);
    await partShot(
      page,
      "relative-6-asked-to-keep",
      part(page, "Home PC asks you to keep the family"),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// A narrow window's top, at twice the pixels: the bars under the top bar

/** The top of the window, down to the foot of `bar`. */
async function topShot(page: Page, name: string, bar: Locator): Promise<void> {
  const box = await bar.boundingBox();
  if (!box) throw new Error(`${name}: no bar`);
  await shoot(page, name, {
    clip: { x: 0, y: 0, width: 1000, height: Math.round(box.y + box.height) },
  });
}

// 1000 pixels across, drawn 1.6 times over: 1600 across, as before. At 800, the top bar
// leaves no room for the family's name beside In step.
test.describe("a narrow window's bars", () => {
  test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1.6 });

  test("relative-1-welcome", async ({ page }) => {
    await stage(page, {
      families: families("", { others: false, name: "My family" }),
      folder: noFolder(),
      empty: true,
    });
    await page.goto("/");
    const welcome = page.getByRole("status").filter({ hasText: "Welcome to AncesTree" });
    await expect(welcome).toBeVisible();
    await topShot(page, "relative-1-welcome", welcome);
  });

  test("relative-4-changes-waiting", async ({ page }) => {
    await stage(page, {
      families: families("member", { others: false }),
      folder: relative({ pending: 3, sent_at: ago(1) }),
    });
    await openTree(page);
    const bar = page.getByRole("status").filter({ hasText: "arrives here from its keeper" });
    await expect(bar.getByRole("button", { name: "Send now" })).toBeVisible();
    await topShot(page, "relative-4-changes-waiting", bar);
  });

  test("update-ready", async ({ page }) => {
    await stage(page, { update: true });
    await openTree(page);
    const bar = page.getByRole("status").filter({ hasText: "A new version of AncesTree is ready" });
    await expect(bar).toBeVisible();
    await topShot(page, "update-ready", bar);
  });
});

/** The bar's parts numbered beneath it, as the guide's table numbers them. */
async function numberTheBar(
  page: Page,
  boxes: { x: number; y: number; width: number; height: number }[],
  bottom: number,
): Promise<void> {
  await page.evaluate(
    ({ boxes, bottom }) => {
      const ink = "#1d6a55";
      const ns = "http://www.w3.org/2000/svg";
      const cover = document.createElement("div");
      cover.style.cssText = `position:fixed;left:0;top:${bottom}px;width:100vw;height:200px;background:#fff;z-index:9998`;
      document.body.append(cover);
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", "1600");
      svg.setAttribute("height", "200");
      svg.style.cssText = "position:fixed;left:0;top:0;z-index:9999;pointer-events:none";
      boxes.forEach((box, index) => {
        const lineY = box.y + box.height + 4;
        const middle = box.x + box.width / 2;
        const centre = bottom + 41;
        const line = document.createElementNS(ns, "rect");
        line.setAttribute("x", String(box.x));
        line.setAttribute("y", String(lineY));
        line.setAttribute("width", String(box.width));
        line.setAttribute("height", "2.5");
        line.setAttribute("fill", ink);
        const stem = document.createElementNS(ns, "rect");
        stem.setAttribute("x", String(middle - 1.25));
        stem.setAttribute("y", String(lineY));
        stem.setAttribute("width", "2.5");
        stem.setAttribute("height", String(centre - lineY));
        stem.setAttribute("fill", ink);
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", String(middle));
        circle.setAttribute("cy", String(centre));
        circle.setAttribute("r", "15");
        circle.setAttribute("fill", ink);
        const number = document.createElementNS(ns, "text");
        number.setAttribute("x", String(middle));
        number.setAttribute("y", String(centre + 6));
        number.setAttribute("text-anchor", "middle");
        number.setAttribute("fill", "#fff");
        number.setAttribute("font-size", "17");
        number.setAttribute("font-weight", "700");
        number.setAttribute("font-family", "Geist Variable, sans-serif");
        number.textContent = String(index + 1);
        svg.append(line, stem, circle, number);
      });
      document.body.append(svg);
    },
    { boxes, bottom },
  );
}
