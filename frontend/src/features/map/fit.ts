/*
 * Where the map looks: its first view, fitted to every
 * place the family is shown at, and what a click on a country's or a state's circle zooms to,
 * its people fitted, deep enough that the circle parts. Worked out on the plane (geo.ts) for both
 * drawings: MapLibre's is the same Mercator, so a view of the plane is a camera of MapLibre's
 * (`cameraOf`). Plain arithmetic, tested without a browser.
 */

import { BASE, fromPlane, onPlane, PLANE_PER_KM } from "./geo";
import type { Box } from "./labels";
import { DEEPEST_PER_KM, type Point } from "./levels";

/** A view of the plane: screen = plane × k + (x, y). */
export type View = { k: number; x: number; y: number };
export type Size = { width: number; height: number };
export type Padding = { top: number; right: number; bottom: number; left: number };

export const MIN_K = 0.04; // the whole world
// As deep as MapLibre's zoom 19: a child a few metres from their parents stands apart.
export const MAX_K = DEEPEST_PER_KM / PLANE_PER_KM;
/** Malaysia, as the map opened until 0.9.0, and as it opens with no one placed. */
export const MALAYSIA: Box = { x0: 20, y0: 20, x1: BASE.width - 20, y1: BASE.height - 20 };
/** A person found alone is shown at the towns: about three screen pixels a kilometre. */
export const ONE_PERSON_K = 3 / PLANE_PER_KM;

/**
 * Room around the family's places at the first view: for a circle and the name under it, and
 * clear of the map's buttons (bottom left) and its credits (bottom right).
 */
export const AROUND: Padding = { top: 48, right: 56, bottom: 72, left: 72 };
/** Room around the people of a circle zoomed into, or brought into view from the list. */
export const AROUND_FEW = 90;

const sides = (padding: number | Padding): Padding =>
  typeof padding === "number"
    ? { top: padding, right: padding, bottom: padding, left: padding }
    : padding;

/** The view that shows a box of the plane whole, as big as the screen allows less `padding`,
 *  and no deeper than `most`. */
export function framed(box: Box, size: Size, padding: number | Padding, most = MAX_K): View {
  const room = sides(padding);
  const width = Math.max(box.x1 - box.x0, 1e-6);
  const height = Math.max(box.y1 - box.y0, 1e-6);
  const across = Math.max(1, size.width - room.left - room.right);
  const down = Math.max(1, size.height - room.top - room.bottom);
  const k = Math.min(most, Math.max(MIN_K, Math.min(across / width, down / height)));
  // The box's middle at the middle of the room left for it.
  const middle = { x: room.left + across / 2, y: room.top + down / 2 };
  return {
    k,
    x: middle.x - k * (box.x0 + width / 2),
    y: middle.y - k * (box.y0 + height / 2),
  };
}

/** The box around some points of the plane; null for none. */
export function around(points: readonly Point[]): Box | null {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The view that shows these points: all of them, with room around; one place alone (all
 *  within about a kilometre), at the towns. Malaysia for none. */
export function fitted(points: readonly Point[], size: Size, padding: number | Padding): View {
  const box = around(points);
  if (!box) return framed(MALAYSIA, size, 24);
  const alone = box.x1 - box.x0 < 1 && box.y1 - box.y0 < 1;
  if (alone) {
    const middle = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    return framed(
      { x0: middle.x - 1, y0: middle.y - 1, x1: middle.x + 1, y1: middle.y + 1 },
      size,
      padding,
      ONE_PERSON_K,
    );
  }
  return framed(box, size, padding);
}

/** The map's first view: every place the family is shown at, all of them in view, with
 *  room for their circles and names. Malaysia while no one is placed. */
export function firstView(points: readonly Point[], size: Size): View {
  return fitted(points, size, AROUND);
}

/**
 * Zooming into a circle's people: fitted to them, then deeper still while `parted` says the
 * circle hasn't yet parted into its states or towns, a step at a time around them; never
 * shallower than `from`, and never past the deepest.
 */
export function into(
  points: readonly Point[],
  from: View,
  size: Size,
  parted: (view: View) => boolean,
): View {
  let view = fitted(points, size, AROUND_FEW);
  const box = around(points);
  const middle = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : null;
  const at = (k: number): View =>
    middle
      ? { k, x: size.width / 2 - k * middle.x, y: size.height / 2 - k * middle.y }
      : { ...view, k };
  if (view.k < from.k * 1.5) view = at(Math.min(MAX_K, from.k * 1.5));
  for (let step = 0; step < 12 && view.k < MAX_K && !parted(view); step++) {
    view = at(Math.min(MAX_K, view.k * 1.5));
  }
  return view;
}

/** What MapLibre shows for a view of the plane on a screen of this size: the point at its
 *  middle, and its zoom, the plane and MapLibre's map being one Mercator. */
export function cameraOf(view: View, size: Size): { center: [number, number]; zoom: number } {
  const { lat, lon } = fromPlane(
    (size.width / 2 - view.x) / view.k,
    (size.height / 2 - view.y) / view.k,
  );
  return { center: [lon, lat], zoom: zoomOf(view.k) };
}

/** The view of the plane MapLibre shows, from the point at its middle and its zoom. */
export function viewOf(center: { lat: number; lon: number }, zoom: number, size: Size): View {
  const k = kOf(zoom);
  const [px, py] = onPlane(center.lat, center.lon);
  return { k, x: size.width / 2 - k * px, y: size.height / 2 - k * py };
}

// MapLibre's world is 512 pixels across at zoom 0, doubling with each zoom; the plane's is 2π
// times its projection's scale, PLANE_PER_KM being that scale over the Earth's 6,371 km.
const WORLD_KM = 2 * Math.PI * 6371;
const TILE = 512;
const zoomOf = (k: number) => Math.log2((k * PLANE_PER_KM * WORLD_KM) / TILE);
const kOf = (zoom: number) => (TILE * 2 ** zoom) / (PLANE_PER_KM * WORLD_KM);
