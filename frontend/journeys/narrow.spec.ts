import type { Locator, Page } from "@playwright/test";
import { expect, fromTopBar, settle, slowly, TODAY, test } from "./fixtures";
import { keeper } from "./guide/walk";

/*
 * Nothing hidden in a narrow window: at 800 × 600, the journeys' small size, as at
 * 1366 × 768. Family facts' panel below the tree's toolbar, every control of it in view and
 * usable while the panel is open; the family's name still read beside In step; every family
 * named whole in the Centre menu; and Births by decade's labels apart, never run together.
 */

/** Words cut short inside `within`: an element narrower than what it holds, and clipping it. */
async function cutShort(within: Locator): Promise<string[]> {
  return within.evaluate((box: HTMLElement) =>
    [box, ...box.querySelectorAll<HTMLElement>("*")]
      // What's seen: not words for a screen reader alone, a pixel wide by design.
      .filter((each) => each.offsetParent !== null && each.clientWidth > 1)
      .filter(
        (each) =>
          each.scrollWidth > each.clientWidth + 1 && getComputedStyle(each).overflowX !== "visible",
      )
      .map((each) => each.innerText.trim()),
  );
}

/** Family facts, opened from its ⓘ beside the family's name, with its facts come. */
async function familyFacts(page: Page): Promise<Locator> {
  await fromTopBar(page, "Family facts");
  const facts = page.getByRole("complementary", { name: "Family facts" });
  await expect(facts.getByText("64 people")).toBeVisible();
  return facts;
}

test("Family facts below the tree's toolbar, every control of it in view and usable", async ({
  page,
}) => {
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
  const facts = await familyFacts(page);
  const tools = page.getByRole("group", { name: "The tree's tools" });
  await settle(page);

  const panel = await facts.boundingBox();
  const bar = await tools.boundingBox();
  if (!panel || !bar) throw new Error("Family facts, or the tree's toolbar, isn't drawn");
  expect(panel.y, "the panel's top, below the toolbar's foot").toBeGreaterThanOrEqual(
    bar.y + bar.height - 1,
  );
  // Each control in view, and what a click there reaches: nothing over it.
  const controls = tools.locator("button:visible, [role=combobox]:visible");
  const count = await controls.count();
  expect(count, "controls in the toolbar").toBeGreaterThanOrEqual(4);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    await expect(control).toBeInViewport({ ratio: 1 });
    await control.click({ trial: true, timeout: slowly(2_000) });
  }
  // And used: the layout's menu opens, and closes, Family facts still open under it.
  await tools.getByRole("button", { name: /^Layout: / }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(facts).toBeVisible();
  // Pictured in look-around's family-facts, at both sizes.

  // Below the timeline's toolbar and the map's too, as the panel stays open from view to view.
  const views = page.getByRole("navigation", { name: "Views" });
  for (const [view, toolbar] of [
    ["Timeline", "The timeline's tools"],
    ["Map", "The map's tools"],
  ] as const) {
    await views.getByRole("link", { name: view }).click();
    const tools = page.getByRole("group", { name: toolbar });
    await expect(tools).toBeVisible();
    await expect(facts).toBeVisible();
    await expect
      .poll(async () => {
        const [panel, bar] = [await facts.boundingBox(), await tools.boundingBox()];
        return panel && bar ? panel.y - (bar.y + bar.height) : -1;
      }, `Family facts below ${toolbar}`)
      .toBeGreaterThanOrEqual(-1);
  }
});

test("the family's name read beside In step", async ({ page, picture, request }) => {
  // In a family folder, in step two minutes before the pages' clock: the guide's made-up keeper,
  // answered here, so nothing reaches the engine's family folder, let alone Google.
  const twoMinutes = new Date(TODAY.getTime() - 2 * 60_000).toISOString();
  const folder = keeper({ last_sync: twoMinutes, tried: twoMinutes, published: twoMinutes });
  await page.route(/\/api\/family-folder(\?|$)/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: folder }) : route.fallback(),
  );
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
  const top = page.getByRole("banner");
  await expect(top.getByRole("button", { name: /^Family folder: In step/ })).toBeVisible();

  const family = top.getByRole("button", { name: /^Family: Keluarga Contoh\./ });
  await expect(family).toBeVisible();
  await settle(page);
  await expectRead(family);
  // Nothing else in the bar cut short, and nothing past its edge.
  const cut = (await cutShort(top)).filter((words) => !words.startsWith("Keluarga"));
  expect(cut).toEqual([]);
  expect(await top.evaluate((bar) => bar.scrollWidth <= bar.clientWidth + 1)).toBe(true);
  await picture("in-step");
  // Its whole name in its hint, as a name cut short gives it.
  await family.hover();
  await expect(page.getByRole("tooltip")).toContainText("Keluarga Contoh");

  // And with a long name for Me: Me's is shortened first, the family's still read.
  const me = ((await (await request.get("/api/family/me")).json()) as { person: string }).person;
  await page.route(new RegExp(`/api/persons/${me}$`), async (route) => {
    const answer = await route.fetch();
    const person = (await answer.json()) as Record<string, unknown>;
    await route.fulfill({ response: answer, json: { ...person, nickname: LONG_ME } });
  });
  await page.reload();
  const meButton = top.getByRole("button", { name: /^Me: / });
  await expect(meButton).toContainText(LONG_ME.slice(0, 5));
  await settle(page);
  await expectRead(family);
  expect(await top.evaluate((bar) => bar.scrollWidth <= bar.clientWidth + 1)).toBe(true);
});

/** A Me with a long name, as the bar may have to hold: the example family's own, with titles. */
const LONG_ME = "Abang Long Danial Hakimi";

/** The family's name read: at least its first five letters, cut short with an ellipsis after
 *  them if it must be. */
async function expectRead(family: Locator): Promise<void> {
  const read = await family.evaluate((button) => {
    const name = button.querySelector("span");
    if (!name) return { shown: 0, needed: 1 };
    const probe = document.createElement("span");
    probe.textContent = `${(name.textContent ?? "").slice(0, 5)}…`;
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
    button.append(probe);
    const needed = probe.getBoundingClientRect().width;
    probe.remove();
    return { shown: name.getBoundingClientRect().width, needed };
  });
  expect(read.shown, "the name's width, for its first five letters").toBeGreaterThanOrEqual(
    read.needed - 0.5,
  );
}

test("every family named whole in the Centre menu", async ({ page, picture }) => {
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
  // The toolbar fitted to the line, once its words are drawn in their own font.
  await settle(page);
  const tools = page.getByRole("group", { name: "The tree's tools" });
  // In the toolbar where it fits; in ⋯ where it doesn't, as at 800 pixels.
  const centre = tools.getByRole("button", { name: /^Centre/ });
  if (!(await centre.isVisible())) {
    await tools.getByRole("button", { name: "More tools" }).click();
  }
  await page.getByRole("button", { name: /^Centre/ }).click();
  const menu = page.getByRole("dialog", { name: "Families in the tree" });
  await expect(menu).toBeVisible();
  // The married-in families, each named for its couple, whole.
  for (const name of ["Rashid & Kamariah", "Mbah Musa & Mbah Nem"]) {
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
  }
  expect(await cutShort(menu)).toEqual([]);
  // Inside the window.
  const box = await menu.boundingBox();
  const size = page.viewportSize();
  if (!box || !size) throw new Error("The Centre menu isn't drawn");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  expect(box.y + box.height, "the menu's foot, inside the window").toBeLessThanOrEqual(size.height);
  await picture("centre-menu");
  // The last family too, scrolled to in the menu's list: whole in the window.
  for (const words of ["Hamid & Hawa", "Rosli's family · Rosli married Kak Long"]) {
    const last = menu.getByText(words, { exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
  }
});

test("Births by decade: every bar, and no two labels touching", async ({ page, picture }) => {
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
  const facts = await familyFacts(page);
  const decades = facts.getByRole("group", { name: "Births in each decade" });
  await decades.scrollIntoViewIfNeeded();
  // The example family's births, from the 1870s to the 2020s: a bar for each decade.
  await expect(facts.getByText("The 1870s to the 2020s")).toBeVisible();
  await expect(decades.getByRole("button")).toHaveCount(16);
  // Each label shown, its box: the last of each bar's words, under it.
  const labels = await decades.evaluate((chart) =>
    [...chart.querySelectorAll<HTMLElement>("button")]
      .map((bar) => bar.lastElementChild as HTMLElement | null)
      .filter(
        (label): label is HTMLElement =>
          label !== null &&
          getComputedStyle(label).visibility === "visible" &&
          Number(getComputedStyle(label).opacity) > 0,
      )
      .map((label) => {
        const box = label.getBoundingClientRect();
        return { text: label.innerText, left: box.left, right: box.right };
      }),
  );
  expect(labels.length, "decades labelled").toBeGreaterThanOrEqual(4);
  const touching = labels
    .slice(1)
    .filter((label, index) => label.left < (labels[index]?.right ?? 0) + 2)
    .map((label, index) => `${labels[index]?.text} ${label.text}`);
  expect(touching, "labels touching the one before").toEqual([]);
  await picture("births-by-decade");
});
