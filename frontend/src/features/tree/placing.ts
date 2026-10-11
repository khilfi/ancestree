import { type HierarchyPointNode, hierarchy, tree } from "d3-hierarchy";
import type { Graph, LayoutUnit, Seat, TreeSettings } from "@/api/types";
import { generationShifts } from "./generations";
import {
  centreLayout,
  type Fold,
  type Point,
  RING_GAP,
  type Ring,
  type RingLayout,
  SPACING,
  TRAY_COLUMNS,
  TRAY_ROW,
  UNIT_GAP,
  unitLayout,
} from "./rings";

/*
 * Where married-in families go on the rings, one of four ways, as this
 * computer chose in the Layout menu; tried side by side in S7:
 * - fans, the first choice: each family opens outwards from its person, its oldest generation
 *   nearest and its rings drawn as arcs over the fan alone; moved around its host and out where
 *   it would meet another family;
 * - discs: each family on whole rings of its own, as it was before, moved around its
 *   host and out until it meets nothing;
 * - settled fans: the fans, then a fixed number of gentle steps that keep photos apart and pull
 *   links towards their length, the same every time;
 * - tucked in: each family's people on its host's own rings, at their generations, beside their
 *   person.
 * Whichever way, no photo overlaps another, and no family's rings cross another's people. The
 * family at the centre, and families with no link to it, are placed as `centreLayout` places
 * them.
 */

export type Way = TreeSettings["married_in"];

/** The ways, as the Layout menu offers them: the first is chosen until another is. */
export const WAYS: { way: Way; name: string; hint: string }[] = [
  {
    way: "fans",
    name: "Fans",
    hint: "Each opens out from the person who married in, the oldest generation nearest",
  },
  {
    way: "discs",
    name: "Discs",
    hint: "Each on whole rings of its own, apart from the others",
  },
  {
    way: "settled",
    name: "Settled fans",
    hint: "Fans, evened out a little",
  },
  {
    way: "tucked",
    name: "Tucked in",
    hint: "On their host's own rings, at their generations; unfolding one moves the others",
  },
];

const CLEAR = SPACING; // between photos of different families, centre to centre: names fit
const FAN_MOST = (130 * Math.PI) / 180; // a fan's widest angle; past it, its arcs go further out
const TURN = (4 * Math.PI) / 180; // a family moved around its host, a step at a time
const SETTLE_STEPS = 24; // gentle: most of what they move, they move in the first few
const SETTLE_APART = 2 * 56; // settled: no photo nearer another than a photo's width (56)

type TreeNode = { id: string; children: TreeNode[] };

/** A married-in family: its seats, and who's in it. */
type Cluster = {
  unit: LayoutUnit;
  members: string[]; // seated in it; its person on the rings (the anchor) isn't
  seatOf: (id: string) => Seat | undefined;
};

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
/** The point `length` from `from` at `angle`, as atan2 counts it: from +x towards +y. */
const toward = (from: Point, angle: number, length: number): Point => ({
  x: from.x + length * Math.cos(angle),
  y: from.y + length * Math.sin(angle),
});
const angleOf = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);
/** An atan2 angle as `polar` counts it: 0 straight up, clockwise. */
const asPolar = (angle: number) => angle + Math.PI / 2;
/** The turn from one angle to another, between -π and π. */
function turnBetween(from: number, to: number): number {
  const turn = (((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI);
  return turn - Math.PI;
}

/** The married-in families of a graph, in the backend's order: each after the one it hangs
 *  off. */
function clustersOf(graph: Graph): Cluster[] {
  const seats = new Map(Object.entries(graph.layout.seats));
  const membersOf = new Map<string, string[]>();
  for (const [id, seat] of seats) append(membersOf, seat.unit, id);
  return graph.layout.units
    .filter((unit) => unit.anchor)
    .map((unit) => ({
      unit,
      members: membersOf.get(unit.id) ?? [],
      seatOf: (id: string) =>
        id === unit.anchor ? (unit.anchor_seat ?? undefined) : seats.get(id),
    }));
}

type Spot = { id: string; point: Point };

/** Points kept in cells, to find those near a place quickly at 2,000 people. A cell is known by
 *  a number, its column times 2²⁰ and its row: a tree spans far fewer cells than that. */
class Grid {
  private readonly cells = new Map<number, Spot[]>();
  constructor(private readonly size: number) {}

  private cell(value: number): number {
    return Math.floor(value / this.size);
  }

  add(id: string, point: Point): void {
    append(this.cells, this.cell(point.x) * 1_048_576 + this.cell(point.y), { id, point });
  }

  near(point: Point, within: number): Spot[] {
    const found: Spot[] = [];
    const [top, bottom] = [this.cell(point.y - within), this.cell(point.y + within)];
    for (let x = this.cell(point.x - within); x <= this.cell(point.x + within); x++) {
      for (let y = top; y <= bottom; y++) {
        for (const spot of this.cells.get(x * 1_048_576 + y) ?? []) {
          if (distance(spot.point, point) < within) found.push(spot);
        }
      }
    }
    return found;
  }
}

/** Whether a married-in family is shown open: chosen open, and its person shown. If not, its
 *  people are hidden. Either way its person carries its badge. */
function opens(layout: RingLayout, cluster: Cluster, open: ReadonlySet<string>): boolean {
  const anchor = cluster.unit.anchor ?? "";
  const shown = layout.points.has(anchor) && !layout.hidden.has(anchor);
  const isOpen = open.has(cluster.unit.id) && shown;
  append<string, Fold>(layout.folds, anchor, {
    unit: cluster.unit.id,
    size: cluster.unit.size,
    open: isOpen,
  });
  if (!isOpen) for (const id of cluster.members) layout.hidden.add(id);
  return isOpen;
}

/** Around a host and out, a step at a time: the first place that `fits`, nearest first. */
function search<T>(
  steps: { out: number; around: number },
  place: (out: number, turn: number) => T,
  fits: (placed: T) => boolean,
): T {
  for (let out = 0; out < steps.out; out++) {
    for (let around = 0; around <= Math.min(out, steps.around); around++) {
      for (const side of around ? [1, -1] : [1]) {
        const placed = place(out - around, side * around * TURN);
        if (fits(placed)) return placed;
      }
    }
  }
  return place(steps.out, 0); // nothing fits: as far out as it went
}

// --- Discs ----------------------------------------------------------------------------------

function discs(graph: Graph, open: ReadonlySet<string>): RingLayout {
  const layout = centreLayout(graph);
  const shifts = generationShifts(graph);
  const unitOf = (id: string) => graph.layout.seats[id]?.unit ?? "";
  // Each set of rings as a disc: its middle, and how far out its people's names reach.
  const placed = new Map<string, { middle: Point; outer: number }>();
  for (const [unit, middle] of layout.middles) {
    const radii = layout.rings.filter((ring) => ring.unit === unit).map((ring) => ring.radius);
    placed.set(unit, { middle, outer: Math.max(0, ...radii) + SPACING });
  }

  for (const cluster of clustersOf(graph)) {
    if (!opens(layout, cluster, open)) continue;
    const { unit } = cluster;
    const anchor = unit.anchor ?? "";
    const anchorAt = layout.points.get(anchor) ?? { x: 0, y: 0 };
    const local = unitLayout(unit, cluster.seatOf, [...cluster.members, anchor]);
    const outer = Math.max(...local.radii) + SPACING;
    const host = placed.get(unitOf(anchor)) ?? { middle: { x: 0, y: 0 }, outer: 0 };
    // First straight out from the host's middle through its person, just past the host, as
    // it was before. Then around the host and out, until it meets nothing.
    const away = angleOf(host.middle, anchorAt);
    const reach = host.outer + outer + SPACING;
    const middle = search(
      { out: 400, around: 15 },
      (out, turn) => toward(host.middle, away + turn, reach + out * (SPACING / 2)),
      (candidate) =>
        [...placed.values()].every(
          (disc) => distance(disc.middle, candidate) >= disc.outer + outer,
        ),
    );
    // Turned so that its own place for its person faces them.
    const turn =
      local.anchor && (local.anchor.x || local.anchor.y)
        ? angleOf(middle, anchorAt) - Math.atan2(local.anchor.y, local.anchor.x)
        : 0;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    for (const [id, point] of local.points) {
      if (id === anchor) continue;
      layout.points.set(id, {
        x: middle.x + point.x * cos - point.y * sin,
        y: middle.y + point.x * sin + point.y * cos,
      });
    }
    // Its rings named in the tree's own generations.
    const shift = shifts.get(unit.id) ?? 0;
    local.radii.forEach((radius, depth) => {
      if (depth > 0) {
        layout.rings.push({
          unit: unit.id,
          generation: depth + 1 + shift,
          ...middle,
          radius,
          cluster: true,
        });
      }
    });
    layout.middles.set(unit.id, middle);
    placed.set(unit.id, { middle, outer });
  }
  return layout;
}

// --- Fans -----------------------------------------------------------------------------------

/** A married-in family as a fan around its apex, its axis straight along +x: each person's
 *  angle off the axis and depth (0: the oldest generation), and each depth's arc. */
type FanShape = {
  angle: Map<string, number>;
  depth: Map<string, number>;
  radii: number[];
  spans: { from: number; to: number }[]; // off the axis, with room for the people at its ends
};

function fanShape(cluster: Cluster): FanShape {
  const { unit, members, seatOf } = cluster;
  const inFan = new Set(members);
  const root = unit.centre.find((id) => inFan.has(id)) ?? members[0] ?? "";
  const partnersOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const id of members) {
    if (id === root) continue;
    const seat = seatOf(id);
    if (seat?.partner_of && inFan.has(seat.partner_of)) append(partnersOf, seat.partner_of, id);
    // A child of their person on the rings hangs from the fan's oldest instead.
    else append(childrenOf, seat?.parent && inFan.has(seat.parent) ? seat.parent : root, id);
  }
  const byOrder = (a: string, b: string) => (seatOf(a)?.order ?? 0) - (seatOf(b)?.order ?? 0);
  for (const list of [...partnersOf.values(), ...childrenOf.values()]) list.sort(byOrder);
  const build = (id: string): TreeNode => ({ id, children: (childrenOf.get(id) ?? []).map(build) });
  const slots = (id: string) => 1 + (partnersOf.get(id)?.length ?? 0);
  const top = hierarchy(build(root));

  // Each generation an arc a ring's width further out; a crowded one further still, until the
  // fan is no wider than FAN_MOST. A tidy tree in angles: neighbours a photo's room apart.
  let radii = Array.from({ length: top.height + 1 }, (_, depth) => (depth + 1) * RING_GAP);
  let laid: HierarchyPointNode<TreeNode> = tree<TreeNode>()(top);
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = radii;
    laid = tree<TreeNode>()
      .nodeSize([1, 1])
      .separation(
        (a, b) =>
          (((slots(a.data.id) + slots(b.data.id)) / 2 + (a.parent === b.parent ? 0 : 0.5)) *
            SPACING) /
          (current[a.depth] ?? RING_GAP),
      )(top);
    const next = [...radii];
    let wider = false;
    for (let depth = 0; depth < radii.length; depth++) {
      const ring = laid.descendants().filter((node) => node.depth === depth);
      const widest = Math.max(...ring.map((node) => slots(node.data.id)));
      const spread =
        Math.max(...ring.map((node) => node.x)) -
        Math.min(...ring.map((node) => node.x)) +
        (widest * SPACING) / (radii[depth] ?? RING_GAP);
      if (spread > FAN_MOST) {
        next[depth] = (radii[depth] ?? RING_GAP) * (spread / FAN_MOST);
        wider = true;
      }
    }
    for (let depth = 1; depth < next.length; depth++) {
      next[depth] = Math.max(next[depth] ?? 0, (next[depth - 1] ?? 0) + RING_GAP);
    }
    radii = next;
    if (!wider) break;
  }

  const nodes = laid.descendants();
  const middle =
    (Math.max(...nodes.map((node) => node.x)) + Math.min(...nodes.map((node) => node.x))) / 2;
  const angle = new Map<string, number>();
  const depth = new Map<string, number>();
  const ends = radii.map(() => ({ from: Number.POSITIVE_INFINITY, to: Number.NEGATIVE_INFINITY }));
  for (const node of nodes) {
    const partners = partnersOf.get(node.data.id) ?? [];
    const group = partners.length
      ? [partners[0] ?? "", node.data.id, ...partners.slice(1)]
      : [node.data.id];
    const radius = radii[node.depth] ?? RING_GAP;
    group.forEach((id, index) => {
      const at = node.x - middle + ((index - (group.length - 1) / 2) * SPACING) / radius;
      angle.set(id, at);
      depth.set(id, node.depth);
      const end = ends[node.depth];
      if (end) [end.from, end.to] = [Math.min(end.from, at), Math.max(end.to, at)];
    });
  }
  const spans = ends.map((end, index) => {
    if (end.from > end.to) return { from: 0, to: 0 };
    const room = (0.6 * SPACING) / (radii[index] ?? RING_GAP);
    return { from: end.from - room, to: end.to + room };
  });
  return { angle, depth, radii, spans };
}

/** A fan placed: its apex and axis, and so each person's point. */
type PlacedFan = {
  unit: string;
  apex: Point;
  axis: number; // as atan2 counts it
  shape: FanShape;
  shift: number; // its generations in the tree's numbers
  points: Map<string, Point>;
};

function placeFan(
  unit: string,
  shape: FanShape,
  apex: Point,
  axis: number,
  shift: number,
): PlacedFan {
  const points = new Map<string, Point>();
  for (const [id, angle] of shape.angle) {
    const radius = shape.radii[shape.depth.get(id) ?? 0] ?? RING_GAP;
    points.set(id, toward(apex, axis + angle, radius));
  }
  return { unit, apex, axis, shape, shift, points };
}

/** Whether a point lies in a fan: between its first arc and its last, within its angle, with
 *  `room` around. */
function inFan(fan: PlacedFan, point: Point, room: number): boolean {
  const reach = distance(fan.apex, point);
  const [first, last] = [fan.shape.radii[0] ?? 0, fan.shape.radii.at(-1) ?? 0];
  if (reach < first - room || reach > last + room) return false;
  const off = turnBetween(fan.axis, angleOf(fan.apex, point));
  const slack = room / Math.max(reach, 1);
  return fan.shape.spans.some((span) => off >= span.from - slack && off <= span.to + slack);
}

/** Points along a fan's arcs, a little apart: where two fans would cross. */
function alongFan(fan: PlacedFan): Point[] {
  const found: Point[] = [];
  fan.shape.radii.forEach((radius, depth) => {
    const span = fan.shape.spans[depth];
    if (!span || span.to <= span.from) return;
    const steps = Math.max(2, Math.ceil(((span.to - span.from) * radius) / 40));
    for (let step = 0; step <= steps; step++) {
      const angle = fan.axis + span.from + ((span.to - span.from) * step) / steps;
      found.push(toward(fan.apex, angle, radius));
    }
  });
  return found;
}

function fanRings(fan: PlacedFan): Ring[] {
  return fan.shape.radii.map((radius, depth) => {
    const span = fan.shape.spans[depth] ?? { from: 0, to: 0 };
    return {
      unit: fan.unit,
      generation: depth + 1 + fan.shift,
      ...fan.apex,
      radius,
      cluster: true,
      span: { from: asPolar(fan.axis + span.from), to: asPolar(fan.axis + span.to) },
    };
  });
}

/** The fans placed, and whether a point is clear of the rings they had to stay outside. */
type Fanned = { layout: RingLayout; fans: PlacedFan[]; outside: (point: Point) => boolean };

function fans(graph: Graph, open: ReadonlySet<string>): Fanned {
  const layout = centreLayout(graph);
  const shifts = generationShifts(graph);
  const unitOf = (id: string) => graph.layout.seats[id]?.unit ?? "";
  const photos = new Grid(CLEAR);
  for (const [id, point] of layout.points) photos.add(id, point);
  // The families placed by `centreLayout`: a fan stays outside their rings.
  const discs = [...layout.middles].map(([unit, middle]) => ({
    middle,
    reach: Math.max(0, ...layout.rings.filter((r) => r.unit === unit).map((r) => r.radius)),
  }));
  // Each fan placed, with points along its arcs and how far it reaches, worked out once.
  const placed: { fan: PlacedFan; arcs: Point[]; reach: number }[] = [];
  const reachOf = (fan: PlacedFan) => (fan.shape.radii.at(-1) ?? 0) + SPACING;
  const outside = (point: Point) =>
    discs.every((disc) => distance(disc.middle, point) >= disc.reach + RING_GAP / 2);

  for (const cluster of clustersOf(graph)) {
    if (!opens(layout, cluster, open)) continue;
    const { unit } = cluster;
    const anchor = unit.anchor ?? "";
    const anchorAt = layout.points.get(anchor) ?? { x: 0, y: 0 };
    const shape = fanShape(cluster);
    const host = unitOf(anchor);
    // Outwards from the middle of the rings, or the fan, that its person is on.
    const hostMiddle =
      placed.find((each) => each.fan.unit === host)?.fan.apex ??
      layout.middles.get(host) ??
      anchorAt;
    const away = angleOf(hostMiddle, anchorAt);
    const from = distance(hostMiddle, anchorAt);
    const shift = shifts.get(unit.id) ?? 0;
    const at = (out: number, turn: number) =>
      placeFan(
        unit.id,
        shape,
        toward(hostMiddle, away + turn, from + out * (RING_GAP / 2)),
        away + turn,
        shift,
      );

    const fits = (fan: PlacedFan) => {
      const reach = reachOf(fan);
      const near = placed.filter(
        (other) => distance(other.fan.apex, fan.apex) < other.reach + reach,
      );
      for (const [id, point] of fan.points) {
        if (photos.near(point, CLEAR).some((other) => other.id !== id)) return false;
        if (!outside(point)) return false;
        if (near.some((other) => inFan(other.fan, point, SPACING / 2))) return false;
      }
      // Nobody else under its arcs, and its arcs clear of the other fans'.
      const under = photos
        .near(fan.apex, reach)
        .some((other) => !fan.points.has(other.id) && inFan(fan, other.point, SPACING / 2));
      if (under) return false;
      const arcs = alongFan(fan);
      return near.every(
        (other) =>
          !arcs.some((point) => inFan(other.fan, point, 0)) &&
          !other.arcs.some((point) => inFan(fan, point, 0)),
      );
    };

    // From its person outwards: first as far as it takes to clear the rings it would cross,
    // then around the host and out, until it meets nothing.
    let clear = 0;
    while (clear < 400 && ![...at(clear, 0).points.values()].every(outside)) clear++;
    const chosen = search({ out: 200, around: 12 }, (out, turn) => at(clear + out, turn), fits);
    for (const [id, point] of chosen.points) {
      layout.points.set(id, point);
      photos.add(id, point);
    }
    layout.rings.push(...fanRings(chosen));
    layout.middles.set(unit.id, chosen.apex);
    placed.push({ fan: chosen, arcs: alongFan(chosen), reach: reachOf(chosen) });
  }
  return { layout, fans: placed.map((each) => each.fan), outside };
}

// --- Settled fans ---------------------------------------------------------------------------

function settled(graph: Graph, open: ReadonlySet<string>): RingLayout {
  const { layout, fans: placed, outside } = fans(graph, open);
  const movable = [...new Set(placed.flatMap((fan) => [...fan.points.keys()]))];
  if (movable.length === 0) return layout;
  const canMove = new Set(movable);
  const home = new Map(movable.map((id) => [id, layout.points.get(id) ?? { x: 0, y: 0 }]));
  const unitOf = (id: string) => graph.layout.seats[id]?.unit;
  // The links inside each family, like springs; a link to another family is as long as it
  // must be, and isn't pulled.
  const ties = new Map<string, { other: string; length: number }[]>();
  const shown = (id: string) => layout.points.has(id) && !layout.hidden.has(id);
  for (const link of graph.links) {
    if (!shown(link.source) || !shown(link.target)) continue;
    if (unitOf(link.source) !== unitOf(link.target)) continue;
    const length = link.type === "spouse" ? SPACING : RING_GAP;
    append(ties, link.source, { other: link.target, length });
    append(ties, link.target, { other: link.source, length });
  }
  // Those who stay put, in their cells once; those who move, in cells of their own each step.
  const still = new Grid(SETTLE_APART);
  for (const id of layout.points.keys()) {
    if (shown(id) && !canMove.has(id)) still.add(id, layout.points.get(id) ?? { x: 0, y: 0 });
  }
  const everyone = () => {
    const moving = new Grid(SETTLE_APART);
    for (const id of movable) moving.add(id, layout.points.get(id) ?? { x: 0, y: 0 });
    return [still, moving];
  };
  // How far apart two photos are pushed, in each direction, when too near (plain numbers: this
  // runs for every pair, at every step).
  const apartFrom = (at: Point, grids: Grid[], id: string, share: (other: string) => number) => {
    let [x, y] = [0, 0];
    for (const grid of grids) {
      for (const other of grid.near(at, SETTLE_APART)) {
        if (other.id === id) continue;
        const [dx, dy] = [at.x - other.point.x, at.y - other.point.y];
        const apart = Math.hypot(dx, dy) || 1;
        const by = ((SETTLE_APART - apart) / apart) * share(other.id);
        [x, y] = [x + dx * by, y + dy * by];
      }
    }
    return { x, y };
  };
  for (let step = 0; step < SETTLE_STEPS; step++) {
    const grids = everyone();
    const gentle = 1 - step / SETTLE_STEPS; // less each step, so that it comes to rest
    for (const id of movable) {
      const at = layout.points.get(id);
      if (!at) continue;
      let { x, y } = apartFrom(at, grids, id, () => 0.5);
      for (const tie of ties.get(id) ?? []) {
        const other = layout.points.get(tie.other);
        if (!other) continue;
        const [dx, dy] = [other.x - at.x, other.y - at.y];
        const apart = Math.hypot(dx, dy) || 1;
        const by = ((apart - tie.length) / apart) * 0.1;
        [x, y] = [x + dx * by, y + dy * by];
      }
      const back = home.get(id) ?? at;
      [x, y] = [x + (back.x - at.x) * 0.05, y + (back.y - at.y) * 0.05];
      const most = 30 * gentle;
      const size = Math.hypot(x, y);
      const scale = (size > most ? most / size : 1) * gentle;
      const next = { x: at.x + x * scale, y: at.y + y * scale };
      // Never into the rings of the families placed by `centreLayout`.
      if (outside(next)) layout.points.set(id, next);
    }
  }
  // Last, no photo nearer another than a photo's width: a few passes to part any still close.
  // Half the way each when both can move; all of it when the other can't.
  for (let pass = 0; pass < 20; pass++) {
    const grids = everyone();
    let parted = false;
    for (const id of movable) {
      const at = layout.points.get(id);
      if (!at) continue;
      const away = apartFrom(at, grids, id, (other) => (canMove.has(other) ? 0.5 : 1));
      const next = add(at, away);
      if ((away.x || away.y) && outside(next)) {
        layout.points.set(id, next);
        parted = true;
      }
    }
    if (!parted) break;
  }
  // Each fan's arcs through its people where they came to rest.
  const moved = new Set(placed.map((fan) => fan.unit));
  layout.rings = layout.rings.filter((ring) => !moved.has(ring.unit));
  for (const fan of placed) {
    const ofDepth = (depth: number) =>
      [...fan.points.keys()]
        .filter((id) => fan.shape.depth.get(id) === depth)
        .map((id) => layout.points.get(id) ?? fan.apex);
    const radii = fan.shape.radii.map((radius, depth) => {
      const at = ofDepth(depth).map((point) => distance(fan.apex, point));
      return at.length ? at.reduce((a, b) => a + b, 0) / at.length : radius;
    });
    const spans = radii.map((radius, depth) => {
      const angles = ofDepth(depth).map((point) => turnBetween(fan.axis, angleOf(fan.apex, point)));
      const room = (0.6 * SPACING) / Math.max(radius, 1);
      return angles.length
        ? { from: Math.min(...angles) - room, to: Math.max(...angles) + room }
        : (fan.shape.spans[depth] ?? { from: 0, to: 0 });
    });
    layout.rings.push(...fanRings({ ...fan, shape: { ...fan.shape, radii, spans } }));
  }
  return layout;
}

// --- Tucked in ------------------------------------------------------------------------------

function tucked(graph: Graph, open: ReadonlySet<string>): RingLayout {
  const layout = centreLayout(graph);
  const seats = graph.layout.seats;
  const shifts = generationShifts(graph);
  const unitOf = (id: string) => seats[id]?.unit ?? "";
  // Each family at the centre, or with no link to it, takes the married-in families that hang
  // off it into its own tree: their people join its rings, at their generations.
  const mains = graph.layout.units.filter((unit) => !unit.anchor);
  const into = new Map(mains.map((unit) => [unit.id, unit.id])); // a family -> whose rings
  const childrenOf = new Map<string, string[]>();
  const partnersOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const depthOf = new Map<string, number>();
  const join = (id: string, seat: Seat | undefined, parent: string, inside: Set<string>) => {
    if (seat?.partner_of && inside.has(seat.partner_of)) append(partnersOf, seat.partner_of, id);
    else {
      append(childrenOf, parent, id);
      parentOf.set(id, parent);
    }
  };
  for (const unit of mains) {
    const inside = new Set(Object.keys(seats).filter((id) => unitOf(id) === unit.id));
    for (const id of inside) {
      const seat = seats[id];
      if (seat?.partner_of || seat?.parent) join(id, seat, seat.parent ?? "", inside);
    }
  }
  const byOrder = (a: string, b: string) => (seats[a]?.order ?? 0) - (seats[b]?.order ?? 0);
  for (const list of [...partnersOf.values(), ...childrenOf.values()]) list.sort(byOrder);
  const measure = (id: string, depth: number) => {
    depthOf.set(id, depth);
    for (const partner of partnersOf.get(id) ?? []) depthOf.set(partner, depth);
    for (const child of childrenOf.get(id) ?? []) measure(child, depth + 1);
  };
  for (const unit of mains) if (unit.centre[0]) measure(unit.centre[0], 0);
  // Where someone is in the merged tree: their own place, or their partner's.
  const placeOf = (id: string) => seats[id]?.partner_of ?? id;

  for (const cluster of clustersOf(graph)) {
    if (!opens(layout, cluster, open)) continue;
    const { unit, members, seatOf } = cluster;
    const anchor = unit.anchor ?? "";
    into.set(unit.id, into.get(unitOf(anchor)) ?? "");
    const inside = new Set(members);
    const root = unit.centre.find((id) => inside.has(id)) ?? members[0] ?? "";
    // Its oldest generation on the ring of its generation in the tree's numbers (1 + shift: a
    // ring for each after the first), but on the first ring at least.
    const depth = Math.max(1, shifts.get(unit.id) ?? 0);
    const place = placeOf(anchor);
    let host = place;
    while ((depthOf.get(host) ?? 0) > depth - 1 && parentOf.has(host)) {
      host = parentOf.get(host) ?? host;
    }
    // Beside the line that holds its person, among its host's children.
    let line: string | undefined = place === host ? undefined : place;
    while (line && parentOf.get(line) !== host) line = parentOf.get(line);
    const siblings = childrenOf.get(host) ?? [];
    const after = line ? siblings.indexOf(line) : -1;
    siblings.splice(after < 0 ? siblings.length : after + 1, 0, root);
    childrenOf.set(host, siblings);
    parentOf.set(root, host);
    for (const id of members) {
      if (id === root) continue;
      const seat = seatOf(id);
      join(id, seat, seat?.parent && inside.has(seat.parent) ? seat.parent : root, inside);
    }
    for (const id of members) childrenOf.get(id)?.sort(byOrder);
    measure(root, (depthOf.get(host) ?? 0) + 1);
    // Shown now, so that a family hanging off one of them opens too; placed below.
    for (const id of members) layout.points.set(id, { x: 0, y: 0 });
  }

  // Each merged family on rings around its own middle, side by side as the rings put them.
  layout.rings = [];
  const merged = (id: string): Seat | undefined => {
    const seat = seats[id];
    if (!seat || seat.partner_of) return seat;
    const parent = parentOf.get(id) ?? null;
    return { ...seat, parent, order: parent ? (childrenOf.get(parent) ?? []).indexOf(id) : 0 };
  };
  let cursor = 0;
  let first: { middle: Point; outer: number } | null = null;
  for (const unit of mains) {
    const members = [...depthOf.keys()].filter((id) => into.get(unitOf(id)) === unit.id);
    const local = unitLayout(unit, merged, members);
    const outer = Math.max(...local.radii) + SPACING;
    const middle = { x: cursor + outer, y: 0 };
    cursor = middle.x + outer + UNIT_GAP;
    first ??= { middle, outer };
    for (const [id, point] of local.points) layout.points.set(id, add(middle, point));
    local.radii.forEach((radius, ring) => {
      if (ring > 0) {
        layout.rings.push({
          unit: unit.id,
          generation: ring + 1,
          ...middle,
          radius,
          cluster: false,
        });
      }
    });
    for (const [family, rings] of into) if (rings === unit.id) layout.middles.set(family, middle);
  }
  // People not linked to anyone, in their tray to the left, as `centreLayout` puts it.
  const loners = graph.layout.unlinked;
  if (loners.length && first) {
    const width = TRAY_COLUMNS * SPACING;
    const height = Math.ceil(loners.length / TRAY_COLUMNS) * TRAY_ROW;
    const left = first.middle.x - first.outer - UNIT_GAP / 2 - width;
    const top = -height / 2;
    loners.forEach((id, index) => {
      layout.points.set(id, {
        x: left + (index % TRAY_COLUMNS) * SPACING + SPACING / 2,
        y: top + Math.floor(index / TRAY_COLUMNS) * TRAY_ROW + 60,
      });
    });
    layout.tray = { x: left - 24, y: top - 24, width: width + 48, height: height + 48 };
  }
  return layout;
}

/** Coordinates for everyone shown on the rings: married-in families in `open` are unfolded, and
 *  placed the chosen way. */
export function ringLayout(graph: Graph, open: ReadonlySet<string>, way: Way = "fans"): RingLayout {
  if (way === "discs") return discs(graph, open);
  if (way === "settled") return settled(graph, open);
  if (way === "tucked") return tucked(graph, open);
  return fans(graph, open).layout;
}

/** Every married-in family, to open them all. */
export function allFamilies(graph: Graph): Set<string> {
  return new Set(graph.layout.units.filter((unit) => unit.anchor).map((unit) => unit.id));
}
