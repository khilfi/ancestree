import { NODE_HEIGHT, NODE_WIDTH, PHOTO } from "./geometry";
import type { Point } from "./rings";

/*
 * Where the tree opens: names that can be read, not everyone as dots. A name is 12
 * pixels high at life size, so at READABLE or nearer it's 11 pixels or larger on screen. The
 * whole family is shown where it fits so, never larger than life; otherwise as many as fit at
 * READABLE, around the family's centre. **Show everyone** (and F) still frames the whole family.
 */

/** The zoom at which a name, 12 pixels at life size, is 11 on screen: 11.04, clear of rounding. */
export const READABLE = 0.92;
/** Room around the family when it all fits, as React Flow's fitting counts it: a share of the
 *  canvas's width and height. */
export const FIT_PADDING = 0.12;
/** The top row of a family tree, top to bottom, this far below the canvas's top edge. */
const TOP_MARGIN = 72;

/** Someone on the canvas, as React Flow places them: the top-left corner, and the size. */
type Placed = { position: Point; width?: number; height?: number };

/** What the view opens around: a point at its middle, or the oldest generation's row at its top
 *  (the family tree, top to bottom). */
export type Around = { point: Point; at: "middle" | "top" };

export type View = { centre: Point; zoom: number };

/** The view the tree opens on, in a canvas of `size`; null when nobody's shown. */
export function firstView(
  nodes: readonly Placed[],
  around: Around | null,
  size: { width: number; height: number },
): View | null {
  if (nodes.length === 0 || size.width <= 0 || size.height <= 0) return null;
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { position, width = NODE_WIDTH, height = NODE_HEIGHT } of nodes) {
    left = Math.min(left, position.x);
    top = Math.min(top, position.y);
    right = Math.max(right, position.x + width);
    bottom = Math.max(bottom, position.y + height);
  }
  const fits = Math.min(
    size.width / ((1 + FIT_PADDING) * Math.max(right - left, 1)),
    size.height / ((1 + FIT_PADDING) * Math.max(bottom - top, 1)),
  );
  const middle = { x: (left + right) / 2, y: (top + bottom) / 2 };
  if (fits >= READABLE) return { centre: middle, zoom: Math.min(fits, 1) };

  // Around the centre; or, when a filter left nobody there, around whoever is nearest it.
  const zoom = READABLE;
  const { point, at } = around ?? { point: middle, at: "middle" };
  const reach = Math.min(size.width, size.height) / 2 / zoom;
  let nearest: Point | null = null;
  let away = Infinity;
  for (const { position, width = NODE_WIDTH } of nodes) {
    const photo = { x: position.x + width / 2, y: position.y + PHOTO / 2 };
    const distance = Math.hypot(photo.x - point.x, photo.y - point.y);
    if (distance < away) [nearest, away] = [photo, distance];
  }
  const centre =
    nearest && away > reach
      ? nearest
      : at === "top"
        ? { x: point.x, y: point.y + (size.height / 2 - TOP_MARGIN) / zoom }
        : point;
  // No empty canvas beyond the family where there's more of it to show the other way: an
  // hourglass with no ancestors opens with its person near the top, not halfway down.
  const keep = (value: number, low: number, high: number, span: number) => {
    const room = FIT_PADDING * span; // the same room around it as when it all fits
    if (high - low + 2 * room <= span) return (low + high) / 2;
    return Math.min(Math.max(value, low - room + span / 2), high + room - span / 2);
  };
  return {
    centre: {
      x: keep(centre.x, left, right, size.width / zoom),
      y: keep(centre.y, top, bottom, size.height / zoom),
    },
    zoom,
  };
}

/** The people in the order Tab reaches them: as a page is read, a row at a time from the
 *  top, left to right along each. A row is as high as a person, so people on a ring's slope
 *  are read across it rather than zigzagging. */
export function readingOrder<T extends Placed>(nodes: readonly T[]): T[] {
  const row = (node: T) => Math.round(node.position.y / NODE_HEIGHT);
  return nodes.toSorted((a, b) => row(a) - row(b) || a.position.x - b.position.x);
}
