import { describe, expect, it } from "vitest";
import {
  bubbleRadius,
  flowerRadius,
  type Group,
  gather,
  levelAt,
  mergeTowns,
  NAMES_FROM,
  type Point,
  type Spot,
  STATES_FROM,
  separate,
  sunflower,
  TOWNS_FROM,
} from "./levels";

const spot = (id: string, x: number, y: number, more: Partial<Spot> = {}): Spot => ({
  id,
  x,
  y,
  place: "Shah Alam",
  state: "Selangor",
  country: "Malaysia",
  rough: false,
  ...more,
});

// On the plane: two in Shah Alam, one in Klang, one in Kota Bharu (Kelantan), one somewhere
// in Kelantan, one in Singapore, which has no states.
const SPOTS = [
  spot("ali", 10, 10),
  spot("siti", 10, 10),
  spot("abu", 12, 11, { place: "Klang" }),
  spot("hassan", 50, 1, { place: "Kota Bharu", state: "Kelantan" }),
  spot("mariam", 48, 3, { place: "Kelantan", state: "Kelantan", rough: true }),
  spot("yusof", 30, 40, { place: "Singapore", state: null, country: "Singapore" }),
];
const same = (p: Point) => p;
const middles: Record<string, Point> = { Selangor: { x: 11, y: 9 }, Kelantan: { x: 49, y: 2 } };
const middle = (state: string) => middles[state] ?? null;
const labels = (groups: Group[]) =>
  groups
    .map((g) => [g.label, g.members.length, g.rough])
    .sort(([a], [b]) => `${a}`.localeCompare(`${b}`));

describe("what the map shows at each zoom", () => {
  it("goes from countries to states to towns, then names", () => {
    expect(levelAt(STATES_FROM / 2)).toBe("countries");
    expect(levelAt(STATES_FROM)).toBe("states");
    expect(levelAt(TOWNS_FROM - 0.01)).toBe("states");
    expect(levelAt(TOWNS_FROM)).toBe("towns");
    expect(NAMES_FROM).toBeGreaterThan(TOWNS_FROM);
  });

  it("gathers people by country, by state at its middle, and by town", () => {
    expect(labels(gather(SPOTS, "countries", same, middle))).toEqual([
      ["Malaysia", 5, false],
      ["Singapore", 1, false],
    ]);
    const states = gather(SPOTS, "states", same, middle);
    expect(labels(states)).toEqual([
      ["Kelantan", 2, false], // not all of them are placed roughly
      ["Selangor", 3, false],
      ["Singapore", 1, false], // a country without states is its own
    ]);
    expect(states.find((g) => g.label === "Selangor")?.at).toEqual({ x: 11, y: 9 });
    expect(labels(gather(SPOTS, "towns", same, middle))).toEqual([
      ["Klang", 1, false],
      ["Kota Bharu", 1, false],
      ["Shah Alam", 2, false],
      ["Singapore", 1, false],
      ["Somewhere in Kelantan", 1, true],
    ]);
  });

  it("puts the biggest first", () => {
    expect(gather(SPOTS, "towns", same, middle)[0]?.label).toBe("Shah Alam");
  });
});

describe("keeping circles apart", () => {
  const circle = (key: string, x: number, y: number, members = 1): Group => ({
    key,
    label: key,
    at: { x, y },
    members: Array.from({ length: members }, (_, n) => `${key}${n}`),
    rough: false,
    towns: 1,
  });

  it("pushes overlapping circles apart, the smaller further, and leaves the others be", () => {
    const radius = (g: Group) => bubbleRadius(g.members.length);
    const [big, small, far] = separate(
      [circle("big", 100, 100, 50), circle("small", 105, 100, 1), circle("far", 400, 400)],
      radius,
    );
    if (!big || !small || !far) throw new Error("three circles");
    const apart = Math.hypot(big.at.x - small.at.x, big.at.y - small.at.y);
    expect(apart).toBeGreaterThanOrEqual(bubbleRadius(50) + bubbleRadius(1));
    expect(Math.abs(big.at.x - 100)).toBeLessThan(Math.abs(small.at.x - 105));
    expect(far.at).toEqual({ x: 400, y: 400 });
  });

  it("merges towns that would cover each other into one circle that counts its towns", () => {
    const merged = mergeTowns(
      [circle("Shah Alam", 100, 100, 5), circle("Klang", 110, 105, 2), circle("Ipoh", 600, 100, 3)],
      () => 20,
    );
    expect(merged.map((g) => [g.label, g.members.length, g.towns])).toEqual([
      ["Shah Alam", 7, 2],
      ["Ipoh", 3, 1],
    ]);
  });

  it("keeps circles no bigger than a state on a phone", () => {
    expect(bubbleRadius(1)).toBeLessThan(bubbleRadius(10));
    expect(bubbleRadius(10_000)).toBe(bubbleRadius(100));
  });
});

describe("a town's photos", () => {
  it("packs them like a sunflower: evenly, none on another, all within its reach", () => {
    const spacing = 38;
    const photos = sunflower(30, spacing);
    expect(photos[0]).toEqual({ x: 0, y: 0 });
    let closest = Number.POSITIVE_INFINITY;
    for (const [i, a] of photos.entries()) {
      for (const b of photos.slice(i + 1))
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(closest).toBeGreaterThan(spacing * 0.8);
    const reach = flowerRadius(30, spacing);
    for (const photo of photos)
      expect(Math.hypot(photo.x, photo.y) + spacing / 2).toBeLessThanOrEqual(reach + 0.01);
  });
});
