import { describe, expect, it } from "vitest";
import { FIT_PADDING, firstView, READABLE, readingOrder } from "./firstView";
import { NODE_HEIGHT, NODE_WIDTH, PHOTO } from "./geometry";
import type { Point } from "./rings";

/*
 * Where the tree opens: names that can be read, 11 pixels or more on screen, around
 * the family's centre; the whole family only where it can be read so.
 */

/** Someone whose photo's centre is at `point`, as the canvas places them. */
const at = ({ x, y }: Point) => ({ position: { x: x - NODE_WIDTH / 2, y: y - PHOTO / 2 } });
const SCREEN = { width: 1366, height: 630 };

describe("the first view", () => {
  it("shows a small family whole, never larger than life", () => {
    const view = firstView([at({ x: 0, y: 0 }), at({ x: 136, y: 0 })], null, SCREEN);
    expect(view?.zoom).toBe(1);
    expect(view?.centre).toEqual({ x: 68, y: NODE_HEIGHT / 2 - PHOTO / 2 });
  });

  it("shows a family whole where its names can still be read", () => {
    // 1,300 pixels across: a little smaller than life, it fits in 1,366 with room around it.
    const wide = [at({ x: 0, y: 0 }), at({ x: 1300 - NODE_WIDTH, y: 0 })];
    const view = firstView(wide, null, SCREEN);
    const fits = SCREEN.width / ((1 + FIT_PADDING) * 1300);
    expect(view?.zoom).toBeCloseTo(fits);
    expect(view?.zoom).toBeLessThan(1);
    expect(view?.zoom).toBeGreaterThanOrEqual(READABLE);
    // 1,400 across doesn't: it opens at READABLE instead.
    const wider = [at({ x: 0, y: 0 }), at({ x: 1400 - NODE_WIDTH, y: 0 })];
    expect(firstView(wider, null, SCREEN)?.zoom).toBe(READABLE);
  });

  it("opens a bigger family around its centre, names 11 pixels high", () => {
    // Rings around (0, 0), out to 1,050: too big to read whole.
    const people = [0, 210, 420, 630, 840, 1050].flatMap((radius) =>
      [0, 1, 2, 3].map((quarter) =>
        at({
          x: radius * Math.sin((quarter * Math.PI) / 2),
          y: -radius * Math.cos((quarter * Math.PI) / 2),
        }),
      ),
    );
    const view = firstView(people, { point: { x: 0, y: 0 }, at: "middle" }, SCREEN);
    expect(view).toEqual({ centre: { x: 0, y: 0 }, zoom: READABLE });
    expect(12 * READABLE).toBeGreaterThanOrEqual(11);
  });

  it("puts a family tree's oldest generation at the top", () => {
    const people = [0, 190, 380, 570, 760].flatMap((y) =>
      [-1000, 0, 1000].map((x) => at({ x, y })),
    );
    const view = firstView(people, { point: { x: 0, y: 0 }, at: "top" }, SCREEN);
    expect(view?.zoom).toBe(READABLE);
    // The top row's photos 72 pixels below the canvas's top edge.
    const top = SCREEN.height / 2 - ((view?.centre.y ?? 0) - 0) * READABLE;
    expect(top).toBeCloseTo(72);
    expect(view?.centre.x).toBe(0);
  });

  it("opens around whoever is nearest the centre, when a filter left nobody there", () => {
    const people = [at({ x: 2000, y: 0 }), at({ x: 4000, y: 0 }), at({ x: -3000, y: 0 })];
    const view = firstView(people, { point: { x: 0, y: 0 }, at: "middle" }, SCREEN);
    // Across, at them; up and down, the one row in the middle.
    expect(view).toEqual({ centre: { x: 2000, y: NODE_HEIGHT / 2 - PHOTO / 2 }, zoom: READABLE });
  });

  it("leaves no empty canvas beyond the family where there's more to show the other way", () => {
    // An hourglass from someone with no ancestors: them on top, their descendants below.
    const people = [
      at({ x: 0, y: 0 }),
      ...[190, 380, 570, 760].flatMap((y) => [-1000, 0, 1000].map((x) => at({ x, y }))),
    ];
    const view = firstView(people, { point: { x: 0, y: 0 }, at: "middle" }, SCREEN);
    expect(view?.zoom).toBe(READABLE);
    // Their photo in the top quarter of the canvas, not in its middle.
    const photo = SCREEN.height / 2 - (view?.centre.y ?? 0) * READABLE;
    expect(photo).toBeGreaterThan(0);
    expect(photo).toBeLessThan(SCREEN.height / 4);
    expect(view?.centre.x).toBe(0);
  });

  it("has nothing to show for nobody, or no canvas", () => {
    expect(firstView([], null, SCREEN)).toBeNull();
    expect(firstView([at({ x: 0, y: 0 })], null, { width: 0, height: 0 })).toBeNull();
  });
});

describe("the order Tab reaches people", () => {
  it("is as a page is read: a row at a time from the top, left to right", () => {
    const [a, b, c, d] = [
      { id: "a", ...at({ x: 300, y: 20 }) },
      { id: "b", ...at({ x: -300, y: 0 }) },
      { id: "c", ...at({ x: 0, y: 400 }) },
      { id: "d", ...at({ x: -500, y: 410 }) },
    ];
    expect(readingOrder([c, a, d, b]).map(({ id }) => id)).toEqual(["b", "a", "d", "c"]);
  });
});
