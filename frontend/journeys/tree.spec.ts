import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * The tree, readable. Its first view shows names that can be read, 11 pixels high or
 * more on screen, around the family's centre, and Show everyone frames them all. Names stand on a soft
 * background, so no line is drawn across one. The toolbar is above the canvas, in one line, with
 * what doesn't fit in its ⋯. The overview is small, can be hidden, and stays put as the panel
 * opens. Photos show initials until they've come. From the keyboard, Tab reaches people, their
 * card shows with their full name, and Enter opens them; the lines are never a Tab stop.
 */

const READABLE_PX = 11;

/** Each name inside the canvas, with its height on screen: its font's size, as zoomed. */
async function namesOnScreen(page: Page): Promise<{ name: string; px: number }[]> {
  return page.evaluate(() => {
    const zoom = Number(
      /scale\(([\d.]+)\)/.exec(
        document.querySelector(".react-flow__viewport")?.getAttribute("style") ?? "",
      )?.[1] ?? 1,
    );
    const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
    if (!canvas) return [];
    return [...document.querySelectorAll<HTMLElement>(".react-flow__node .person-name")]
      .filter((name) => {
        const box = name.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.left >= canvas.left &&
          box.right <= canvas.right &&
          box.top >= canvas.top &&
          box.bottom <= canvas.bottom
        );
      })
      .map((name) => ({
        name: name.innerText,
        px: Number.parseFloat(getComputedStyle(name).fontSize) * zoom,
      }));
  });
}

/**
 * Where a line on screen runs through a name or its years: the names it's drawn across. A line
 * passing behind them, under their soft background (at least 85 % opaque, and painted over the
 * line), isn't drawn across them; nor is one under the overview, which covers both.
 */
async function linesAcrossNames(page: Page): Promise<{ behind: number; across: string[] }> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
    if (!canvas) return { behind: 0, across: [] };
    const opacity = (colour: string) => {
      if (colour === "transparent") return 0;
      const alpha = /\/\s*([\d.]+%?)\s*\)$|rgba\([^)]*,\s*([\d.]+)\)$/.exec(colour);
      const value = alpha?.[1] ?? alpha?.[2];
      if (!value) return 1;
      return value.endsWith("%") ? Number.parseFloat(value) / 100 : Number(value);
    };
    // The words themselves: each name and its years, a pixel or two inside their boxes.
    const words = [...document.querySelectorAll<HTMLElement>(".react-flow__node .person-label")]
      .flatMap((label) =>
        [...label.children].map((each) => {
          const box = each.getBoundingClientRect();
          return {
            label,
            box: {
              left: box.left + 2,
              right: box.right - 2,
              top: box.top + 2,
              bottom: box.bottom - 2,
            },
          };
        }),
      )
      .filter(
        ({ box }) => box.right > box.left && box.bottom > canvas.top && box.top < canvas.bottom,
      );
    let behind = 0;
    const across = new Set<string>();
    for (const path of document.querySelectorAll<SVGPathElement>(
      ".react-flow__edge path.react-flow__edge-path",
    )) {
      const matrix = path.getScreenCTM();
      if (!matrix) continue;
      const length = path.getTotalLength();
      for (let along = 0; along <= length; along += 2) {
        const point = path.getPointAtLength(along).matrixTransform(matrix);
        // On screen: the canvas's right and bottom edges are just past its last pixel.
        if (point.x < canvas.left || point.x > canvas.right - 1) continue;
        if (point.y < canvas.top || point.y > canvas.bottom - 1) continue;
        for (const { label, box } of words) {
          if (point.x <= box.left || point.x >= box.right) continue;
          if (point.y <= box.top || point.y >= box.bottom) continue;
          const top = document.elementFromPoint(point.x, point.y);
          if (top?.closest(".react-flow__panel")) continue;
          const covered =
            top !== null &&
            label.contains(top) &&
            opacity(getComputedStyle(label).backgroundColor) >= 0.85;
          if (covered) behind += 1;
          else across.add(label.innerText.split("\n")[0] ?? "");
        }
      }
    }
    return { behind, across: [...across] };
  });
}

/** The canvas's box, and the tree's toolbar's. */
async function boxes(page: Page) {
  const canvas = await page.getByRole("application", { name: "The family tree" }).boundingBox();
  const tools = await page.getByRole("group", { name: "The tree's tools" }).boundingBox();
  if (!canvas || !tools) throw new Error("The tree, or its toolbar, isn't drawn");
  return { canvas, tools };
}

test("the first view: names that can be read, lines behind them; Show everyone frames them all", async ({
  page,
  picture,
  request,
}) => {
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();

  await test.step("names 11 pixels or larger, around the centre", async () => {
    const names = await namesOnScreen(page);
    // As many as can be read: about 20 at 1366 × 768, a few in a small window.
    const wide = (page.viewportSize()?.width ?? 0) >= 1366;
    expect(names.length, "names in view").toBeGreaterThanOrEqual(wide ? 12 : 3);
    expect(names.filter(({ px }) => px < READABLE_PX)).toEqual([]);
    // The couple at the centre, Tok Mat and Tok Wan Som, are among them.
    expect(names.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["Ahmad bin Musa", "Wan Som binti Wan Ali"]),
    );
  });

  await test.step("no line drawn across a name", async () => {
    const lines = await linesAcrossNames(page);
    expect(lines.across).toEqual([]);
    test.info().annotations.push({
      type: "lines behind names",
      description: `${lines.behind} points of lines pass behind names`,
    });
  });

  await test.step("the toolbar above the canvas, in one line; the credit gone", async () => {
    const { canvas, tools } = await boxes(page);
    expect(tools.y + tools.height).toBeLessThanOrEqual(canvas.y + 1);
    expect(tools.height).toBeLessThanOrEqual(44);
    await expect(page.getByRole("link", { name: "React Flow" })).toHaveCount(0);
  });

  await test.step("Show everyone: everyone in view", async () => {
    await page.getByRole("button", { name: "Show everyone" }).click();
    const graph = (await (await request.get("/api/graph")).json()) as { people: unknown[] };
    await expect(page.locator(".react-flow__node")).toHaveCount(graph.people.length);
    await picture("tree-fit-all");
  });
});

test("the toolbar: what doesn't fit, in ⋯", async ({ page, picture }, testInfo) => {
  test.skip(testInfo.project.name !== "800x600", "a narrow window, with someone open");
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ahmad bin Musa", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name: "Ahmad bin Musa", level: 2 })).toBeVisible();
  const tools = page.getByRole("group", { name: "The tree's tools" });
  const { canvas, tools: bar } = await boxes(page);
  expect(bar.height).toBeLessThanOrEqual(44);
  expect(bar.y + bar.height).toBeLessThanOrEqual(canvas.y + 1);
  // Its first and its last stay in it: the layout, and Show everyone.
  await expect(tools.getByRole("button", { name: "Layout: Rings" })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Show everyone" })).toBeVisible();
  await expect(tools.getByRole("button", { name: /^Centre/ })).toBeHidden();
  await tools.getByRole("button", { name: "More tools" }).click();
  const more = page.getByRole("dialog", { name: "More tools" });
  await expect(more.getByRole("button", { name: /^Centre/ })).toBeVisible();
  await picture("tree-more-tools");
  await page.keyboard.press("Escape");
  await expect(more).toBeHidden();
});

test("the overview: small, can be hidden, and stays put as the panel opens", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "1366x768", "a window wide enough for it");
  await page.goto("/tree");
  const overview = page.getByRole("img", { name: "The whole tree: click or drag to move there" });
  await expect(overview).toBeVisible();
  const { canvas } = await boxes(page);
  const before = await overview.boundingBox();
  if (!before) throw new Error("The overview isn't drawn");
  expect(before.width).toBeLessThanOrEqual(160);
  expect(before.height).toBeLessThanOrEqual(120);
  // At the bottom left, away from the panel's side.
  expect(before.x - canvas.x).toBeLessThan(40);
  expect(canvas.y + canvas.height - (before.y + before.height)).toBeLessThan(40);

  await page.getByRole("button", { name: "Ahmad bin Musa", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name: "Ahmad bin Musa", level: 2 })).toBeVisible();
  await expect(overview).toBeVisible();
  expect(await overview.boundingBox()).toEqual(before);

  await page.getByRole("button", { name: "Hide the overview" }).click();
  await expect(overview).toBeHidden();
  await page.getByRole("button", { name: "Show the overview" }).click();
  await expect(overview).toBeVisible();
});

test("photos show initials until they've come", async ({ page }) => {
  let come: () => void = () => {};
  const held = new Promise<void>((done) => {
    come = done;
  });
  await page.route("**/photo/avatar?**", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/tree");
  const tokMat = page.getByRole("button", { name: "Ahmad bin Musa", exact: true });
  await expect(tokMat).toBeVisible();
  // His photo on its way: his initial, drawn behind it.
  const photo = tokMat.getByRole("img", { name: "Ahmad bin Musa" });
  const behind = () =>
    photo.evaluate((image) => decodeURIComponent(getComputedStyle(image).backgroundImage));
  await expect.poll(behind).toContain(">A</text>");
  come();
  await expect(photo).toHaveJSProperty("complete", true);
  await expect.poll(behind).toBe("none");
});

test("someone opened on the tree from elsewhere is shown there, not the first view", async ({
  page,
  request,
}) => {
  // As What's missing's "On the tree" and Me's "Show me on the tree" open it: someone far from
  // the centre, whom the first view doesn't show.
  const graph = (await (await request.get("/api/graph")).json()) as {
    people: { id: string; full_name: string }[];
  };
  const kamariah = graph.people.find((person) => person.full_name === "Kamariah binti Said");
  if (!kamariah) throw new Error("No Kamariah in the example family");
  await page.goto(`/tree?person=${kamariah.id}&focus=1`);
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name: "Kamariah binti Said", level: 2 })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Kamariah binti Said", exact: true }),
  ).toBeInViewport();
});

test("from the keyboard: Tab reaches someone, their card shows, Enter opens them", async ({
  page,
  picture,
}) => {
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
  // The lines are never a Tab stop.
  await expect(page.locator(".react-flow__edge[tabindex]")).toHaveCount(0);

  let name = "";
  for (let tabs = 0; tabs < 60 && !name; tabs += 1) {
    await page.keyboard.press("Tab");
    name = await page.evaluate(() => {
      const person = document.activeElement?.closest(".react-flow__node");
      return person && person === document.activeElement
        ? (person.getAttribute("aria-label") ?? "")
        : "";
    });
  }
  expect(name, "someone on the tree reached by Tab").not.toBe("");
  const card = page.getByRole("tooltip").filter({ hasText: name });
  await expect(card).toBeVisible();
  await picture("tree-keyboard");

  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name, level: 2 })).toBeVisible();
});
