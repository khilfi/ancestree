/**
 * A bundle on the map: people at one house as one place;
 * a bundle named by its eldest; where it is; and whether a click opens it where it is or zooms
 * in. Made-up people at a made-up house on the plane: three pins 6 m apart, as the report had
 * them.
 */
import { describe, expect, it } from "vitest";
import type { GraphPerson } from "@/api/types";
import {
  bundleName,
  bundlePlace,
  eldestFirst,
  fanned,
  firstFew,
  HOUSE_KM,
  opensHere,
  spreadKm,
} from "./bundles";
import { onPlane, PLANE_PER_KM } from "./geo";
import { gather, houses, type Spot } from "./levels";

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

describe("people at one house", () => {
  const three = [spot("ali", 0), spot("nora", 6), spot("mak", 3)];
  const reach = HOUSE_KM * PLANE_PER_KM;

  it("makes pins within about 15 m in one town one place, named by its address", () => {
    const found = houses(three, reach);
    expect(new Set([...found.values()].map((house) => house.key)).size).toBe(1);
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

  it("keeps a neighbour 40 m away, another town's pin, and those only about there apart", () => {
    const found = houses(
      [
        ...three,
        spot("far", 40),
        spot("next", 4, { place: "Kapar" }),
        spot("town", 5, { exact: "town" }),
      ],
      reach,
    );
    expect([...found.keys()].sort()).toEqual(["ali", "mak", "nora"]);
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
