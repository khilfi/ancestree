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
