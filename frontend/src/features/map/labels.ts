/*
 * The names on the map besides the family's: each district's,
 * and the towns' around the family's places. A name is written only where it covers no other
 * name and none of the family's photos and circles, the most worth reading first, and only on
 * screen. Plain arithmetic, tested without a browser.
 */

import type { Point } from "./levels";

/** A town this big is named from a state's zoom; smaller ones closer (services/places.py). */
export const BIG_TOWN = 1_000; // people

export type LabelKind = "town" | "place" | "district"; // a place: a kampung or a small town
export type Label = { key: string; text: string; at: Point; kind: LabelKind };
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Placed = Label & { box: Box };

// How wide each letter of a name is at most, and how tall a name is, in screen pixels, with
// no browser to measure them. Measured in the app on 10 Oct 2026, a town's letters came to
// 6.4 at most, a place's 5.9 and a district's 5.8: a little more here, for phones' fonts.
const LETTER: Record<LabelKind, number> = { town: 6.8, place: 6.3, district: 6.2 };
const LINE: Record<LabelKind, number> = { town: 15, place: 14, district: 13 };
const DOT = 10; // a town's dot, then a gap, before its name

/** Where a name goes: a district's centred on its middle, a town's to the right of its dot. */
export function boxOf(label: Label): Box {
  const width = label.text.length * LETTER[label.kind];
  const half = LINE[label.kind] / 2;
  const { x, y } = label.at;
  return label.kind === "district"
    ? { x0: x - width / 2, y0: y - half, x1: x + width / 2, y1: y + half }
    : { x0: x - DOT / 2, y0: y - half, x1: x + DOT + width, y1: y + half };
}

/** Whether a district is big enough on screen to hold its name, with room to spare. */
export function roomFor(area: { width: number; height: number }, k: number, name: string): boolean {
  return (
    area.width * k * 0.6 >= name.length * LETTER.district && area.height * k * 0.6 >= LINE.district
  );
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const CELL = 64;

/**
 * The names written, in the order given: each only where it's on screen and covers nothing
 * written before it, nor anything `taken`. On a grid, so thousands take a moment.
 */
export function placeLabels(
  labels: readonly Label[],
  taken: readonly Box[],
  size: { width: number; height: number },
): Placed[] {
  const grid = new Map<string, Box[]>();
  const cells = (box: Box) => {
    const keys: string[] = [];
    for (let cx = Math.floor(box.x0 / CELL); cx <= Math.floor(box.x1 / CELL); cx++) {
      for (let cy = Math.floor(box.y0 / CELL); cy <= Math.floor(box.y1 / CELL); cy++) {
        keys.push(`${cx}|${cy}`);
      }
    }
    return keys;
  };
  const keep = (box: Box) => {
    for (const key of cells(box)) {
      const here = grid.get(key);
      if (here) here.push(box);
      else grid.set(key, [box]);
    }
  };
  for (const box of taken) keep(box);
  const placed: Placed[] = [];
  for (const label of labels) {
    const box = boxOf(label);
    if (box.x0 < 0 || box.y0 < 0 || box.x1 > size.width || box.y1 > size.height) continue;
    if (cells(box).some((key) => grid.get(key)?.some((other) => overlaps(box, other)))) continue;
    keep(box);
    placed.push({ ...label, box });
  }
  return placed;
}
