import { describe, expect, it } from "vitest";
import { type Box, boxOf, type Label, placeLabels, roomFor } from "./labels";

const SCREEN = { width: 800, height: 600 };
const town = (key: string, x: number, y: number, text = key): Label => ({
  key,
  text,
  at: { x, y },
  kind: "town",
});
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("placeLabels", () => {
  it("writes a town's name to the right of its dot, a district's on its middle", () => {
    const box = boxOf(town("Pasir Mas", 100, 100));
    expect(box.x0).toBeLessThan(100);
    expect(box.x1).toBeGreaterThan(100 + 9 * 5);
    const district = boxOf({ key: "d", text: "Tumpat", at: { x: 100, y: 100 }, kind: "district" });
    expect((district.x0 + district.x1) / 2).toBeCloseTo(100);
  });

  it("never writes one name over another: the one first in the list stays", () => {
    const placed = placeLabels(
      [town("Kota Bharu", 100, 100), town("Pasir Mas", 110, 102), town("Tumpat", 100, 200)],
      [],
      SCREEN,
    );
    expect(placed.map((label) => label.key)).toEqual(["Kota Bharu", "Tumpat"]);
  });

  it("never covers the family's photos and circles", () => {
    const photos: Box = { x0: 80, y0: 80, x1: 160, y1: 160 };
    const placed = placeLabels(
      [town("Under", 100, 120), town("Beside", 200, 120)],
      [photos],
      SCREEN,
    );
    expect(placed.map((label) => label.key)).toEqual(["Beside"]);
  });

  it("writes only names wholly on screen", () => {
    const placed = placeLabels(
      [
        town("Off", -20, 100),
        town("Edge", 790, 100),
        town("Below", 100, 700),
        town("In", 300, 300),
      ],
      [],
      SCREEN,
    );
    expect(placed.map((label) => label.key)).toEqual(["In"]);
  });

  it("keeps thousands apart, quickly", () => {
    const many = Array.from({ length: 4000 }, (_, i) =>
      town(`Kampung ${i}`, (i * 37) % 780, (i * 53) % 590),
    );
    const started = performance.now();
    const placed = placeLabels(many, [], SCREEN);
    expect(performance.now() - started).toBeLessThan(250);
    expect(placed.length).toBeGreaterThan(50);
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) expect(overlap(a.box, b.box)).toBe(false);
    }
  });
});

describe("roomFor", () => {
  it("names a district once it's big enough on screen to hold its name", () => {
    const tumpat = { width: 20, height: 25 }; // on the plane
    expect(roomFor(tumpat, 1, "Tumpat")).toBe(false);
    expect(roomFor(tumpat, 4, "Tumpat")).toBe(true);
    expect(roomFor({ width: 20, height: 1 }, 4, "Tumpat")).toBe(false); // a thin one, not yet
  });
});
