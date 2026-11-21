import { describe, expect, it } from "vitest";
import type { GraphPerson } from "@/api/types";
import { EXAMPLE_NAMES, EXAMPLE_SPOTS, JOURNEY_MAPS } from "./examplePlaces";
import { firstView, into, type Size, type View } from "./fit";
import { PLANE_PER_KM } from "./geo";
import { type Box, corners, type Named, nameBox, overlaps, placeNames } from "./labels";
import { levelAt, NAMES_FROM, PHOTO, type Point } from "./levels";
import { familyGroups, groupNames } from "./places";

/*
 * The names of the family's circles: never over one another, over a circle,
 * photos or a pin, nor over the map's buttons and credits, on the example family's places.
 */

const CREDITS = { width: 350, height: 24 };
const people = new Map(
  [...EXAMPLE_NAMES].map(([id, full_name]) => [
    id,
    { id, full_name, nickname: null, birth_year: null, born: null } as unknown as GraphPerson,
  ]),
);
const onScreen = (view: View) => (p: Point) => ({
  x: p.x * view.k + view.x,
  y: p.y * view.k + view.y,
});

/** The family's circles at a view, and their names, as today's map draws them. */
function drawn(view: View, size: Size) {
  const perKm = view.k * PLANE_PER_KM;
  const withNames = perKm >= NAMES_FROM;
  const spacing = withNames ? PHOTO + 30 : PHOTO + 4;
  const shown = familyGroups(EXAMPLE_SPOTS, levelAt(perKm), onScreen(view), withNames, spacing);
  const naming = { withNames, spacing, people, generationOf: () => undefined };
  const { names } = groupNames(shown.groups, shown.level, naming, corners(size, CREDITS), size);
  return { shown, names };
}

/** The views the journeys see: the first, then Malaysia's states, then Kelantan's towns. */
function views(size: Size): [string, View][] {
  const first = firstView(EXAMPLE_SPOTS, size);
  const parted = (key: string) => (then: View) =>
    !drawn(then, size).shown.groups.some((group) => group.key === key);
  const malaysians = EXAMPLE_SPOTS.filter((spot) => spot.country === "Malaysia");
  const states = into(malaysians, first, size, parted("Malaysia"));
  const kelantan = EXAMPLE_SPOTS.filter((spot) => spot.state === "Kelantan");
  const towns = into(kelantan, states, size, parted("Malaysia|Kelantan"));
  const selangor = EXAMPLE_SPOTS.filter((spot) => spot.state === "Selangor");
  const closer = into(selangor, states, size, parted("Malaysia|Selangor"));
  return [
    ["the first view", first],
    ["Malaysia's states", states],
    ["Kelantan's towns", towns],
    ["Selangor's towns", closer],
  ];
}

describe("the names of the family's circles", () => {
  for (const [window, size] of [
    ["1366 × 768", JOURNEY_MAPS.wide],
    ["800 × 600", JOURNEY_MAPS.small],
  ] as const) {
    for (const [where, view] of views(size)) {
      it(`never cover one another, a circle or the map's corners: ${where}, at ${window}`, () => {
        const { shown, names } = drawn(view, size);
        const boxes = [...names.values()].map((name) => name.box);
        expect(boxes.length).toBeGreaterThan(0);
        for (const [index, box] of boxes.entries()) {
          for (const other of boxes.slice(index + 1)) expect(overlaps(box, other)).toBe(false);
          for (const corner of corners(size, CREDITS)) expect(overlaps(box, corner)).toBe(false);
          expect(box.x0).toBeGreaterThanOrEqual(0);
          expect(box.y0).toBeGreaterThanOrEqual(0);
          expect(box.x1).toBeLessThanOrEqual(size.width);
          expect(box.y1).toBeLessThanOrEqual(size.height);
        }
        // Nor any circle: a country's or state's, at the most a circle's radius out.
        if (shown.level !== "towns") {
          for (const group of shown.groups) {
            const r = 12 + 2.5 * Math.sqrt(group.members.length);
            const circle = {
              x0: group.at.x - r,
              y0: group.at.y - r,
              x1: group.at.x + r,
              y1: group.at.y + r,
            };
            for (const box of boxes) expect(overlaps(box, circle)).toBe(false);
          }
        }
      });
    }
  }

  it.each([
    ["1366 × 768", JOURNEY_MAPS.wide],
    ["800 × 600", JOURNEY_MAPS.small],
  ] as const)("name every country at the first view, at %s", (_, size) => {
    const { names } = drawn(firstView(EXAMPLE_SPOTS, size), size);
    expect([...names.values()].map((name) => name.text).sort()).toEqual([
      "Australia",
      "Malaysia",
      "Singapore",
    ]);
  });

  it("name most of Malaysia's ten states, wherever there's room", () => {
    const [, states] = views(JOURNEY_MAPS.wide)[1] as [string, View];
    const { shown, names } = drawn(states, JOURNEY_MAPS.wide);
    expect(shown.level).toBe("states");
    expect(names.size).toBeGreaterThanOrEqual(8);
  });
});

describe("placeNames", () => {
  const SCREEN = { width: 800, height: 600 };
  const circle = (key: string, x: number, y: number, text = key): Named => ({
    key,
    text,
    at: { x, y },
    reach: { up: 20, down: 20, left: 20, right: 20 },
    widest: 160,
  });

  it("writes a name under its circle where there's room, as before", () => {
    const placed = placeNames([circle("Kelantan", 400, 300)], [], SCREEN);
    expect(placed.get("Kelantan")?.side).toBe("below");
  });

  it("writes it over its circle, or beside it, where the room under it is taken", () => {
    // Two circles one above the other: the upper one's name can't go under it.
    const placed = placeNames(
      [circle("Pahang", 400, 330), circle("Kelantan", 400, 280)],
      [],
      SCREEN,
    );
    expect(placed.get("Pahang")?.side).toBe("below");
    expect(placed.get("Kelantan")?.side).toBe("above");
  });

  it("keeps clear of the map's credits, as the town names do", () => {
    // Kuantan's photos near the window's bottom right, as in map-kelantan-1366x768.
    const size = { width: 1078, height: 625 };
    const kuantan = {
      ...circle("Kuantan", 750, 560),
      reach: { up: 50, down: 50, left: 50, right: 50 },
    };
    const credits = corners(size, CREDITS)[1] as Box;
    expect(overlaps(nameBox(kuantan, "below"), credits)).toBe(true);
    const placed = placeNames([kuantan], corners(size, CREDITS), size);
    const box = placed.get("Kuantan")?.box as Box;
    expect(overlaps(box, credits)).toBe(false);
    expect(placed.get("Kuantan")?.side).toBe("above");
  });

  it("leaves a name out where there's no room on any side, the biggest named first", () => {
    const crowd = [
      circle("Selangor", 400, 300),
      ...[-44, 44].flatMap((dx) =>
        [-44, 0, 44].map((dy) => circle(`${dx}|${dy}`, 400 + dx, 300 + dy)),
      ),
      circle("Putrajaya", 400, 256),
      circle("Kuala Lumpur", 400, 344),
    ];
    const placed = placeNames(crowd, [], SCREEN);
    expect(placed.get("Selangor")).toBeNull();
    const boxes = [...placed.values()].flatMap((place) => (place ? [place.box] : []));
    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) expect(overlaps(box, other)).toBe(false);
    }
  });

  it("gives a nameless pin no room", () => {
    const placed = placeNames([circle("spot:one", 400, 300, "")], [], SCREEN);
    expect(placed.has("spot:one")).toBe(false);
  });
});
