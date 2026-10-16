/**
 * A bundle on the map: named by its eldest; where it is;
 * and whether a click opens it where it is or zooms in. One spot: pins
 * within about 2 m one pin, standing in columns when opened, and each its own at the deepest.
 * Made-up people at a made-up house on the plane.
 */
import { describe, expect, it } from "vitest";
import type { GraphPerson } from "@/api/types";
import {
  bundleName,
  bundlePlace,
  eldestFirst,
  fanned,
  firstFew,
  opensHere,
  SPOT_KM,
  spreadKm,
  stacked,
} from "./bundles";
import { onPlane, PLANE_PER_KM } from "./geo";
import { DEEPEST_PER_KM, gather, oneSpots, type Spot } from "./levels";
import { familyGroups } from "./places";

const HOME = { lat: 2.99312, lon: 101.78791 }; // a made-up house in Kajang
const METRE = 1 / 111_320; // a metre north, in degrees

function spot(id: string, metresNorth: number, more: Partial<Spot> = {}): Spot {
  const [x, y] = onPlane(HOME.lat + metresNorth * METRE, HOME.lon);
  return {
    id,
    x,
    y,
    place: "Kajang",
    district: "Hulu Langat",
    state: "Selangor",
    country: "Malaysia",
    rough: false,
    exact: "hand",
    address: "No. 8, Jalan Kenari 2",
    ...more,
  };
}

const person = (id: string, full_name: string, more: Partial<GraphPerson> = {}) =>
  [id, { id, full_name, nickname: null, birth_year: null, born: null, ...more }] as const;
const PEOPLE = new Map([
  person("ali", "Aminah binti Hassan", { birth_year: 1962 }),
  person("nora", "Zulkifli bin Hassan", { birth_year: 1965 }),
  person("mak", "Fatimah binti Yusof", { born: { year: 1941, qualifier: "about" } as never }),
]) as unknown as Map<string, GraphPerson>;
const none = () => undefined;

describe("people at one spot", () => {
  // Three at one house, a metre or two apart as pins put by hand are; a child 6 m away.
  const three = [spot("ali", 0), spot("nora", 1.5), spot("mak", 0.8)];
  const reach = SPOT_KM * PLANE_PER_KM;

  it("makes pins within about 2 m one spot, named by its address", () => {
    const found = oneSpots(three, reach);
    expect(new Set([...found.values()].map((one) => one.key)).size).toBe(1);
    expect(found.get("mak")?.label).toBe("No. 8, Jalan Kenari 2");
    const groups = gather(
      three,
      "towns",
      (p) => p,
      () => null,
      (id) => found.get(id),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
    expect(groups[0]?.about).toBe(false); // exactly there, by hand
  });

  it("gives a child 6 m away a spot of their own, and none to those only about there", () => {
    const found = oneSpots(
      [
        ...three,
        spot("child", 6, { address: "No. 10, Jalan Kenari 2" }),
        spot("town", 3, { exact: "town" }),
      ],
      reach,
    );
    expect(found.get("child")?.key).not.toBe(found.get("ali")?.key);
    expect(found.get("child")?.label).toBe("No. 10, Jalan Kenari 2");
    expect(found.has("town")).toBe(false);
  });

  it("stands a child 6 m away apart at the map's deepest, and with their parents above it", () => {
    const k = DEEPEST_PER_KM / PLANE_PER_KM; // zoom 19: 6 m is 20 pixels
    const near = [...three, spot("child", 6)];
    const at = (p: { x: number; y: number }) => ({ x: p.x * k, y: p.y * k });
    const deepest = familyGroups(near, "towns", at, true, 64, true);
    expect(deepest.map((group) => group.members.length).sort()).toEqual([1, 3]);
    const above = familyGroups(
      near,
      "towns",
      (p) => ({ x: p.x * k * 0.5, y: p.y * k * 0.5 }),
      true,
      64,
    );
    expect(above).toHaveLength(1); // their pins would cover each other: one circle
    expect(above[0]?.towns).toBe(2);
  });
});

describe("an opened spot's columns", () => {
  it("stands 8 to a column, the next beside it, and a card past 5 columns", () => {
    expect(stacked(3, 20)).toEqual({ perColumn: 8, columns: 1, card: false });
    expect(stacked(20, 20)).toEqual({ perColumn: 8, columns: 3, card: false });
    expect(stacked(40, 20).card).toBe(false);
    expect(stacked(41, 20).card).toBe(true);
  });

  it("puts fewer in a column where the window is short", () => {
    expect(stacked(20, 4)).toEqual({ perColumn: 4, columns: 5, card: false });
    expect(stacked(20, 3).card).toBe(true);
    expect(stacked(2, 0)).toEqual({ perColumn: 1, columns: 2, card: false });
  });
});

describe("a bundle's name and place", () => {
  it("is named by its eldest, an approximate date counting by its year", () => {
    const eldest = eldestFirst(["ali", "nora", "mak"], PEOPLE, none);
    expect(eldest).toEqual(["mak", "ali", "nora"]);
    expect(bundleName(eldest, PEOPLE)).toBe("Fatimah and 2 more");
    expect(firstFew(eldest, PEOPLE)).toBe("Fatimah, Aminah, Zulkifli");
    expect(firstFew([...eldest, "x", "y"], PEOPLE)).toBe("Fatimah, Aminah, Zulkifli and 2 more");
  });

  it("puts those with no date of birth after, by their generation on the rings, then name", () => {
    const people = new Map([
      ...PEOPLE,
      ...([
        person("tok", "Tok Daud"),
        person("abu", "Abu bin Daud"),
        person("zed", "Zainal bin Daud"),
      ] as unknown as [string, GraphPerson][]),
    ]);
    const generation = (id: string) => ({ tok: 1, abu: 2, zed: 2 })[id];
    expect(eldestFirst(["zed", "ali", "abu", "tok"], people, generation)).toEqual([
      "ali",
      "tok",
      "abu",
      "zed",
    ]);
  });

  it("says where its people are, the most of them first", () => {
    const spots = new Map([
      ["ali", spot("ali", 0)],
      ["nora", spot("nora", 6)],
      ["far", spot("far", 9000, { place: "Klang", district: "Hulu Langat" })],
    ]);
    expect(bundlePlace(["ali", "nora"], (id) => spots.get(id))).toBe("Kajang, Hulu Langat");
    expect(bundlePlace(["ali", "nora", "far"], (id) => spots.get(id))).toBe(
      "Kajang, Hulu Langat and 1 more place",
    );
  });
});

describe("opening a bundle where it is, or zooming in", () => {
  const spots = new Map([
    ["ali", spot("ali", 0)],
    ["nora", spot("nora", 6)],
    ["mak", spot("mak", 3)],
    ["far", spot("far", 5000)],
  ]);
  const spotOf = (id: string) => spots.get(id);

  it("opens where it is when its people are within about 30 m", () => {
    expect(spreadKm(["ali", "nora", "mak"], spotOf)).toBeCloseTo(0.006, 3);
    expect(opensHere(["ali", "nora", "mak"], spotOf, false)).toBe(true);
  });

  it("zooms in where that would part them, but not past the map's deepest", () => {
    expect(opensHere(["ali", "far"], spotOf, false)).toBe(false);
    expect(opensHere(["ali", "far"], spotOf, true)).toBe(true);
  });

  it("fans its photos out around its spot, apart enough for their names", () => {
    const { at, radius } = fanned(12, 90);
    expect(at).toHaveLength(12);
    expect(at[0]).toEqual({ x: expect.closeTo(0, 6), y: -radius });
    const gap = Math.hypot((at[1]?.x ?? 0) - (at[0]?.x ?? 0), (at[1]?.y ?? 0) - (at[0]?.y ?? 0));
    expect(gap).toBeGreaterThan(80); // a name under a photo is 80 px wide
  });
});
