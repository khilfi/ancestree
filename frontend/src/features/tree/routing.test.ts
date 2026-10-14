import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, GraphPerson, LayoutUnit, Seat } from "@/api/types";
import { type ChildEdgeData, childPath } from "./edges";
import { PHOTO, pathPoints, roundedPath } from "./geometry";
import { allFamilies, ringLayout, WAYS, type Way } from "./placing";
import type { Point, RingLayout } from "./rings";
import { routable, routeLinks } from "./routing";
import { linesOf, measure } from "./sideBySide/measures";
import { type TreeEdge, toFlow } from "./toFlow";

/*
 * Links between families routed through the openings: around every photo, across
 * other lines only where they must, beside each other where they share a way, the same every
 * time, and quick at 2,000 people. First on people placed by hand, then on a family seated as
 * the tree seats it, each of the four ways.
 */

function person(id: string): GraphPerson {
  return {
    id,
    full_name: id,
    nickname: null,
    gender: "unknown",
    birth_year: null,
    death_year: null,
    birth_order: null,
    placeholder: false,
    photo_version: null,
    has_story: false,
    birthplace: null,
    x: null,
    y: null,
  };
}

function seat(unit: string, generation = 1, fields: Partial<Seat> = {}): Seat {
  return { unit, generation, parent: null, order: 0, partner_of: null, branch: null, ...fields };
}

let next = 0;
function link(
  type: "parent" | "spouse",
  source: string,
  target: string,
  kind: string | null = type === "parent" ? "biological" : null,
): GraphLink {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    type,
    source,
    target,
    kind,
    status: type === "spouse" ? "married" : null,
    in_layout: kind === null || kind === "biological",
  };
}

/** A graph and a layout with everyone where `points` puts them. */
function placed(seats: Record<string, Seat>, links: GraphLink[], points: Record<string, Point>) {
  const graph: Graph = {
    people: Object.keys(seats).map(person),
    links,
    layout: { units: [], seats, unlinked: [], centre_chosen: false },
  };
  const layout: RingLayout = {
    points: new Map(Object.entries(points)),
    rings: [],
    hidden: new Set(),
    folds: new Map(),
    tray: null,
    middles: new Map(),
  };
  return { graph, layout };
}

/** Each routed link's line as it's drawn, with the photos it may meet: its own people's. */
function routedLines(graph: Graph, layout: RingLayout) {
  const { nodes, edges } = toFlow(graph, layout, "off", { saved: false, route: true });
  const centre = (id: string) => layout.points.get(id) ?? { x: 0, y: 0 };
  return {
    nodes,
    lines: edges.flatMap((edge) => {
      const data = edge.data as ChildEdgeData;
      if (edge.type !== "child" || !data.route) return [];
      const path = childPath(
        { centre: centre(edge.source), radius: PHOTO / 2 },
        data.partner ? centre(data.partner) : null,
        { centre: centre(edge.target), radius: PHOTO / 2 },
        data,
      );
      const own = new Set([edge.source, edge.target, data.partner ?? ""]);
      return [{ id: edge.id, own, points: pathPoints(path) }];
    }),
  };
}

const toSegment = (point: Point, a: Point, b: Point) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
};

/** How near a line comes to any photo not its own, from its rim. */
function nearestPhoto(line: { own: Set<string>; points: Point[] }, layout: RingLayout): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const [id, centre] of layout.points) {
    if (line.own.has(id)) continue;
    for (let index = 0; index + 1 < line.points.length; index++) {
      const [a, b] = [line.points[index], line.points[index + 1]];
      if (a && b) nearest = Math.min(nearest, toSegment(centre, a, b) - PHOTO / 2);
    }
  }
  return nearest;
}

describe("a link between families, placed by hand", () => {
  // P and Q's son S married into the family at the centre. Straight, his link from his parents
  // would pass over O, and across G and H's marriage.
  const seats: Record<string, Seat> = {
    p: seat("cluster:s"),
    q: seat("cluster:s", 1, { partner_of: "p" }),
    s: seat("main:0", 2),
    o: seat("main:0", 2),
    g: seat("main:0", 2),
    h: seat("main:0", 2, { partner_of: "g" }),
  };
  const links = [
    link("spouse", "p", "q"),
    link("parent", "p", "s"),
    link("parent", "q", "s"),
    link("spouse", "g", "h"),
  ];
  const points = {
    p: { x: -600, y: 0 },
    q: { x: -464, y: 0 },
    o: { x: 0, y: 0 },
    g: { x: 300, y: -68 },
    h: { x: 300, y: 68 },
    s: { x: 640, y: 0 },
  };
  const { graph, layout } = placed(seats, links, points);

  it("goes around every photo, half a photo's width clear, and across no line", () => {
    const straight = linesOf(graph, layout, false).find((line) => line.between);
    expect(
      straight && nearestPhoto({ own: straight.people, points: straight.points }, layout),
    ).toBeLessThan(0);

    const { lines } = routedLines(graph, layout);
    expect(lines).toHaveLength(1);
    const [routed] = lines;
    // Half a photo's width along its straight stretches; a little less where a corner's rounded.
    expect(routed && nearestPhoto(routed, layout)).toBeGreaterThanOrEqual(9);
    const measured = measure(graph, layout);
    expect(measured.underBetween).toBe(0);
    expect(measured.underBefore).toBe(1);
    expect(measured.crossingsBefore).toBe(1);
    expect(measured.crossings).toBe(0);
  });

  it("starts at the dot between the parents and ends at the child's rim, with an arrow", () => {
    const { lines } = routedLines(graph, layout);
    const points = lines[0]?.points ?? [];
    expect(points[0]).toEqual({ x: -532, y: 0 });
    const end = points.at(-1) ?? { x: 0, y: 0 };
    expect(Math.hypot(end.x - 640, end.y)).toBeCloseTo(PHOTO / 2 + 3);
  });

  it("is the same every time", () => {
    const route = () => {
      const { edges } = toFlow(graph, layout, "off", { saved: false, route: true });
      return edges.map((edge) => (edge.data as ChildEdgeData).route ?? null);
    };
    expect(route()).toEqual(route());
  });

  it("is drawn from the routes worked out already, as the canvas does", () => {
    const routeOf = (edges: TreeEdge[]) =>
      (edges.find((edge) => edge.id === "family:s")?.data as ChildEdgeData | undefined)?.route;
    const route = routeOf(toFlow(graph, layout, "off", { saved: false, route: true }).edges);
    expect(route).toBeDefined();
    const again = toFlow(graph, layout, "branch", {
      saved: false,
      routes: new Map([["family:s", route ?? []]]),
    });
    expect(routeOf(again.edges)).toBe(route);
  });
});

describe("links that share a way", () => {
  // P and Q's two sons both married into the family at the centre, beside each other: their
  // links leave the same dot, and run side by side, not on top of each other.
  const seats: Record<string, Seat> = {
    p: seat("cluster:s"),
    q: seat("cluster:s", 1, { partner_of: "p" }),
    s: seat("main:0", 2),
    t: seat("main:0", 2),
    o: seat("main:0", 2),
  };
  const links = [
    link("spouse", "p", "q"),
    ...["s", "t"].flatMap((child) => [link("parent", "p", child), link("parent", "q", child)]),
  ];
  const points = {
    p: { x: -600, y: 0 },
    q: { x: -464, y: 0 },
    o: { x: 0, y: 0 },
    s: { x: 700, y: -68 },
    t: { x: 700, y: 68 },
  };
  const { graph, layout } = placed(seats, links, points);

  it("runs beside the other, away from where they meet", () => {
    const { lines } = routedLines(graph, layout);
    expect(lines).toHaveLength(2);
    const [one, two] = lines;
    // Apart from near the dot they leave from, and near their ends, they never touch.
    const far = (point: Point) =>
      Math.hypot(point.x + 532, point.y) > 2 * PHOTO && Math.abs(point.x - 700) > 2 * PHOTO;
    let closest = Number.POSITIVE_INFINITY;
    for (const point of (one?.points ?? []).filter(far)) {
      for (let index = 0; index + 1 < (two?.points.length ?? 0); index++) {
        const [a, b] = [two?.points[index], two?.points[index + 1]];
        if (a && b) closest = Math.min(closest, toSegment(point, a, b));
      }
    }
    expect(closest).toBeGreaterThanOrEqual(6);
    for (const line of lines) expect(nearestPhoto(line, layout)).toBeGreaterThan(0);
  });
});

describe("a link of a kind not on the rings", () => {
  it("is routed too, around the photos in its way", () => {
    // A guardian, in the same family as the child they look after, with someone between.
    const seats: Record<string, Seat> = {
      w: seat("main:0", 1),
      o: seat("main:0", 2),
      c: seat("main:0", 3),
    };
    const { graph, layout } = placed(seats, [link("parent", "w", "c", "guardian")], {
      w: { x: 0, y: 0 },
      o: { x: 0, y: 250 },
      c: { x: 0, y: 500 },
    });
    const { lines } = routedLines(graph, layout);
    expect(lines).toHaveLength(1);
    expect(lines[0] && nearestPhoto(lines[0], layout)).toBeGreaterThan(0);
  });
});

describe("rounded corners", () => {
  it("are straight between the points, and curve at each", () => {
    const path = roundedPath([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ]);
    expect(path).toBe("M 0,0 L 128,0 Q 200,0 200,72 L 200,200");
    const points = pathPoints(path);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 200, y: 200 });
    // Halfway round, the curve is inside the corner, nearer it than the stretches' ends.
    const halfway = points[1 + 8] ?? { x: 0, y: 0 };
    expect(halfway.x).toBeCloseTo(182);
    expect(halfway.y).toBeCloseTo(18);
  });

  it("are smaller where a stretch is short", () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 200 },
      ]),
    ).toBe("M 0,0 L 20,0 Q 40,0 40,20 L 40,200");
  });
});

/** A made-up family of `size`, with its links: each couple has four children, three of whom
 *  marry, and every seventh who marries brings their parents and two brothers or sisters. */
function bigFamily(size: number): Graph {
  const seats: Record<string, Seat> = {
    p0: seat("main:0", 1),
    p1: seat("main:0", 1, { partner_of: "p0" }),
  };
  const units: LayoutUnit[] = [
    { id: "main:0", centre: ["p0"], anchor: null, anchor_seat: null, size: 0 },
  ];
  const links: GraphLink[] = [link("spouse", "p0", "p1")];
  const waiting: [string, string, number][] = [["p0", "p1", 1]];
  let count = 2;
  let marriages = 0;
  while (count < size && waiting.length) {
    const [parent, other, generation] = waiting.shift() ?? ["", "", 0];
    for (let order = 0; order < 4 && count < size; order++) {
      const child = `p${count++}`;
      seats[child] = seat("main:0", generation + 1, { parent, order });
      links.push(link("parent", parent, child), link("parent", other, child));
      if (order === 3 || count >= size) continue;
      const spouse = `p${count++}`;
      seats[spouse] = seat("main:0", generation + 1, { partner_of: child });
      links.push(link("spouse", child, spouse));
      waiting.push([child, spouse, generation + 1]);
      if (++marriages % 7 || count + 4 > size) continue;
      const family = `cluster:${spouse}`;
      const [father, mother] = [`p${count}`, `p${count + 1}`];
      seats[father] = seat(family, 1);
      seats[mother] = seat(family, 1, { partner_of: father });
      links.push(link("spouse", father, mother));
      for (const [index, kid] of [spouse, `p${count + 2}`, `p${count + 3}`].entries()) {
        if (index > 0) seats[kid] = seat(family, 2, { parent: father, order: index });
        links.push(link("parent", father, kid), link("parent", mother, kid));
      }
      count += 4;
      units.push({
        id: family,
        centre: [father],
        anchor: spouse,
        anchor_seat: seat(family, 2, { parent: father, order: 0 }),
        size: 4,
      });
    }
  }
  return {
    people: Object.keys(seats).map(person),
    links,
    layout: { units, seats, unlinked: [], centre_chosen: false },
  };
}

describe("each way, at 2,000 people with every family open", () => {
  const thousands = bigFamily(2000);
  const open = allFamilies(thousands);

  it.each(WAYS.map(({ way }) => way))(
    "%s: every link between families routed, over no photo, fewer crossings, quickly",
    (way) => {
      const layout = ringLayout(thousands, open, way as Way);
      const { nodes, edges } = toFlow(thousands, layout, "off", { saved: false });
      // The quickest of a few: the other tests run beside these, and take turns with them. On
      // its own, it's 25 to 75 ms, tucked in the slowest.
      let quickest = Number.POSITIVE_INFINITY;
      let routed: TreeEdge[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = performance.now();
        routed = routeLinks(thousands, nodes, edges);
        quickest = Math.min(quickest, performance.now() - started);
      }
      expect(quickest).toBeLessThan(200);
      // Each link between families routed; inside a family, each keeps its curve.
      const route = (edge: TreeEdge) => (edge.data as ChildEdgeData | undefined)?.route;
      const between = routed.filter((edge) => routable(thousands, edge));
      expect(between.length).toBeGreaterThan(50);
      expect(between.every((edge) => route(edge))).toBe(true);
      expect(routed.filter((edge) => !routable(thousands, edge)).some(route)).toBe(false);
      const measured = measure(thousands, layout);
      expect(measured.underBetween).toBe(0);
      expect(measured.crossings).toBeLessThan(measured.crossingsBefore);
    },
  );
});
