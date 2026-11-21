import type { Page } from "@playwright/test";
import { expect, findPerson, test } from "./fixtures";

/*
 * Every control by keyboard: Tab reaches each one on the page, and each shows that
 * it has the focus, with a ring or an outline the eye can find. A control in a group that the
 * arrow keys move through (tabs, a radio group, a menu) counts as reached when one of the group
 * is. The tree's people are among them, each a Tab stop showing its focus, all of them walked
 * with everyone in view; its lines never are.
 */

/** What Tab finds, once round the page: what it never reached, what showed no focus, and any
 *  of the tree's lines it stopped at. */
type Walk = { reached: number; unreached: string[]; unseen: string[]; lines: string[] };

const MOST_TABS = 700;
const LINES = ".react-flow__edge"; // never a Tab stop

async function walk(page: Page, people: boolean): Promise<Walk> {
  await page.mouse.move(1, 1);
  await page.evaluate(async () => {
    const look = (element: Element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow].join(
        "|",
      );
    };
    // Each looked at unfocused: what has the focus loses it first, and its ring fades.
    // Looked at while it still had it, a control's ring was its "unfocused" look, and whether it
    // then showed its focus hung on how far the ring had drawn.
    const had = document.activeElement as HTMLElement | null;
    had?.blur();
    await Promise.all((had?.getAnimations() ?? []).map((each) => each.finished.catch(() => null)));
    const unfocused = new Map<Element, string>();
    for (const element of document.querySelectorAll("body *")) {
      unfocused.set(element, look(element));
    }
    for (const marked of document.querySelectorAll("[data-journey-tab]")) {
      marked.removeAttribute("data-journey-tab");
    }
    Object.assign(window, { journeyUnfocused: unfocused, journeyReached: new Set<Element>() });
  });

  const unseen = new Set<string>();
  const lines = new Set<string>();
  for (let tabs = 0; tabs < MOST_TABS; tabs += 1) {
    await page.keyboard.press("Tab");
    const now = await page.evaluate(async (tree) => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      // Round once: back to the first reached.
      if (element.getAttribute("data-journey-tab") === "first") return "round";
      const state = window as unknown as {
        journeyUnfocused: Map<Element, string>;
        journeyReached: Set<Element>;
      };
      element.setAttribute("data-journey-tab", state.journeyReached.size === 0 ? "first" : "");
      state.journeyReached.add(element);
      const named = (each: Element) => {
        const name =
          each.getAttribute("aria-label") ??
          (each as HTMLElement).innerText?.trim().split("\n")[0] ??
          "";
        return `${each.tagName.toLowerCase()}${each.getAttribute("role") ? `[role=${each.getAttribute("role")}]` : ""} "${name.slice(0, 60)}"`;
      };
      if (element.closest(tree)) return { name: named(element), shown: true, line: true };
      await Promise.all(element.getAnimations().map((each) => each.finished.catch(() => null)));
      const seen = (each: Element) => {
        const style = getComputedStyle(each);
        const alpha = /\/\s*([\d.]+)\)|rgba\([^)]*,\s*([\d.]+)\)/.exec(style.outlineColor);
        const opaque = Number(alpha?.[1] ?? alpha?.[2] ?? 1) >= 0.9;
        const outlined =
          !["none", "hidden"].includes(style.outlineStyle) &&
          Number.parseFloat(style.outlineWidth) >= 2 &&
          opaque;
        const ringed = style.boxShadow !== state.journeyUnfocused.get(each)?.split("|")[3];
        return outlined || ringed;
      };
      // A field's ring may be drawn on what holds it (an input group, a search box).
      let shown = false;
      for (let each: Element | null = element, up = 0; each && up < 3; each = each.parentElement) {
        if (seen(each)) shown = true;
        up += 1;
      }
      return { name: named(element), shown, line: false };
    }, LINES);
    if (now === "round") break;
    if (now === null) continue;
    if (now.line) lines.add(now.name);
    if (!now.shown) unseen.add(now.name);
  }

  const unreached = await page.evaluate((people) => {
    const state = window as unknown as { journeyReached: Set<Element> };
    const CONTROLS = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "summary",
      "[role=button]",
      "[role=link]",
      "[role=tab]",
      "[role=radio]",
      "[role=checkbox]",
      "[role=switch]",
      "[role=menuitem]",
      "[role=slider]",
      "[role=combobox]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const GROUPS =
      "[role=tablist],[role=radiogroup],[role=menu],[role=menubar],[role=toolbar],[role=listbox],[role=grid],[role=tree],[role=group][data-orientation]";
    const reachedIn = (group: Element) =>
      [...state.journeyReached].some((each) => group.contains(each));
    return [...document.querySelectorAll(CONTROLS)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        const shown = { opacityProperty: true, visibilityProperty: true, checkOpacity: true };
        if (!element.checkVisibility({ ...shown, checkVisibilityCSS: true })) {
          return false;
        }
        if (element.closest("[inert],[aria-hidden=true]")) return false;
        if ((element as HTMLButtonElement).disabled) return false;
        if (element.getAttribute("aria-disabled") === "true") return false;
        if (!people && element.closest(".react-flow__node")) return false;
        if (state.journeyReached.has(element)) return false;
        const group = element.closest(GROUPS);
        if (group && reachedIn(group)) return false;
        const radio = element as HTMLInputElement;
        if (radio.type === "radio" && radio.name) {
          const named = document.querySelectorAll(`input[type=radio][name="${radio.name}"]`);
          if ([...named].some((each) => state.journeyReached.has(each))) return false;
        }
        return true;
      })
      .map((element) => {
        const name =
          element.getAttribute("aria-label") ??
          (element as HTMLElement).innerText?.trim().split("\n")[0] ??
          "";
        return `${element.tagName.toLowerCase()} "${name.slice(0, 60)}"`;
      });
  }, people);
  const reached = await page.evaluate(
    () => (window as unknown as { journeyReached: Set<Element> }).journeyReached.size,
  );
  return { reached, unreached, unseen: [...unseen], lines: [...lines] };
}

/** Round the page by Tab: every control reached, and every one showing its focus. The tree's
 *  people count as controls to reach only where everyone is in view (`people`); elsewhere, as
 *  the view follows the focus, who is drawn changes as Tab goes. */
async function everyControlByKeyboard(
  page: Page,
  where: string,
  { people = false } = {},
): Promise<void> {
  const found = await walk(page, people);
  expect(found.reached, `${where}: controls reached`).toBeGreaterThan(3);
  // Soft, so every page is walked and each says what it found.
  expect.soft(found.unreached, `${where}: never reached by Tab`).toEqual([]);
  expect.soft(found.unseen, `${where}: no focus shown`).toEqual([]);
  expect.soft(found.lines, `${where}: the tree's lines stopped at by Tab`).toEqual([]);
}

test("every control reached by Tab, showing its focus", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.goto("/tree");
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
  await test.step("a hint, shown as the keyboard brings the focus there", async () => {
    // The family's menu: its hint says what it holds.
    for (let tabs = 0; tabs < 15; tabs += 1) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      if (name?.startsWith("Family: ")) break;
    }
    // The hint before it may still be fading out.
    await expect(page.getByRole("tooltip", { name: "Families on this computer" })).toBeVisible();
    await page.keyboard.press("Escape");
  });
  await test.step("the tree, everyone in view", async () => {
    // Everyone drawn, so the walk meets every person: the view follows the focus to someone at
    // its edge, which can bring others into view, and take some out.
    await page.getByRole("button", { name: "Show everyone" }).click();
    const graph = (await (await request.get("/api/graph")).json()) as { people: unknown[] };
    await expect(page.locator(".react-flow__node")).toHaveCount(graph.people.length);
    await everyControlByKeyboard(page, "the tree", { people: true });
  });

  await test.step("someone's panel", async () => {
    const panel = await findPerson(page, "Rokiah binti Salleh");
    await panel.getByRole("tab", { name: /^Relatives/ }).click();
    await everyControlByKeyboard(page, "the panel's relatives");
    await panel.getByRole("tab", { name: "Details" }).click();
    await everyControlByKeyboard(page, "the panel's details");
    await panel.getByRole("button", { name: "Close the panel" }).click();
  });

  const views = page.getByRole("navigation", { name: "Views" });
  await test.step("the timeline", async () => {
    await views.getByRole("link", { name: "Timeline" }).click();
    await expect(
      page.getByRole("button", { name: "Hassan bin Ismail “Acan”, 1938–2011" }),
    ).toBeVisible();
    await everyControlByKeyboard(page, "the timeline");
  });
  await test.step("the map", async () => {
    await views.getByRole("link", { name: "Map" }).click();
    await expect(page.getByText("64 of 64 on the map")).toBeVisible();
    await everyControlByKeyboard(page, "the map");
  });

  await test.step("the Dictionary", async () => {
    await page.goto("/dictionary");
    await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
    await everyControlByKeyboard(page, "the Dictionary");
  });

  await test.step("Family facts, and its What's missing", async () => {
    await page.goto("/tree");
    await page.getByRole("banner").getByRole("button", { name: "Family facts" }).click();
    const facts = page.getByRole("complementary", { name: "Family facts" });
    await facts.getByRole("tab", { name: "What's missing" }).click();
    await expect(facts.getByRole("heading", { name: "Not linked to anyone" })).toBeVisible();
    await everyControlByKeyboard(page, "Family facts → What's missing");
  });

  await test.step("Settings, part by part", async () => {
    await page.goto("/settings/kinship");
    const parts = page.getByRole("navigation", { name: "Settings" });
    await expect(parts).toBeVisible();
    const names = await parts.getByRole("link").allInnerTexts();
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      const link = parts.getByRole("link", { name: name.trim(), exact: true });
      // Help leaves Settings for the guide: a page of its own.
      if ((await link.getAttribute("href")) === "/guide") continue;
      await link.click();
      await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
      await everyControlByKeyboard(page, `Settings → ${name.trim()}`);
    }
  });
});
