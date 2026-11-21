import { describe, expect, it } from "vitest";
import { EXAMPLE_SPOTS, JOURNEY_MAPS } from "./examplePlaces";
import {
  AROUND,
  cameraOf,
  firstView,
  framed,
  into,
  MALAYSIA,
  type Size,
  type View,
  viewOf,
} from "./fit";
import { fromPlane, PLANE_PER_KM } from "./geo";
import { levelAt, PHOTO, type Point } from "./levels";
import { familyGroups } from "./places";
import { zoomFor } from "./style";

/*
 * The map's first view, and what a click on a country's or a state's circle zooms to, on the
 * example family's places: 54 in Malaysia, 7 in Singapore, 3 in Australia.
 */

const onScreen = (view: View) => (p: Point) => ({
  x: p.x * view.k + view.x,
  y: p.y * view.k + view.y,
});
const shownAt = (view: View) =>
  familyGroups(EXAMPLE_SPOTS, levelAt(view.k * PLANE_PER_KM), onScreen(view), false, PHOTO + 4);
const SIZES: [string, Size][] = [
  ["1366 × 768", JOURNEY_MAPS.wide],
  ["800 × 600", JOURNEY_MAPS.small],
  ["1024 × 768, someone's panel open", { width: 584, height: 625 }],
];
const among = (state: string) => EXAMPLE_SPOTS.filter((spot) => spot.state === state);

describe("the map's first view", () => {
  it.each(SIZES)("shows every place the family is at, at %s", (_, size) => {
    const view = firstView(EXAMPLE_SPOTS, size);
    for (const spot of EXAMPLE_SPOTS) {
      const at = onScreen(view)(spot);
      expect(at.x, spot.place).toBeGreaterThanOrEqual(AROUND.left - 0.01);
      expect(at.x, spot.place).toBeLessThanOrEqual(size.width - AROUND.right + 0.01);
      expect(at.y, spot.place).toBeGreaterThanOrEqual(AROUND.top - 0.01);
      expect(at.y, spot.place).toBeLessThanOrEqual(size.height - AROUND.bottom + 0.01);
    }
    // Until 0.9.0 it opened on Malaysia: Borneo in the middle, Australia's people out of sight.
    const before = framed(MALAYSIA, size, 24);
    const brunswick = EXAMPLE_SPOTS.find((spot) => spot.country === "Australia") as Point;
    expect(onScreen(before)(brunswick).y).toBeGreaterThan(size.height);
  });

  it.each(SIZES)("shows a circle for each country there, apart, at %s", (_, size) => {
    const shown = shownAt(firstView(EXAMPLE_SPOTS, size));
    // Malaysia's ten states would have no room so small: its one circle instead.
    expect(shown.level).toBe("countries");
    expect(shown.groups.map((group) => [group.label, group.members.length])).toEqual([
      ["Malaysia", 54],
      ["Singapore", 7],
      ["Australia", 3],
    ]);
  });

  it("opens on Malaysia while no one is placed", () => {
    expect(firstView([], JOURNEY_MAPS.wide)).toEqual(framed(MALAYSIA, JOURNEY_MAPS.wide, 24));
  });

  it("shows one place alone at the towns", () => {
    const view = firstView(among("Victoria"), JOURNEY_MAPS.small);
    expect(levelAt(view.k * PLANE_PER_KM)).toBe("towns");
  });
});

describe("a click on a country's or a state's circle", () => {
  const click = (key: string, members: Point[], now: View, size: Size) =>
    into(members, now, size, (then) => !shownAt(then).groups.some((group) => group.key === key));
  const malaysians = EXAMPLE_SPOTS.filter((spot) => spot.country === "Malaysia");

  it.each(SIZES)("parts Malaysia into its states, at %s", (_, size) => {
    const then = click("Malaysia", malaysians, firstView(EXAMPLE_SPOTS, size), size);
    const shown = shownAt(then);
    expect(shown.level).toBe("states");
    expect(shown.groups.map((group) => group.label)).toContain("Kelantan");
  });

  it.each(SIZES)("parts Kelantan into its towns, at %s", (_, size) => {
    // As the journeys found: at 800 × 600, zooming in three times over left Kelantan's
    // circle where it was.
    const states = click("Malaysia", malaysians, firstView(EXAMPLE_SPOTS, size), size);
    const then = click("Malaysia|Kelantan", among("Kelantan"), states, size);
    const shown = shownAt(then);
    expect(shown.level).toBe("towns");
    expect(shown.groups.some((group) => group.key === "Malaysia|Kelantan")).toBe(false);
    // Every one of Kelantan's people in view.
    for (const spot of among("Kelantan")) {
      const at = onScreen(then)(spot);
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(size.width);
      expect(at.y).toBeGreaterThan(0);
      expect(at.y).toBeLessThan(size.height);
    }
  });

  it("always zooms in, at least half as much again", () => {
    const size = JOURNEY_MAPS.small;
    const near = framed({ x0: 0, y0: 0, x1: 2, y1: 2 }, size, 0);
    const then = into(among("Kelantan"), near, size, () => true);
    expect(then.k).toBeGreaterThanOrEqual(near.k * 1.5);
  });
});

describe("MapLibre's camera for a view of the plane", () => {
  it("is the same view: its middle, and its zoom", () => {
    const size = JOURNEY_MAPS.wide;
    const view = firstView(EXAMPLE_SPOTS, size);
    const camera = cameraOf(view, size);
    const middle = fromPlane(
      (size.width / 2 - view.x) / view.k,
      (size.height / 2 - view.y) / view.k,
    );
    expect(camera.center[0]).toBeCloseTo(middle.lon, 6);
    expect(camera.center[1]).toBeCloseTo(middle.lat, 6);
    // A kilometre at the equator takes as many pixels in both.
    expect(camera.zoom).toBeCloseTo(zoomFor(view.k * PLANE_PER_KM, 0), 2);
    const back = viewOf({ lon: camera.center[0], lat: camera.center[1] }, camera.zoom, size);
    expect(back.k).toBeCloseTo(view.k, 6);
    expect(back.x).toBeCloseTo(view.x, 3);
    expect(back.y).toBeCloseTo(view.y, 3);
  });

  it("puts each place where the plane does", () => {
    const size = JOURNEY_MAPS.small;
    const view = firstView(EXAMPLE_SPOTS, size);
    const camera = cameraOf(view, size);
    // MapLibre's Mercator: 512 pixels for the world at zoom 0.
    const world = 512 * 2 ** camera.zoom;
    const mercator = (lat: number, lon: number) => ({
      x: ((lon + 180) / 360) * world,
      y: ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * world,
    });
    const middle = mercator(camera.center[1], camera.center[0]);
    for (const spot of EXAMPLE_SPOTS) {
      const { lat, lon } = fromPlane(spot.x, spot.y);
      const there = mercator(lat, lon);
      const ours = onScreen(view)(spot);
      expect(there.x - middle.x + size.width / 2).toBeCloseTo(ours.x, 0);
      expect(there.y - middle.y + size.height / 2).toBeCloseTo(ours.y, 0);
    }
  });
});
