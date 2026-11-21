import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * The top bar and the views' toolbar. The bar names Tree, Timeline, Map, Add person and
 * Search people from 1024 pixels across, the rest in More with their words; from 1760 pixels,
 * everything with its words, and no More. Family facts has one place, its ⓘ beside the family's
 * name, at every width; Export, a short menu, has its two in More. Nothing in it is
 * cut short but the family's name, which gives way first by design, and nothing runs past its
 * edge. The tree, the timeline and the map have one toolbar, its controls one height.
 */

/** Words in the top bar cut short, the family's name aside, and whether the bar runs over. */
async function crowded(page: Page): Promise<{ cut: string[]; over: boolean }> {
  return page.getByRole("banner").evaluate((bar) => ({
    cut: [...bar.querySelectorAll<HTMLElement>("*")]
      // What's seen: not words for a screen reader alone, a pixel wide by design.
      .filter((each) => each.offsetParent !== null && each.clientWidth > 1)
      .filter((each) => !each.closest("[data-family-menu]"))
      .filter(
        (each) =>
          each.scrollWidth > each.clientWidth + 1 && getComputedStyle(each).overflowX !== "visible",
      )
      .map((each) => each.innerText.trim()),
    over: bar.scrollWidth > bar.clientWidth + 1,
  }));
}

test("the top bar: words where they fit, the rest in More", async ({ page, picture }, testInfo) => {
  test.skip(testInfo.project.name !== "1366x768", "it sets its own window sizes, once");
  await page.goto("/tree");
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
  const top = page.getByRole("banner");
  const more = top.getByRole("button", { name: /^More/ });

  await test.step("1024 pixels: the five with their words, the rest in More", async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const view of ["Tree", "Timeline", "Map"]) {
      await expect(top.getByRole("link", { name: view, exact: true })).toHaveText(view);
    }
    await expect(top.getByRole("link", { name: "Add person" })).toHaveText("Add person");
    await expect(top.getByRole("button", { name: "Search people" })).toContainText(
      "Search people…",
    );
    await expect(crowded(page)).resolves.toEqual({ cut: [], over: false });
    await expect(top.getByRole("button", { name: "Family facts" })).toBeVisible();
    await more.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "View-only copy…",
      "Picture of the tree",
      "Dictionary",
      "Guide",
      "Settings",
    ]);
    await picture("top-bar-more");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  await test.step("800 pixels: Add person still with its words, nothing cut short", async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(top.getByRole("link", { name: "Add person" })).toHaveText("Add person");
    await expect(top.getByRole("button", { name: "Search people" })).toBeVisible();
    await expect(more).toBeVisible();
    await expect(top.getByRole("button", { name: "Family facts" })).toBeVisible();
    await expect(crowded(page)).resolves.toEqual({ cut: [], over: false });
  });

  await test.step("1760 pixels: everything with its words, and no More", async () => {
    await page.setViewportSize({ width: 1760, height: 900 });
    await expect(more).toBeHidden();
    // The ⓘ alone, as at every width: its words are its tooltip's.
    await expect(top.getByRole("button", { name: "Family facts" })).toHaveText("");
    await expect(top.getByRole("button", { name: "Export" })).toHaveText("Export");
    const dictionary = top.getByRole("link", { name: "Dictionary" });
    await expect(dictionary).toHaveText("Dictionary");
    // Its own icon, no longer the life story's book.
    await expect(dictionary.locator("svg")).toHaveClass(/lucide-languages/);
    await expect(top.getByRole("link", { name: "Guide" })).toHaveText("Guide");
    await expect(top.getByRole("link", { name: "Settings" })).toHaveText("Settings");
    await expect(crowded(page)).resolves.toEqual({ cut: [], over: false });
    await picture("top-bar");

    // Export, a short menu: its two. After the picture, which its focus would be in.
    await top.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
      "View-only copy…",
      "Picture of the tree",
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  });
});

test("one toolbar for the tree, the timeline and the map, its controls one height", async ({
  page,
}) => {
  const heights = async (view: string) => {
    const tools = page.getByRole("group", { name: `The ${view}'s tools` });
    await expect(tools).toBeVisible();
    return tools.evaluate((bar) =>
      [...bar.querySelectorAll<HTMLElement>("button:not([role=switch]), [role=combobox]")]
        .filter((each) => each.offsetParent !== null)
        .map((each) => Math.round(each.getBoundingClientRect().height)),
    );
  };
  await page.goto("/tree");
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
  const views = page.getByRole("navigation", { name: "Views" });
  const each: number[] = await heights("tree");
  await views.getByRole("link", { name: "Timeline" }).click();
  each.push(...(await heights("timeline")));
  await views.getByRole("link", { name: "Map" }).click();
  each.push(...(await heights("map")));
  expect(each.length).toBeGreaterThan(10);
  expect(new Set(each)).toEqual(new Set([28]));
});
