import type { Graph } from "@/api/types";
import { type ChildEdgeData, childPath } from "../edges";
import { PHOTO, pathPoints, rim, SMALL_PHOTO } from "../geometry";
import { allFamilies, ringLayout, type Way } from "../placing";
import type { Point, Ring, RingLayout } from "../rings";
import { routable, routeLinks } from "../routing";
import { toFlow } from "../toFlow";

/*
 * What spike S7 measures of each way, for each family: photos
 * overlapping (any: the way is out); photos a line passes over; one family's rings crossing
 * another family's people; lines crossing lines; the drawing's size and its longest line; how
 * far the others move when one family is unfolded; and the time it takes to lay out. With the
 * links between families routed through the openings, and the photos under lines
 * and the lines crossing as they were before, with those links straight, beside them.
 */

export type Measures = {
  overlaps: number; // pairs of photos that overlap
  underLines: number; // a line passing over a photo not its own, each time
  underBetween: number; // of those, a link between families passing over one
  underBefore: number; // as underLines, with the links between families straight, as before
  ringsCrossing: number; // a family's ring through another family's photo, each time
  crossings: number; // pairs of lines that cross
  crossingsBefore: number; // the same, with the links between families straight, as before
  between: number; // links between families, or of kinds not on the rings: those routed
  width: number; // the drawing, in the tree's pixels
  height: number;
  longest: number; // the longest line, in the tree's pixels
};

export type Line = { people: Set<string>; points: Point[]; between: boolean };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Each link as the tree draws it: a child's line from between their parents, curving around
 *  the middle of their rings, or routed through the openings when it leaves their family,
 *  or with `route` false, straight, as before; a couple's straight between their photos. */
export function linesOf(graph: Graph, layout: RingLayout, route = true): Line[] {
  const { edges } = toFlow(graph, layout, "off", { saved: false, route });
  const placeholder = new Set(graph.people.filter((p) => p.placeholder).map((p) => p.id));
  const radius = (id: string) => (placeholder.has(id) ? SMALL_PHOTO : PHOTO) / 2;
  const centre = (id: string) => layout.points.get(id) ?? { x: 0, y: 0 };
  return edges.map((edge) => {
    if (edge.type === "child") {
      const data = edge.data as ChildEdgeData;
      const path = childPath(
        { centre: centre(edge.source), radius: radius(edge.source) },
        data.partner ? centre(data.partner) : null,
        { centre: centre(edge.target), radius: radius(edge.target) },
        data,
      );
      const people = new Set([edge.source, edge.target, ...(data.partner ? [data.partner] : [])]);
      return { people, points: pathPoints(path), between: routable(graph, edge) };
    }
    const [a, b] = [centre(edge.source), centre(edge.target)];
    return {
      people: new Set([edge.source, edge.target]),
      points: [rim(a, radius(edge.source), b), rim(b, radius(edge.target), a)],
      between: false,
    };
  });
}

/** How near a point comes to a segment. */
function toSegment(point: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0;
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether two segments cross, touching at an end not counted. */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const [d1, d2] = [cross(a, b, c), cross(a, b, d)];
  const [d3, d4] = [cross(c, d, a), cross(c, d, b)];
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Points kept in square cells, `size` across. */
function cells<T>(size: number) {
  const found = new Map<string, T[]>();
  const key = (x: number, y: number) => `${Math.floor(x / size)},${Math.floor(y / size)}`;
  return {
    add(point: Point, item: T) {
      const at = key(point.x, point.y);
      const list = found.get(at);
      if (list) list.push(item);
      else found.set(at, [item]);
    },
    /** Everything in the cells a box from `a` to `b` covers, `pad` around. */
    within(a: Point, b: Point, pad: number): T[] {
      const items: T[] = [];
      const [x0, x1] = [
        Math.floor((Math.min(a.x, b.x) - pad) / size),
        Math.floor((Math.max(a.x, b.x) + pad) / size),
      ];
      const [y0, y1] = [
        Math.floor((Math.min(a.y, b.y) - pad) / size),
        Math.floor((Math.max(a.y, b.y) + pad) / size),
      ];
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) items.push(...(found.get(`${x},${y}`) ?? []));
      }
      return items;
    },
  };
}

/** Whether an angle (as `polar` counts it) lies within an arc's span. */
function onArc(ring: Ring, point: Point): boolean {
  if (!ring.span) return true;
  const angle = Math.atan2(point.y - ring.y, point.x - ring.x) + Math.PI / 2;
  const turn = (((angle - ring.span.from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return turn <= ring.span.to - ring.span.from;
}

/** How many pairs of lines cross, not counting lines that meet at a person. Each stretch of a
 *  line is kept by the middle of every piece of it, half a cell long, so that a long straight
 *  line is found wherever another crosses it (S7 kept it by its middle alone, and missed some). */
export function crossings(lines: Line[]): number {
  const segments = cells<{ line: number; a: Point; b: Point }>(200);
  lines.forEach((line, index) => {
    for (let step = 0; step + 1 < line.points.length; step++) {
      const [a, b] = [line.points[step], line.points[step + 1]];
      if (!a || !b) continue;
      const pieces = Math.max(1, Math.ceil(distance(a, b) / 100));
      for (let piece = 0; piece < pieces; piece++) {
        const t = (piece + 0.5) / pieces;
        segments.add({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, { line: index, a, b });
      }
    }
  });
  const crossed = new Set<string>();
  lines.forEach((line, index) => {
    for (let step = 0; step + 1 < line.points.length; step++) {
      const [a, b] = [line.points[step], line.points[step + 1]];
      if (!a || !b) continue;
      for (const other of segments.within(a, b, 200)) {
        if (other.line <= index) continue;
        const pair = `${index}|${other.line}`;
        if (crossed.has(pair)) continue;
        const otherLine = lines[other.line];
        if (!otherLine || [...line.people].some((id) => otherLine.people.has(id))) continue;
        if (segmentsCross(a, b, other.a, other.b)) crossed.add(pair);
      }
    }
  });
  return crossed.size;
}

/** Everything but the move and the times, of one layout. */
export function measure(graph: Graph, layout: RingLayout): Measures {
  const shown = graph.people.filter((p) => layout.points.has(p.id) && !layout.hidden.has(p.id));
  const radius = new Map(shown.map((p) => [p.id, (p.placeholder ? SMALL_PHOTO : PHOTO) / 2]));
  const at = (id: string) => layout.points.get(id) ?? { x: 0, y: 0 };
  const photos = cells<string>(SMALL_PHOTO * 4);
  for (const person of shown) photos.add(at(person.id), person.id);

  let overlaps = 0;
  for (const person of shown) {
    const centre = at(person.id);
    for (const other of photos.within(centre, centre, PHOTO)) {
      if (other <= person.id) continue;
      if (distance(centre, at(other)) < (radius.get(person.id) ?? 0) + (radius.get(other) ?? 0)) {
        overlaps++;
      }
    }
  }

  /** Photos lines pass over, each time: under any line, and under links between families. */
  const under = (lines: Line[]) => {
    let [all, between] = [0, 0];
    for (const line of lines) {
      const passed = new Set<string>();
      for (let index = 0; index + 1 < line.points.length; index++) {
        const [a, b] = [line.points[index] ?? at(""), line.points[index + 1] ?? at("")];
        for (const other of photos.within(a, b, PHOTO)) {
          if (line.people.has(other) || passed.has(other)) continue;
          if (toSegment(at(other), a, b) < (radius.get(other) ?? 0) - 2) passed.add(other);
        }
      }
      all += passed.size;
      if (line.between) between += passed.size;
    }
    return [all, between] as const;
  };
  const lines = linesOf(graph, layout);
  const straight = linesOf(graph, layout, false);
  const [underLines, underBetween] = under(lines);

  let ringsCrossing = 0;
  const unitOf = (id: string) => graph.layout.seats[id]?.unit ?? "";
  // Families on the same rings (tucked in) sit on them, as their own do.
  const middle = (unit: string) => layout.middles.get(unit);
  const sharing = (unit: string, ring: Ring) => {
    const [a, b] = [middle(unit), middle(ring.unit)];
    return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;
  };
  for (const ring of layout.rings) {
    for (const person of shown) {
      if (unitOf(person.id) === ring.unit || sharing(unitOf(person.id), ring)) continue;
      const centre = at(person.id);
      const off = Math.abs(distance(centre, ring) - ring.radius);
      if (off < (radius.get(person.id) ?? 0) && onArc(ring, centre)) ringsCrossing++;
    }
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const person of shown) {
    const centre = at(person.id);
    xs.push(centre.x - 64, centre.x + 64);
    ys.push(centre.y - 28, centre.y + 84);
  }
  for (const ring of layout.rings) {
    const from = ring.span ? ring.span.from : 0;
    const to = ring.span ? ring.span.to : 2 * Math.PI;
    for (let step = 0; step <= 16; step++) {
      const angle = from + ((to - from) * step) / 16;
      xs.push(ring.x + ring.radius * Math.sin(angle));
      ys.push(ring.y - ring.radius * Math.cos(angle));
    }
  }
  const length = (line: Line) =>
    line.points
      .slice(1)
      .reduce((sum, point, index) => sum + distance(point, line.points[index] ?? point), 0);
  return {
    overlaps,
    underLines,
    underBetween,
    underBefore: under(straight)[0],
    ringsCrossing,
    crossings: crossings(lines),
    crossingsBefore: crossings(straight),
    between: lines.filter((line) => line.between).length,
    width: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
    longest: Math.max(0, ...lines.map(length)),
  };
}

/** How far the others move, at most, when one married-in family is unfolded, the rest open:
 *  for each of the `most` biggest families. */
export function unfoldMove(graph: Graph, way: Way, most = 12): number {
  const everyone = allFamilies(graph);
  const opened = ringLayout(graph, everyone, way);
  const biggest = graph.layout.units
    .filter((unit) => unit.anchor)
    .toSorted((a, b) => b.size - a.size)
    .slice(0, most);
  let moved = 0;
  for (const unit of biggest) {
    const folded = ringLayout(graph, new Set([...everyone].filter((id) => id !== unit.id)), way);
    for (const [id, point] of folded.points) {
      if (folded.hidden.has(id) || opened.hidden.has(id)) continue;
      const now = opened.points.get(id);
      if (now) moved = Math.max(moved, distance(point, now));
    }
  }
  return moved;
}

/** The time a layout takes, in milliseconds: the quickest of a few. */
export function layoutTime(graph: Graph, way: Way, tries = 3): number {
  const everyone = allFamilies(graph);
  let quickest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < tries; attempt++) {
    const started = performance.now();
    ringLayout(graph, everyone, way);
    quickest = Math.min(quickest, performance.now() - started);
  }
  return quickest;
}

/** The time routing the links between families takes, once laid out: the quickest of a few. */
export function routeTime(graph: Graph, way: Way, tries = 3): number {
  const layout = ringLayout(graph, allFamilies(graph), way);
  const { nodes, edges } = toFlow(graph, layout, "off", { saved: false });
  let quickest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < tries; attempt++) {
    const started = performance.now();
    routeLinks(graph, nodes, edges);
    quickest = Math.min(quickest, performance.now() - started);
  }
  return quickest;
}
