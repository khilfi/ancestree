/**
 * Blood relations: climbing from both people to the nearest shared ancestors
 * (backend/src/ancestree/kinship/blood.py). Only biological links count, and the
 * counts alone decide the term; ages never do (D3).
 */
import { type Key, sortedBy } from "./compare";
import { asSibling, type Family } from "./family";
import { compareBirths, compareSiblings, orderSiblings } from "./order";

const MAX_GENERATIONS = 20;
const MAX_LINES = 4096; // lines up through every parent; a full pedigree doubles each step

export type Seniority = "elder" | "younger";

const ORDINALS = [
  "eldest",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

/** Where someone comes among their brothers and sisters: `number` 1 is the eldest, of `of`. */
export class Place {
  constructor(
    readonly number: number,
    readonly of: number,
  ) {}

  get youngest(): boolean {
    return this.of >= 2 && this.number === this.of;
  }

  /** The names a word list may give this place, the most specific first. */
  keys(): string[] {
    const named = this.youngest ? ["youngest"] : [];
    if (this.number <= ORDINALS.length) named.push(ORDINALS[this.number - 1] as string);
    return [...named, "other"];
  }
}

type Climb = {
  depth: Map<string, number>; // ancestor -> generations above the person (the person: 0)
  below: Map<string, string>; // ancestor -> the next person down, towards the person
  via: Map<string, string>; // ancestor -> the link between them
};

function climb(family: Family, person: string): Climb {
  const depth = new Map([[person, 0]]);
  const below = new Map<string, string>();
  const via = new Map<string, string>();
  let frontier = [person];
  for (let generation = 1; generation <= MAX_GENERATIONS; generation++) {
    const found: string[] = [];
    for (const child of frontier) {
      for (const link of family.up(child)) {
        if (family.isBlood(link.kind) && !depth.has(link.parent)) {
          depth.set(link.parent, generation);
          below.set(link.parent, child);
          via.set(link.parent, link.id);
          found.push(link.parent);
        }
      }
    }
    if (!found.length) break;
    frontier = found;
  }
  return { depth, below, via };
}

/** One way two people are related by blood. `path` runs from A up to the first of the shared
 *  ancestors and down to B; `links` are the parent links along it. */
export class BloodTie {
  constructor(
    readonly up: number,
    readonly down: number,
    readonly ancestors: readonly string[], // the nearest shared ancestors: one, or a couple
    readonly path: readonly string[],
    readonly links: readonly string[],
  ) {}

  /** A's side just below the shared ancestors: A's parent, for an uncle. */
  get viaA(): string | null {
    return this.up ? (this.path[this.up - 1] ?? null) : null;
  }

  /** B's side just below the shared ancestors: B's parent, for a nephew. */
  get viaB(): string | null {
    return this.down ? (this.path[this.up + 1] ?? null) : null;
  }

  reversed(): BloodTie {
    return new BloodTie(
      this.down,
      this.up,
      this.ancestors,
      this.path.toReversed(),
      this.links.toReversed(),
    );
  }
}

/** Every way up by birth from `person` to each ancestor, or null when there are too many to
 *  list (a big, fully recorded pedigree). */
function linesUp(family: Family, person: string): Map<string, string[][]> | null {
  const found = new Map<string, string[][]>([[person, [[person]]]]);
  let frontier = [[person]];
  let count = 1;
  for (let round = 0; round < MAX_GENERATIONS; round++) {
    const grown: string[][] = [];
    for (const line of frontier) {
      for (const parent of family.bloodParents(line[line.length - 1] as string)) {
        if (line.includes(parent)) continue; // the rules refuse cycles; never loop anyway
        const longer = [...line, parent];
        const lines = found.get(parent);
        if (lines) lines.push(longer);
        else found.set(parent, [longer]);
        grown.push(longer);
        count += 1;
        if (count > MAX_LINES) return null;
      }
    }
    if (!grown.length) break;
    frontier = grown;
  }
  return found;
}

function closestFirst(family: Family, ties: BloodTie[]): BloodTie[] {
  // The order is the same whichever way round the question is asked.
  return sortedBy(
    ties,
    (tie): Key => [
      tie.up + tie.down,
      Math.abs(tie.up - tie.down),
      tie.ancestors.map((p) => family.orderKey(p)),
    ],
  );
}

/** Every way A and B are related by blood, closest first. Each tie is a line up from A and a
 *  line up from B that meet first at a shared ancestor; a couple at the top is one tie. */
export function bloodTies(family: Family, a: string, b: string): BloodTie[] {
  const fromA = linesUp(family, a);
  const fromB = linesUp(family, b);
  if (!fromA || !fromB) return nearestTies(family, a, b);
  const groups = new Map<string, { belowA: string[]; belowB: string[]; ancestors: string[] }>();
  for (const [ancestor, linesA] of fromA) {
    const linesB = fromB.get(ancestor);
    if (!linesB) continue;
    for (const lineA of linesA) {
      for (const lineB of linesB) {
        const belowA = lineA.slice(0, -1);
        const belowB = lineB.slice(0, -1);
        if (belowA.some((person) => belowB.includes(person))) continue;
        const key = `${belowA.join(",")}|${belowB.join(",")}`;
        const group = groups.get(key);
        if (group) group.ancestors.push(ancestor);
        else groups.set(key, { belowA, belowB, ancestors: [ancestor] });
      }
    }
  }
  const ties: BloodTie[] = [];
  for (const { belowA, belowB, ancestors } of groups.values()) {
    const sorted = sortedBy(ancestors, (p) => family.orderKey(p));
    const up = belowA.length;
    const path = [...belowA, sorted[0] as string, ...belowB.toReversed()];
    // Climbing, each link is (child, parent); coming down, (parent, child).
    const links = path.slice(0, -1).map((person, i) => {
      const next = path[i + 1] as string;
      return i < up ? family.bloodLink(next, person) : family.bloodLink(person, next);
    });
    ties.push(new BloodTie(up, belowB.length, sorted, path, links));
  }
  return closestFirst(family, ties);
}

/** For pedigrees too big to list every line: the nearest shared ancestors only, each by its
 *  shortest line. */
function nearestTies(family: Family, a: string, b: string): BloodTie[] {
  const fromA = climb(family, a);
  const fromB = climb(family, b);
  const shared = new Set([...fromA.depth.keys()].filter((p) => fromB.depth.has(p)));
  // The nearest shared ancestors: none of their children is a shared ancestor too.
  const nearest = [...shared].filter((p) => !family.bloodChildren(p).some((c) => shared.has(c)));
  // A couple reached through the same child on each side is one relationship, not two.
  const groups = new Map<string, { up: number; down: number; ancestors: string[] }>();
  for (const ancestor of nearest) {
    const up = fromA.depth.get(ancestor) ?? 0;
    const down = fromB.depth.get(ancestor) ?? 0;
    const key = [up, down, fromA.below.get(ancestor) ?? "", fromB.below.get(ancestor) ?? ""].join(
      "|",
    );
    const group = groups.get(key);
    if (group) group.ancestors.push(ancestor);
    else groups.set(key, { up, down, ancestors: [ancestor] });
  }
  const ties: BloodTie[] = [];
  for (const { up, down, ancestors } of groups.values()) {
    const sorted = sortedBy(ancestors, (p) => family.orderKey(p));
    const top = sorted[0] as string;
    const [upPeople, upLinks] = route(fromA, top);
    const [downPeople, downLinks] = route(fromB, top);
    ties.push(
      new BloodTie(
        up,
        down,
        sorted,
        [...upPeople, ...downPeople.slice(0, -1).toReversed()],
        [...upLinks, ...downLinks.toReversed()],
      ),
    );
  }
  return closestFirst(family, ties);
}

/** From the person who climbed up to `top`: the people (theirs first) and the links. */
function route(climbed: Climb, top: string): [string[], string[]] {
  const people = [top];
  const links: string[] = [];
  for (let last = top; climbed.below.has(last); last = people[people.length - 1] as string) {
    links.push(climbed.via.get(last) as string);
    people.push(climbed.below.get(last) as string);
  }
  return [people.toReversed(), links.toReversed()];
}

/** Whether `person` is the elder or younger of two siblings: among the children of the
 *  same parents birth order decides, set by hand where dates can't; otherwise dates. */
export function seniority(family: Family, person: string, than: string): Seniority | null {
  const them = family.member(person);
  const me = family.member(than);
  const household = family.fullSiblings(than);
  const order = household.some((s) => s.id === them.id)
    ? compareSiblings(asSibling(me), asSibling(them), household.map(asSibling))
    : compareBirths(me.birth, them.birth);
  if (!order) return null;
  return order < 0 ? "younger" : "elder";
}

/** Where someone comes among their brothers and sisters, once the order is known. */
export function birthPlace(family: Family, person: string): Place | null {
  const household = family.fullSiblings(person);
  if (household.length < 2) return null;
  const [ordered, decided] = orderSiblings(household.map(asSibling));
  if (!decided) return null;
  return new Place(ordered.findIndex((s) => s.id === person) + 1, ordered.length);
}
