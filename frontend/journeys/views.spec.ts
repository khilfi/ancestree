import type { Locator } from "@playwright/test";
import { expect, findPerson, test } from "./fixtures";

test("the life story", async ({ page, picture }) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Hassan bin Ismail");
  await panel.getByRole("button", { name: "Life story", exact: true }).click();
  const story = page.getByRole("dialog", { name: "Hassan bin Ismail: life story" });
  await expect(story).toBeVisible();
  await expect(story.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "true");
  await picture("life-story");
  await story.getByRole("button", { name: "Close" }).click();
  await expect(story).toBeHidden();
  await expect(panel.getByRole("heading", { name: "Hassan bin Ismail" })).toBeVisible();
});

test("the timeline", async ({ page, picture }) => {
  await page.goto("/tree");
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name: "Timeline" })
    .click();
  await expect(page).toHaveURL(/\/timeline$/);
  // Named as on the tree, the nickname after; the colours' key above.
  const tokMat = page.getByRole("button", { name: "Ahmad bin Musa “Tok Mat”, c. 1872–1938" });
  await expect(tokMat).toBeVisible();
  await expect(page.getByText("Acan's branch")).toBeVisible();
  await picture("timeline");
  await page.getByRole("button", { name: "Hassan bin Ismail “Acan”, 1938–2011" }).click();
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name: "Hassan bin Ismail" })).toBeVisible();
  await picture("timeline-person");

  // The wheel goes down the list, the years staying as they were; Ctrl+wheel zooms.
  const year = page.getByText("1900", { exact: true });
  const before = await year.boundingBox();
  await tokMat.hover();
  await page.mouse.wheel(0, 900);
  await expect(tokMat).not.toBeInViewport();
  expect(await year.boundingBox()).toEqual(before);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -500);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await year.isVisible()) && (await year.boundingBox())?.x)
    .not.toBe(before?.x);
});

/** No two of the family's circles' names cover each other on the map, and each is on it. */
async function namesApart(map: Locator): Promise<number> {
  const edge = await map.boundingBox();
  const boxes = await map.locator("[data-map-name]").evaluateAll((names) =>
    names.map((name) => {
      const box = name.getBoundingClientRect();
      return { x0: box.left, y0: box.top, x1: box.right, y1: box.bottom, text: name.textContent };
    }),
  );
  for (const [index, a] of boxes.entries()) {
    expect(a.x0, `${a.text} on the map`).toBeGreaterThanOrEqual((edge?.x ?? 0) - 0.5);
    expect(a.x1, `${a.text} on the map`).toBeLessThanOrEqual(
      (edge?.x ?? 0) + (edge?.width ?? 0) + 0.5,
    );
    for (const b of boxes.slice(index + 1)) {
      const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
      expect(apart, `${a.text} and ${b.text} apart`).toBe(true);
    }
  }
  return boxes.length;
}

test("the map", async ({ page, picture }) => {
  await page.goto("/tree");
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Map" }).click();
  await expect(page).toHaveURL(/\/map$/);
  const map = page.getByRole("application", { name: "Map of where the family lives" });
  // It opens on everyone, wherever they are: before, on Malaysia, Australia's out of sight.
  for (const [country, count] of [
    ["Malaysia", 54],
    ["Singapore", 7],
    ["Australia", 3],
  ] as const) {
    await expect(
      map.getByRole("button", { name: `${country}: ${count} people. Zoom in` }),
    ).toBeInViewport();
  }
  await expect(page.getByText("64 of 64 on the map")).toBeVisible();
  expect(await namesApart(map)).toBe(3);
  // Singapore has no states: its towns are listed, never "State not known".
  await expect(page.getByRole("button", { name: "Tampines Estate" })).toBeVisible();
  await expect(page.getByText("State not known")).toHaveCount(0);
  await picture("map");

  await map.getByRole("button", { name: "Malaysia: 54 people. Zoom in" }).click();
  const kelantan = map.getByRole("button", { name: "Kelantan: 13 people. Zoom in" });
  await expect(kelantan).toBeVisible();
  expect(await namesApart(map)).toBeGreaterThan(5);
  await picture("map-malaysia");

  // Its towns, at 800 × 600 too: there, it zoomed in less, and Kelantan's circle stayed.
  await kelantan.click();
  await expect(kelantan).toBeHidden();
  await expect(map.getByText("Kuala Krai", { exact: true })).toBeVisible();
  await namesApart(map);
  await picture("map-kelantan");
});

test("the map's place list gives way to someone's panel", async ({ page, picture }) => {
  await page.goto("/map");
  const map = page.getByRole("application", { name: "Map of where the family lives" });
  const list = page.getByRole("button", { name: "64 placed" });
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Kamariah", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name: "Kamariah binti Said" })).toBeVisible();
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  // Beside the map where that leaves it room; on a narrow window it gives way, and opens
  // over the map. Before, it stayed beside it, leaving the map a strip.
  await expect(list).toHaveAttribute("aria-pressed", wide ? "true" : "false");
  const room = await map.boundingBox();
  expect(room?.width ?? 0).toBeGreaterThan(wide ? 600 : 340);
  await picture("map-person");
  if (!wide) {
    await list.click();
    await expect(list).toHaveAttribute("aria-pressed", "true");
    const where = page.getByRole("heading", { name: "Where they live" });
    await expect(where).toBeVisible();
    // Over the map: the map keeps its room beneath it.
    expect((await map.boundingBox())?.width).toBe(room?.width);
    await picture("map-person-list");
  }
  await panel.getByRole("button", { name: "Close the panel" }).click();
  await expect(list).toHaveAttribute("aria-pressed", "true");
});
