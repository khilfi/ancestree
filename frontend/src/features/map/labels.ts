/*
 * The names on the map: the family's circles', and besides them each district's and the
 * towns' around the family's places. A name is written only
 * where it covers no other name, none of the family's photos and circles, and neither of the
 * map's corners, its buttons and its credits; the most worth reading first, and only on screen.
 * Plain arithmetic, tested without a browser.
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
// 6.4 at most at 11 px, a place's 5.9 and a district's 5.8 at 10 px: a little more here, for
// phones' fonts, and each grown by as much as its text, now 12 px for all three.
const LETTER: Record<LabelKind, number> = { town: 7.4, place: 7.6, district: 7.4 };
const LINE: Record<LabelKind, number> = { town: 16, place: 17, district: 16 };
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

// The map's own buttons, in its bottom left corner (`MapButtons`), with room around them.
const BUTTONS = { width: 48, height: 112 };

/** The map's corners, which no name covers: its buttons, bottom left, and its
 *  credits, bottom right, as big as they're drawn. */
export function corners(
  size: { width: number; height: number },
  credits: { width: number; height: number },
): Box[] {
  const { width, height } = size;
  return [
    { x0: 0, y0: height - BUTTONS.height, x1: BUTTONS.width, y1: height },
    { x0: width - credits.width, y0: height - credits.height, x1: width, y1: height },
  ];
}

/** Whether a district is big enough on screen to hold its name, with room to spare. */
export function roomFor(area: { width: number; height: number }, k: number, name: string): boolean {
  return (
    area.width * k * 0.6 >= name.length * LETTER.district && area.height * k * 0.6 >= LINE.district
  );
}

export const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const CELL = 64;

/** What's on screen already, on a grid, so whether a new box covers any of it takes a moment
 *  however many there are. */
function room(taken: readonly Box[], size: { width: number; height: number }) {
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
  /** Whether a box is wholly on screen and covers nothing kept. */
  const free = (box: Box) =>
    box.x0 >= 0 &&
    box.y0 >= 0 &&
    box.x1 <= size.width &&
    box.y1 <= size.height &&
    !cells(box).some((key) => grid.get(key)?.some((other) => overlaps(box, other)));
  return { free, keep };
}

/**
 * The names written, in the order given: each only where it's on screen and covers nothing
 * written before it, nor anything `taken`. On a grid, so thousands take a moment.
 */
export function placeLabels(
  labels: readonly Label[],
  taken: readonly Box[],
  size: { width: number; height: number },
): Placed[] {
  const { free, keep } = room(taken, size);
  const placed: Placed[] = [];
  for (const label of labels) {
    const box = boxOf(label);
    if (!free(box)) continue;
    keep(box);
    placed.push({ ...label, box });
  }
  return placed;
}

/** Where a circle's name is written: under it, as it always was, else over it, to its right or
 *  its left. */
export type Side = "below" | "above" | "right" | "left";
const SIDES: readonly Side[] = ["below", "above", "right", "left"];

/** One of the family's circles, a town's photos or a pin, with its name: how far it reaches
 *  from `at` on screen each way, and how wide its name may be before it's cut short. */
export type Named = {
  key: string;
  text: string;
  at: Point;
  reach: { up: number; down: number; left: number; right: number };
  widest: number;
};
export type NamePlace = { side: Side; box: Box };

// A circle's name, in pixels: measured in the app on 19 Nov 2026, its letters (12 px, medium)
// came to 6.3 on average and 6.8 at most in a short name: a little more here, for phones' fonts,
// with its padding either side, and its line.
const NAME_LETTER = 7;
const NAME_PADDING = 8;
const NAME_LINE = 16;
const NAME_GAP = 2;

/** The box a circle's name takes on one side of it. */
export function nameBox(named: Named, side: Side): Box {
  const width = Math.min(named.widest, named.text.length * NAME_LETTER + NAME_PADDING);
  const { x, y } = named.at;
  const { up, down, left, right } = named.reach;
  switch (side) {
    case "below":
      return {
        x0: x - width / 2,
        y0: y + down + NAME_GAP,
        x1: x + width / 2,
        y1: y + down + NAME_GAP + NAME_LINE,
      };
    case "above":
      return {
        x0: x - width / 2,
        y0: y - up - NAME_GAP - NAME_LINE,
        x1: x + width / 2,
        y1: y - up - NAME_GAP,
      };
    case "right":
      return {
        x0: x + right + NAME_GAP,
        y0: y - NAME_LINE / 2,
        x1: x + right + NAME_GAP + width,
        y1: y + NAME_LINE / 2,
      };
    case "left":
      return {
        x0: x - left - NAME_GAP - width,
        y0: y - NAME_LINE / 2,
        x1: x - left - NAME_GAP,
        y1: y + NAME_LINE / 2,
      };
  }
}

/** Where the family's circle itself is on screen. */
export function bodyOf(named: Named): Box {
  const { x, y } = named.at;
  const { up, down, left, right } = named.reach;
  return { x0: x - left, y0: y - up, x1: x + right, y1: y + down };
}

/**
 * Each circle's name: never over another name, any of the family's circles and photos,
 * anything `taken` (the map's buttons and credits), nor off screen. Under its circle where
 * there's room, else over it, to its right or to its left; else not written, its circle's hint
 * and the list still saying it. In the order given, the biggest first; a name with no text takes
 * no room.
 */
export function placeNames(
  shapes: readonly Named[],
  taken: readonly Box[],
  size: { width: number; height: number },
): Map<string, NamePlace | null> {
  const { free, keep } = room([...taken, ...shapes.map(bodyOf)], size);
  const placed = new Map<string, NamePlace | null>();
  for (const named of shapes) {
    if (!named.text) continue;
    const side = SIDES.find((each) => free(nameBox(named, each)));
    if (!side) {
      placed.set(named.key, null);
      continue;
    }
    const box = nameBox(named, side);
    keep(box);
    placed.set(named.key, { side, box });
  }
  return placed;
}
