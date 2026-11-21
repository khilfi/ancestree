import type { Page } from "@playwright/test";
import { expect, settle, test } from "./fixtures";

/*
 * Discs, back by your word of 21 Nov 2026: under Married-in families in the Layout menu,
 * between Fans and Tucked in. Chosen, each married-in family is on whole rings of its own, apart
 * from the others and from the family it married into, no photo over another and no family's
 * rings across another's people, each ring said once; and it's kept on this computer, still
 * Discs when the page loads again.
 */

type Graph = {
  people: unknown[];
  layout: {
    units: { id: string; anchor: string | null }[];
    seats: Record<string, { unit: string }>;
  };
};

type Round = { x: number; y: number; r: number }; // on screen: its middle and its radius

type Drawn = {
  arcs: number; // rings drawn as arcs, over a fan alone
  rings: Round[];
  labels: string[]; // what the rings say
  photos: (Round & { id: string })[];
};

/** The rings as they're drawn, and the photo of everyone on the tree. */
async function drawn(page: Page): Promise<Drawn> {
  return page.evaluate(() => {
    const round = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.width / 2 };
    };
    // The rings' own drawing, a point-sized layer under the people, which overflows it.
    const rings = document.querySelector('.react-flow svg[width="1"][height="1"]');
    return {
      arcs: rings ? rings.querySelectorAll("path").length : -1,
      rings: [...(rings?.querySelectorAll("circle") ?? [])].map(round),
      // Beside them, each ring's label (the tray of those not linked yet is a box, not one).
      labels: [
        ...(rings?.parentElement?.querySelectorAll(":scope > div.whitespace-nowrap") ?? []),
      ].map((label) => label.textContent?.trim() ?? ""),
      photos: [...document.querySelectorAll<HTMLElement>(".react-flow__node")].flatMap((node) => {
        const photo = node.querySelector(".person-photo");
        return photo ? [{ id: node.dataset.id ?? "", ...round(photo) }] : [];
      }),
    };
  });
}

/** Everyone on the tree in view, and drawn: React Flow draws only those in view. */
async function everyone(page: Page, graph: Graph): Promise<Drawn> {
  await page.getByRole("button", { name: "Show everyone" }).click();
  // The pointer off the tree: a photo pointed at grows.
  await page.mouse.move(1, 1);
  await expect(page.locator(".react-flow__node")).toHaveCount(graph.people.length);
  await settle(page);
  return drawn(page);
}

/**
 * Each married-in family on whole rings of its own: no arcs; the rings in sets around their own
 * middles; each married-in family's people inside one set, which holds nobody else; every set
 * clear of every other; no photo over another. And each ring said once: a family's own
 * rings their generation, a married-in family's no number, its oldest named for its couple.
 */
function onDiscs(graph: Graph, seen: Drawn): void {
  expect(seen.arcs, "rings drawn as arcs").toBe(0);
  const discs: { x: number; y: number; outer: number; rings: number; unit?: string }[] = [];
  for (const ring of seen.rings) {
    const disc = discs.find((each) => Math.hypot(each.x - ring.x, each.y - ring.y) < 1);
    if (disc) {
      disc.outer = Math.max(disc.outer, ring.r);
      disc.rings += 1;
    } else discs.push({ x: ring.x, y: ring.y, outer: ring.r, rings: 1 });
  }
  const unitOf = (id: string) => graph.layout.seats[id]?.unit ?? id;
  // Inside a set of rings, or touching its outermost.
  const within = (photo: Round, disc: (typeof discs)[number]) =>
    Math.hypot(photo.x - disc.x, photo.y - disc.y) <= disc.outer + photo.r;

  const married = graph.layout.units.filter((unit) => unit.anchor).map((unit) => unit.id);
  expect(married.length, "married-in families in the example family").toBeGreaterThanOrEqual(3);
  for (const unit of married) {
    const people = seen.photos.filter((photo) => unitOf(photo.id) === unit);
    expect(people.length, `${unit}'s people on the tree`).toBeGreaterThan(0);
    const holding = discs.filter((disc) => people.every((photo) => within(photo, disc)));
    expect(holding.length, `${unit}: one set of rings holding its people`).toBe(1);
  }
  for (const disc of discs) {
    const inside = seen.photos.filter((photo) => within(photo, disc));
    const units = new Set(inside.map((photo) => unitOf(photo.id)));
    expect([...units], "the people inside one set of rings: one family's").toHaveLength(1);
    disc.unit = [...units][0];
  }
  for (const [index, a] of discs.entries()) {
    for (const b of discs.slice(index + 1)) {
      expect(Math.hypot(a.x - b.x, a.y - b.y), "two sets of rings apart").toBeGreaterThan(
        a.outer + b.outer,
      );
    }
  }
  for (const [index, a] of seen.photos.entries()) {
    for (const b of seen.photos.slice(index + 1)) {
      expect(Math.hypot(a.x - b.x, a.y - b.y), "two photos apart").toBeGreaterThanOrEqual(
        a.r + b.r - 0.5,
      );
    }
  }
  const generations = seen.labels.filter((label) => /^Generation \d+$/.test(label));
  const own = discs.filter((disc) => !married.includes(disc.unit ?? ""));
  expect(generations.length, "each of a family's own rings, its generation").toBe(
    own.reduce((sum, disc) => sum + disc.rings, 0),
  );
  expect(seen.labels.length - generations.length, "each married-in family named once").toBe(
    married.length,
  );
}

test("Discs: each married-in family on whole rings of its own, kept when the page loads again", async ({
  page,
  picture,
  request,
}) => {
  const graph = (await (await request.get("/api/graph")).json()) as Graph;
  await page.goto("/tree");
  await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
  const layout = page.getByRole("group", { name: "The tree's tools" }).getByRole("button", {
    name: /^Layout: /,
  });

  await test.step("Fans, Discs and Tucked in, in that order; Fans the first choice", async () => {
    // As fans, a married-in family's rings are arcs.
    expect((await everyone(page, graph)).arcs, "arcs, as fans").toBeGreaterThan(0);
    await layout.click();
    const ways = page
      .getByRole("menu")
      .getByRole("group")
      .filter({ has: page.getByRole("menuitemradio", { name: /^Fans/ }) });
    await expect(ways.getByRole("menuitemradio")).toHaveText([/^Fans/, /^Discs/, /^Tucked in/]);
    await expect(ways.getByRole("menuitemradio", { name: /^Fans/ })).toBeChecked();
    await expect(ways.getByRole("menuitemradio", { name: /^Discs/ })).toContainText(
      "Each on whole rings of its own, apart from the others",
    );

    const saved = page.waitForResponse(
      (answer) => answer.url().endsWith("/api/settings") && answer.request().method() === "PUT",
    );
    await ways.getByRole("menuitemradio", { name: /^Discs/ }).click();
    expect((await saved).ok(), "Discs saved").toBe(true);
    await expect(page.getByRole("menu")).toBeHidden();
  });

  await test.step("each married-in family on whole rings of its own", async () => {
    await expect.poll(async () => (await drawn(page)).arcs, "no arcs, as discs").toBe(0);
    onDiscs(graph, await everyone(page, graph));
    await picture("discs");
  });

  await test.step("still Discs when the page loads again", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Ahmad bin Musa", exact: true })).toBeVisible();
    onDiscs(graph, await everyone(page, graph));
    await layout.click();
    await expect(page.getByRole("menuitemradio", { name: /^Discs/ })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    const settings = (await (await request.get("/api/settings")).json()) as { married_in: string };
    expect(settings.married_in).toBe("discs");
  });
});
