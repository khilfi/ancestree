import { type HierarchyPointNode, hierarchy, tree } from "d3-hierarchy";
import type { Graph, LayoutUnit, Seat } from "@/api/types";

/*
 * The lineage rings. The backend decides the seats (who is at
 * the centre, each generation, who hangs from whom, who sits beside whom); this turns
 * them into coordinates. d3-hierarchy's radial tree spreads each family around its
 * parent, eldest first clockwise; a crowded ring widens until everyone fits. Married-in
 * families are placed around them in `placing.ts`.
 */

export const SPACING = 136; // centre to centre along a ring: a name fits under each photo
export const RING_GAP = 210; // between rings: a photo, its name and a line
export const UNIT_GAP = 420; // between families with no link to each other
export const ARC_LABEL = 56; // an arc's label, this far before its start: past its people's names
export const TRAY_COLUMNS = 4;
export const TRAY_ROW = 170;

export type Point = { x: number; y: number };

export type Ring = {
  unit: string;
  generation: number;
  x: number;
  y: number;
  radius: number;
  cluster: boolean;
  // Only part of the circle, from one angle clockwise to the other, as `polar` counts them:
  // a married-in family drawn as a fan. No span: the whole circle.
  span?: { from: number; to: number };
};

export type Fold = { unit: string; size: number; open: boolean };

export type RingLayout = {
  points: Map<string, Point>; // the centre of each shown person's photo
  rings: Ring[];
  hidden: Set<string>; // folded away in a cluster
  folds: Map<string, Fold[]>; // clusters hanging off each person
  tray: { x: number; y: number; width: number; height: number } | null;
  middles: Map<string, Point>; // the middle of each set of rings, for curving links around it
};

type TreeNode = { id: string; children: TreeNode[] };
export type Local = { points: Map<string, Point>; radii: number[]; anchor: Point | null };

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** A point `radius` from the middle at `angle`: 0 is straight up, growing clockwise. */
export function polar(radius: number, angle: number): Point {
  return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) };
}

/** One set of rings around (0, 0). */
export function unitLayout(
  unit: LayoutUnit,
  seatOf: (id: string) => Seat | undefined,
  members: string[],
): Local {
  const partnersOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const id of members) {
    const seat = seatOf(id);
    if (!seat) continue;
    if (seat.partner_of) append(partnersOf, seat.partner_of, id);
    else if (seat.parent) append(childrenOf, seat.parent, id);
  }
  const byOrder = (a: string, b: string) => (seatOf(a)?.order ?? 0) - (seatOf(b)?.order ?? 0);
  for (const list of [...partnersOf.values(), ...childrenOf.values()]) list.sort(byOrder);

  const rootId = unit.centre[0] ?? members[0] ?? "";
  const build = (id: string): TreeNode => ({ id, children: (childrenOf.get(id) ?? []).map(build) });
  const slots = (node: HierarchyPointNode<TreeNode>) =>
    1 + (partnersOf.get(node.data.id)?.length ?? 0);
  const root = tree<TreeNode>()
    .size([2 * Math.PI, 1])
    .separation(
      (a, b) => ((slots(a) + slots(b)) / 2 + (a.parent === b.parent ? 0 : 0.5)) / a.depth,
    )(hierarchy(build(rootId)));

  // Each ring is at least RING_GAP outside the last, and wide enough for its neighbours.
  const byDepth: HierarchyPointNode<TreeNode>[][] = [];
  for (const node of root.descendants()) {
    const ring = byDepth[node.depth];
    if (ring) ring.push(node);
    else byDepth[node.depth] = [node];
  }
  const radii = [0];
  for (let depth = 1; depth < byDepth.length; depth++) {
    const ring = (byDepth[depth] ?? []).toSorted((a, b) => a.x - b.x);
    let radius = (radii[depth - 1] ?? 0) + RING_GAP;
    ring.forEach((node, index) => {
      const next = ring[(index + 1) % ring.length] ?? node;
      const gap = ring.length === 1 ? 2 * Math.PI : (next.x - node.x + 2 * Math.PI) % (2 * Math.PI);
      const needed = ((slots(node) + slots(next)) / 2) * SPACING;
      radius = Math.max(radius, needed / Math.max(gap, 1e-6));
    });
    radii.push(radius);
  }

  // A person and their partners share one spot: the first partner before, the rest after.
  const points = new Map<string, Point>();
  for (const node of root.descendants()) {
    const partners = partnersOf.get(node.data.id) ?? [];
    const group = partners.length
      ? [partners[0] ?? "", node.data.id, ...partners.slice(1)]
      : [node.data.id];
    const radius = radii[node.depth] ?? 0;
    group.forEach((id, index) => {
      const offset = index - (group.length - 1) / 2;
      points.set(
        id,
        node.depth === 0
          ? { x: offset * SPACING, y: 0 }
          : polar(radius, node.x + (offset * SPACING) / radius),
      );
    });
  }
  const anchor = unit.anchor ? (points.get(unit.anchor) ?? null) : null;
  return { points, radii, anchor };
}

/**
 * The family at the centre, and each family with no link to it, on its own rings side by side,
 * and people with no links in their tray: everyone but the married-in families, which
 * `placing.ts` places, the way this computer chose.
 */
export function centreLayout(graph: Graph): RingLayout {
  const seats = new Map(Object.entries(graph.layout.seats));
  const membersOf = new Map<string, string[]>();
  for (const [id, seat] of seats) append(membersOf, seat.unit, id);

  const points = new Map<string, Point>();
  const rings: Ring[] = [];
  const placed = new Map<string, Point & { outer: number }>();
  let cursor = 0;

  for (const unit of graph.layout.units) {
    if (unit.anchor) continue;
    const members = membersOf.get(unit.id) ?? [];
    const local = unitLayout(unit, (id) => seats.get(id), members);
    const outer = Math.max(...local.radii) + SPACING;
    const centre = { x: cursor + outer, y: 0 };
    cursor = centre.x + outer + UNIT_GAP;
    for (const [id, point] of local.points) {
      points.set(id, { x: centre.x + point.x, y: centre.y + point.y });
    }
    local.radii.forEach((radius, depth) => {
      if (depth > 0) {
        rings.push({ unit: unit.id, generation: depth + 1, ...centre, radius, cluster: false });
      }
    });
    placed.set(unit.id, { ...centre, outer });
  }

  // People not linked to anyone wait in a tray to the left: a visible to-do list.
  let tray: RingLayout["tray"] = null;
  const loners = graph.layout.unlinked;
  if (loners.length) {
    const first = placed.get(graph.layout.units[0]?.id ?? "");
    const width = TRAY_COLUMNS * SPACING;
    const height = Math.ceil(loners.length / TRAY_COLUMNS) * TRAY_ROW;
    const left = (first ? first.x - first.outer - UNIT_GAP / 2 : 0) - width;
    const top = -height / 2;
    loners.forEach((id, index) => {
      points.set(id, {
        x: left + (index % TRAY_COLUMNS) * SPACING + SPACING / 2,
        y: top + Math.floor(index / TRAY_COLUMNS) * TRAY_ROW + 60,
      });
    });
    tray = { x: left - 24, y: top - 24, width: width + 48, height: height + 48 };
  }
  const middles = new Map([...placed].map(([unit, { x, y }]) => [unit, { x, y }]));
  return { points, rings, hidden: new Set(), folds: new Map(), tray, middles };
}
