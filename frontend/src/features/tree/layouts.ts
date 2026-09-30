import { hierarchy, tree } from "d3-hierarchy";
import type { Gender, Graph } from "@/api/types";
import { standings } from "@/features/timeline/lanes";
import { type Layout, Links } from "./filters";
import { type Fold, type Point, RING_GAP, type RingLayout, ringLayout, SPACING } from "./rings";

/*
 * The layouts beside the rings, worked out in the browser from
 * the same seats the backend gives the rings:
 * - the family tree straightens the rings: a generation is a row, and the order around a ring
 *   runs left to right;
 * - the hourglass puts someone's ancestors above them and their descendants below;
 * - the fan chart spreads someone's ancestors over a half-circle, a band per generation,
 *   the father's side on the left and the mother's on the right.
 * Only the rings keep dragged positions; these are always worked out afresh.
 */

export const ROW = 190; // between generations: a photo, its name and a line
const UNIT_GAP = 3 * SPACING; // between families drawn side by side
const TRAY_COLUMNS = 4;
const TRAY_ROW = 170;

/** Faint lines behind everyone that say what a row or a band is. */
export type Guide =
  // `generation`: a row that is one of the tree's own generations, which can be tinted
  | { kind: "row"; y: number; x1: number; x2: number; label: string; generation?: number }
  | { kind: "arc"; radius: number; label: string } // a half-circle around (0, 0), above it
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "text"; x: number; y: number; label: string };

export type Arrangement = RingLayout & {
  layout: Layout;
  guides: Guide[];
  elbows: boolean; // links from parents drop down, across and down, as in a printed tree
  focus: string | null; // the person an hourglass or fan chart is around
};

type Node = { id: string; children: Node[] };

const GENDER_RANK: Record<Gender, number> = { male: 0, female: 1, unknown: 2 };

function nearby(graph: Graph) {
  const people = new Map(graph.people.map((person) => [person.id, person]));
  const rank = (id: string) => {
    const person = people.get(id);
    return person?.placeholder ? 3 : GENDER_RANK[person?.gender ?? "unknown"];
  };
  const born = (id: string) => people.get(id)?.born?.year ?? people.get(id)?.birth_year ?? 9999;
  const order = (id: string) => graph.layout.seats[id]?.order ?? 0;
  return {
    people,
    fathersFirst: (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b),
    eldestFirst: (a: string, b: string) => born(a) - born(b) || order(a) - order(b),
  };
}

/** Lay out a forest top to bottom: x along a row, in pixels, and each node's depth. Partners
 *  sit beside their person, so a person with a partner takes two places. */
function lay(
  roots: Node[],
  slots: (id: string) => number,
): Map<string, { x: number; depth: number }> {
  const top: Node = { id: "", children: roots };
  const laid = tree<Node>()
    .nodeSize([SPACING, ROW])
    .separation(
      (a, b) => (slots(a.data.id) + slots(b.data.id)) / 2 + (a.parent === b.parent ? 0 : 0.5),
    )(hierarchy(top));
  const found = new Map<string, { x: number; depth: number }>();
  for (const node of laid.descendants()) {
    if (node.depth > 0) found.set(node.data.id, { x: node.x, depth: node.depth - 1 });
  }
  return found;
}

/** A person and their partners in a row: the first partner before, the rest after. */
function group(id: string, partners: readonly string[], x: number): [string, number][] {
  const members = partners.length ? [partners[0] ?? "", id, ...partners.slice(1)] : [id];
  return members.map((member, index) => [member, x + (index - (members.length - 1) / 2) * SPACING]);
}

function spread(
  points: Map<string, Point>,
  ids: Iterable<string>,
): { left: number; right: number } {
  let [left, right] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const id of ids) {
    const point = points.get(id);
    if (!point) continue;
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
  }
  return Number.isFinite(left) ? { left, right } : { left: 0, right: 0 };
}

function everyoneElse(
  graph: Graph,
  points: Map<string, Point>,
  kept: Set<string> | null,
): Set<string> {
  return new Set(
    graph.people
      .map((person) => person.id)
      .filter((id) => !points.has(id) || (kept !== null && !kept.has(id))),
  );
}

/** The rings as an arrangement: positions dragged there are kept by the canvas. A
 *  filter leaves the others' places empty rather than moving anyone. */
export function ringsArrangement(
  graph: Graph,
  open: ReadonlySet<string>,
  kept: Set<string> | null,
): Arrangement {
  const rings = ringLayout(graph, open);
  if (kept)
    for (const person of graph.people) if (!kept.has(person.id)) rings.hidden.add(person.id);
  return { ...rings, layout: "rings", guides: [], elbows: false, focus: null };
}

/**
 * The family tree, top to bottom: each family's seats as a tree, a generation to a
 * row. Married-in families stand to the right, lined up with the person who married in. With
 * a filter, the tree starts from whoever is kept: "descendants of" gives a descendant chart.
 */
export function familyTreeLayout(
  graph: Graph,
  open: ReadonlySet<string>,
  kept: Set<string> | null,
): Arrangement {
  const standing = standings(graph).of;
  const seats = graph.layout.seats;
  const shown = (id: string) => kept === null || kept.has(id);
  const members = new Map<string, string[]>();
  for (const [id, seat] of Object.entries(seats)) {
    const list = members.get(seat.unit);
    if (list) list.push(id);
    else members.set(seat.unit, [id]);
  }

  const points = new Map<string, Point>();
  const folds = new Map<string, Fold[]>();
  const rowOf = (id: string) => ((standing.get(id)?.generation ?? 1) - 1) * ROW;
  const placedUnits: { ids: string[]; cluster: boolean }[] = [];

  for (const unit of graph.layout.units) {
    if (unit.anchor) {
      const isOpen = open.has(unit.id) && points.has(unit.anchor);
      const list = folds.get(unit.anchor) ?? [];
      list.push({ unit: unit.id, size: unit.size, open: isOpen });
      folds.set(unit.anchor, list);
      if (!isOpen) continue;
    }
    const ids = (members.get(unit.id) ?? []).filter((id) => id !== unit.anchor && shown(id));
    const inUnit = new Set(ids);
    const partnersOf = new Map<string, string[]>();
    const childrenOf = new Map<string, string[]>();
    const roots: string[] = [];
    const byOrder = (a: string, b: string) => (seats[a]?.order ?? 0) - (seats[b]?.order ?? 0);
    for (const id of ids) {
      const seat = seats[id];
      const partner = seat?.partner_of;
      const parent = seat?.parent;
      if (partner && inUnit.has(partner))
        partnersOf.set(partner, [...(partnersOf.get(partner) ?? []), id]);
      else if (parent && inUnit.has(parent))
        childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
      else roots.push(id);
    }
    for (const list of [...partnersOf.values(), ...childrenOf.values(), roots]) list.sort(byOrder);
    if (!roots.length) continue;
    // Roots on a later generation (a filter kept only the lower branches) hang from invisible
    // steps, so every row stays one generation.
    const top = Math.min(...roots.map((id) => seats[id]?.generation ?? 1));
    const build = (id: string): Node => ({
      id,
      children: (childrenOf.get(id) ?? []).map(build),
    });
    const stepped = roots.map((id) => {
      let node = build(id);
      for (let step = (seats[id]?.generation ?? top) - top; step > 0; step--) {
        node = { id: `step:${id}:${step}`, children: [node] };
      }
      return node;
    });
    const laid = lay(stepped, (id) => 1 + (partnersOf.get(id)?.length ?? 0));
    const placed: string[] = [];
    for (const [id, { x }] of laid) {
      if (id.startsWith("step:")) continue;
      for (const [member, at] of group(id, partnersOf.get(id) ?? [], x)) {
        points.set(member, { x: at, y: rowOf(member) });
        placed.push(member);
      }
    }
    placedUnits.push({ ids: placed, cluster: !!unit.anchor });
  }

  // Families side by side: the main ones first, married-in families to their right.
  let cursor = 0;
  for (const unit of [
    ...placedUnits.filter((u) => !u.cluster),
    ...placedUnits.filter((u) => u.cluster),
  ]) {
    const { left, right } = spread(points, unit.ids);
    const shift = cursor - left;
    for (const id of unit.ids) {
      const point = points.get(id);
      if (point) points.set(id, { x: point.x + shift, y: point.y });
    }
    cursor += right - left + UNIT_GAP;
  }

  // Not linked yet: a tray to the left, level with the first generation.
  let tray: RingLayout["tray"] = null;
  const loners = graph.layout.unlinked.filter(shown);
  if (loners.length) {
    const width = TRAY_COLUMNS * SPACING;
    const height = Math.ceil(loners.length / TRAY_COLUMNS) * TRAY_ROW;
    const left = -UNIT_GAP - width;
    loners.forEach((id, index) => {
      points.set(id, {
        x: left + (index % TRAY_COLUMNS) * SPACING + SPACING / 2,
        y: Math.floor(index / TRAY_COLUMNS) * TRAY_ROW,
      });
    });
    tray = { x: left - 24, y: -84, width: width + 48, height: height + 48 };
  }

  // A faint line along each generation's row, named at its left.
  const lonely = new Set(loners);
  const rowed = [...points.keys()].filter((id) => !lonely.has(id));
  const { left, right } = spread(points, rowed);
  const rows = [...new Set(rowed.map((id) => points.get(id)?.y ?? 0))].sort((a, b) => a - b);
  const guides: Guide[] = rows.map((y) => ({
    kind: "row",
    y,
    x1: left - SPACING,
    x2: right + SPACING,
    label: `Generation ${Math.round(y / ROW) + 1}`,
    generation: Math.round(y / ROW) + 1,
  }));

  return {
    points,
    rings: [],
    hidden: everyoneElse(graph, points, kept),
    folds,
    tray,
    middles: new Map(),
    layout: "tree",
    guides,
    elbows: true,
    focus: null,
  };
}

const UP_WORDS = ["Parents", "Grandparents", "Great-grandparents"];
const DOWN_WORDS = ["Children", "Grandchildren", "Great-grandchildren"];

/** "Parents", "Grandparents", "2× great-grandparents"; the same downwards. */
export function generationWord(level: number): string {
  const words = level < 0 ? UP_WORDS : DOWN_WORDS;
  const steps = Math.abs(level);
  const word = words[steps - 1];
  if (word) return word;
  const base = level < 0 ? "great-grandparents" : "great-grandchildren";
  return `${steps - 2}× ${base}`;
}

/**
 * An hourglass around someone: their ancestors above, fathers before mothers, and
 * their descendants below with husbands and wives beside them, `depth` generations each way.
 */
export function hourglassLayout(
  graph: Graph,
  focus: string,
  depth: number,
  kept: Set<string> | null,
): Arrangement {
  const links = new Links(graph, false);
  const { fathersFirst, eldestFirst } = nearby(graph);

  const seenUp = new Set([focus]);
  const up = (id: string, level: number): Node => {
    const parents =
      level >= depth
        ? []
        : [...links.up(id)].sort(fathersFirst).filter((p) => !seenUp.has(p) && seenUp.add(p));
    return { id, children: parents.map((p) => up(p, level + 1)) };
  };
  const seenDown = new Set([focus]);
  const partnersOf = new Map<string, string[]>();
  const down = (id: string, level: number): Node => {
    const partners = [...links.beside(id)].filter((p) => !seenDown.has(p) && seenDown.add(p));
    partnersOf.set(id, partners);
    const children =
      level >= depth
        ? []
        : [...links.down(id)].sort(eldestFirst).filter((c) => !seenDown.has(c) && seenDown.add(c));
    return { id, children: children.map((c) => down(c, level + 1)) };
  };

  const points = new Map<string, Point>();
  const below = lay([down(focus, 0)], (id) => 1 + (partnersOf.get(id)?.length ?? 0));
  for (const [id, { x, depth: level }] of below) {
    for (const [member, at] of group(id, partnersOf.get(id) ?? [], x)) {
      points.set(member, { x: at, y: level * ROW });
    }
  }
  // The ancestors stand over the person, wherever their partner put them.
  const anchor = points.get(focus) ?? { x: 0, y: 0 };
  const above = lay([up(focus, 0)], () => 1);
  const root = above.get(focus)?.x ?? 0;
  for (const [id, { x, depth: level }] of above) {
    if (level > 0) points.set(id, { x: x - root + anchor.x, y: -level * ROW });
  }

  const { left, right } = spread(points, points.keys());
  const levels = [...new Set([...points.values()].map((point) => Math.round(point.y / ROW)))];
  const guides: Guide[] = levels
    .filter((level) => level !== 0)
    .sort((a, b) => a - b)
    .map((level) => ({
      kind: "row",
      y: level * ROW,
      x1: left - SPACING,
      x2: right + SPACING,
      label: generationWord(level),
    }));
  return {
    points,
    rings: [],
    hidden: everyoneElse(graph, points, kept),
    folds: new Map(),
    tray: null,
    middles: new Map(),
    layout: "hourglass",
    guides,
    elbows: true,
    focus,
  };
}

/** How far out each generation of a fan chart is: far enough apart, and wide enough for
 *  everyone on its band. */
export function fanRadii(depth: number): number[] {
  const radii = [0];
  for (let g = 1; g <= depth; g++) {
    radii.push(Math.max((radii[g - 1] ?? 0) + RING_GAP, (2 ** g * SPACING) / Math.PI));
  }
  return radii;
}

/**
 * A fan chart of someone's ancestors: them at the bottom, their parents above, then
 * grandparents, each generation a half-circle further out; every ancestor has their own place
 * on it, the father's side on the left and the mother's on the right.
 */
export function fanLayout(
  graph: Graph,
  focus: string,
  depth: number,
  kept: Set<string> | null,
): Arrangement {
  const links = new Links(graph, false);
  const { people, fathersFirst } = nearby(graph);
  const radii = fanRadii(depth);
  const points = new Map<string, Point>([[focus, { x: 0, y: 0 }]]);
  const seen = new Set([focus]);
  let generation = [{ id: focus, place: 0 }];
  let reached = 0;
  for (let g = 1; g <= depth && generation.length; g++) {
    const next: { id: string; place: number }[] = [];
    for (const { id, place } of generation) {
      // Father on the left, mother on the right; a parent whose gender isn't recorded (or an
      // unknown parent) takes whichever side is free.
      const sides: (string | null)[] = [null, null];
      for (const parent of [...links.up(id)].sort(fathersFirst)) {
        if (seen.has(parent)) continue;
        const gender = people.get(parent)?.placeholder ? "unknown" : people.get(parent)?.gender;
        const wanted = gender === "female" ? 1 : gender === "male" ? 0 : sides[0] === null ? 0 : 1;
        const side = sides[wanted] === null ? wanted : sides[1 - wanted] === null ? 1 - wanted : -1;
        if (side < 0) continue;
        sides[side] = parent;
        seen.add(parent);
      }
      sides.forEach((parent, side) => {
        if (!parent) return;
        const spot = place * 2 + side;
        const angle = Math.PI - ((spot + 0.5) * Math.PI) / 2 ** g;
        const radius = radii[g] ?? 0;
        points.set(parent, { x: radius * Math.cos(angle), y: -radius * Math.sin(angle) });
        next.push({ id: parent, place: spot });
      });
    }
    if (next.length) reached = g;
    generation = next;
  }

  const outer = radii[reached] ?? 0;
  const guides: Guide[] = [];
  for (let g = 1; g <= reached; g++) {
    guides.push({ kind: "arc", radius: radii[g] ?? 0, label: generationWord(-g) });
  }
  if (reached) {
    guides.push(
      { kind: "line", x1: 0, y1: -SPACING / 2, x2: 0, y2: -outer - SPACING / 2 },
      { kind: "text", x: -outer / 2, y: SPACING / 2, label: "Father's side" },
      { kind: "text", x: outer / 2, y: SPACING / 2, label: "Mother's side" },
    );
  }
  return {
    points,
    rings: [],
    hidden: everyoneElse(graph, points, kept),
    folds: new Map(),
    tray: null,
    middles: new Map(),
    layout: "fan",
    guides,
    elbows: false,
    focus,
  };
}
