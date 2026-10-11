import { type InternalNode, type NodeHandle, Position } from "@xyflow/react";
import type { Point } from "./rings";

/*
 * A person on the canvas is a fixed 128 × 112 box: the photo at the top, the name below.
 * The sizes and handles are handed to React Flow up front, so it never has to measure
 * 2,000 people (and draw them all again) before the tree appears.
 */
export const NODE_WIDTH = 128;
export const NODE_HEIGHT = 112; // photo, two lines of name, the years
export const PHOTO = 56;
export const SMALL_PHOTO = 32; // an unknown parent's "?"
export const LINK_HANDLE = { left: NODE_WIDTH / 2 + PHOTO / 2 + 4, size: 20 }; // drag a new link

export function nodeSize(unknown: boolean): { width: number; height: number } {
  return { width: NODE_WIDTH, height: unknown ? SMALL_PHOTO : NODE_HEIGHT };
}

/** Where links hang (the photo's centre), and the handle a new link is dragged from. */
export function nodeHandles(unknown: boolean): NodeHandle[] {
  const centre = { x: NODE_WIDTH / 2, y: (unknown ? SMALL_PHOTO : PHOTO) / 2, width: 1, height: 1 };
  const handles: NodeHandle[] = [
    { id: "in", type: "target", position: Position.Top, ...centre },
    { id: "out", type: "source", position: Position.Bottom, ...centre },
  ];
  if (!unknown) {
    const { left, size } = LINK_HANDLE;
    handles.push({
      id: "link",
      type: "source",
      position: Position.Right,
      x: left,
      y: (PHOTO - size) / 2,
      width: size,
      height: size,
    });
  }
  return handles;
}

export function photoRadius(node: InternalNode): number {
  return (node.type === "unknown" ? SMALL_PHOTO : PHOTO) / 2;
}

/** Where a photo's centre is, given the node's top-left corner. */
export function photoCentre(node: InternalNode): Point {
  const { x, y } = node.internals.positionAbsolute;
  return { x: x + (node.measured.width ?? NODE_WIDTH) / 2, y: y + photoRadius(node) };
}

/** The top-left corner that puts a photo's centre at `point`. */
export function cornerFor(point: Point, unknown: boolean): Point {
  return { x: point.x - NODE_WIDTH / 2, y: point.y - (unknown ? SMALL_PHOTO : PHOTO) / 2 };
}

/** The point on a circle's rim that faces `toward`: links meet photos at their edge. */
export function rim(centre: Point, radius: number, toward: Point): Point {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: centre.x + (dx / length) * radius, y: centre.y + (dy / length) * radius };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export const ROUNDING = 72; // a routed link's corners are rounded, at most this far from each

/** Where a corner's rounding begins and ends: on the stretches either side of it, `radius`
 *  from the corner, or less where a stretch is short (half of it, so roundings never meet). */
export function cornerEnds(before: Point, at: Point, after: Point, radius = ROUNDING) {
  const [back, on] = [
    Math.hypot(before.x - at.x, before.y - at.y),
    Math.hypot(after.x - at.x, after.y - at.y),
  ];
  const reach = Math.min(radius, back / 2, on / 2);
  const towards = (to: Point, length: number): Point =>
    length
      ? { x: at.x + ((to.x - at.x) / length) * reach, y: at.y + ((to.y - at.y) / length) * reach }
      : at;
  return { start: towards(before, back), end: towards(after, on) };
}

/** A line through points, straight between them, with each corner rounded: a curve from the
 *  stretch before it to the stretch after, so it never kinks. Routed links are drawn so. */
export function roundedPath(points: Point[]): string {
  const [first] = points;
  const last = points.at(-1);
  if (!first || !last) return "";
  const parts = [`M ${first.x},${first.y}`];
  for (let index = 1; index + 1 < points.length; index++) {
    const [before, at, after] = [points[index - 1], points[index], points[index + 1]];
    if (!before || !at || !after) continue;
    const { start, end } = cornerEnds(before, at, after);
    parts.push(`L ${start.x},${start.y} Q ${at.x},${at.y} ${end.x},${end.y}`);
  }
  parts.push(`L ${last.x},${last.y}`);
  return parts.join(" ");
}

/** A path as the tree draws its links (made of M, L, Q and C, in absolute numbers, each
 *  letter and pair of numbers apart) as points along it: each curve in sixteen steps. */
export function pathPoints(path: string): Point[] {
  const points: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  // Each letter with the numbers after it.
  const pieces: [string, number[]][] = [];
  for (const word of path.split(/[\s,]+/)) {
    if (word === "M" || word === "L" || word === "Q" || word === "C") pieces.push([word, []]);
    else if (word) pieces.at(-1)?.[1].push(Number(word));
  }
  for (const [command, numbers] of pieces) {
    const next = (index: number): Point => ({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
    if (command === "C") {
      for (let index = 0; index + 5 < numbers.length; index += 6) {
        const [p0, p1, p2, p3] = [at, next(index), next(index + 2), next(index + 4)];
        for (let step = 1; step <= 16; step++) {
          const t = step / 16;
          const [a, b, c, d] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
          points.push({
            x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
            y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
          });
        }
        at = p3;
      }
    } else if (command === "Q") {
      for (let index = 0; index + 3 < numbers.length; index += 4) {
        const [p0, p1, p2] = [at, next(index), next(index + 2)];
        for (let step = 1; step <= 16; step++) {
          const t = step / 16;
          const [a, b, c] = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2];
          points.push({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y });
        }
        at = p2;
      }
    } else {
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        at = next(index);
        points.push(at);
      }
    }
  }
  return points;
}
