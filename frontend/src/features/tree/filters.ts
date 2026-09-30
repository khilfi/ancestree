import type { Gender, Graph } from "@/api/types";
import { standings } from "@/features/timeline/lanes";

/*
 * Filters and layouts: who the tree and the timeline show, and
 * how the tree is laid out. Both live in the address, so Back and links keep them and the two
 * views read the same ones. Filters run here, on the family the browser already has: instant
 * even at 2,000 people.
 */

export type Scope = "line" | "ancestors" | "descendants" | "blood" | "within";
export type LeaveOut = "married" | "unknown" | "care" | "died" | "living";
export type Missing = "year" | "photo";
export type Layout = "rings" | "tree" | "hourglass" | "fan";

export type TreeFilter = {
  around: string | null; // someone the others are chosen around
  scope: Scope;
  links: number; // how far, for "within"
  leave: ReadonlySet<LeaveOut>;
  generations: readonly [number, number] | null;
  born: readonly [number, number] | null; // birth years
  place: string | null; // born in: a state, a country abroad, or a town
  genders: ReadonlySet<Gender>; // only these; none: any
  missing: ReadonlySet<Missing>;
  others: "hidden" | "faded";
};

export type TreeView = { layout: Layout; depth: number | null; filter: TreeFilter };

export const NO_FILTER: TreeFilter = {
  around: null,
  scope: "line",
  links: 3,
  leave: new Set(),
  generations: null,
  born: null,
  place: null,
  genders: new Set(),
  missing: new Set(),
  others: "hidden",
};

export const LAYOUTS: Layout[] = ["rings", "tree", "hourglass", "fan"];
const SCOPES: Scope[] = ["line", "ancestors", "descendants", "blood", "within"];
const LEAVE: LeaveOut[] = ["married", "unknown", "care", "died", "living"];
const GENDERS: Gender[] = ["male", "female", "unknown"];
const MISSING: Missing[] = ["year", "photo"];

/** The address's keys for the view: kept when someone is opened, or the view changes. */
export const VIEW_KEYS = [
  "layout",
  "depth",
  "around",
  "scope",
  "links",
  "leave",
  "gen",
  "born",
  "place",
  "gender",
  "missing",
  "others",
] as const;

function list<T extends string>(value: string | null, allowed: readonly T[]): Set<T> {
  const words = (value ?? "").split(",");
  return new Set(allowed.filter((item) => words.includes(item)));
}

function range(value: string | null): readonly [number, number] | null {
  const match = /^(-?\d+)-(-?\d+)$/.exec(value ?? "");
  if (!match) return null;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a <= b ? [a, b] : [b, a];
}

function whole(value: string | null, low: number, high: number): number | null {
  const number = Number(value);
  return value && Number.isInteger(number) && number >= low && number <= high ? number : null;
}

export function readView(params: URLSearchParams): TreeView {
  const layout = params.get("layout");
  const scope = params.get("scope");
  return {
    layout: LAYOUTS.includes(layout as Layout) ? (layout as Layout) : "rings",
    depth: whole(params.get("depth"), 1, 8),
    filter: {
      around: params.get("around") || null,
      scope: SCOPES.includes(scope as Scope) ? (scope as Scope) : "line",
      links: whole(params.get("links"), 1, 12) ?? 3,
      leave: list(params.get("leave"), LEAVE),
      generations: range(params.get("gen")),
      born: range(params.get("born")),
      place: params.get("place") || null,
      genders: list(params.get("gender"), GENDERS),
      missing: list(params.get("missing"), MISSING),
      others: params.get("others") === "faded" ? "faded" : "hidden",
    },
  };
}

/** The view in an address: only what differs from the everyone-on-the-rings default. */
export function writeView(view: TreeView, into = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(into);
  for (const key of VIEW_KEYS) params.delete(key);
  const { layout, depth, filter } = view;
  const set = (key: string, value: string | null | false) => {
    if (value) params.set(key, value);
  };
  set("layout", layout !== "rings" && layout);
  set("depth", depth !== null && String(depth));
  set("around", filter.around);
  set("scope", filter.around !== null && filter.scope !== "line" && filter.scope);
  set("links", filter.around !== null && filter.scope === "within" && String(filter.links));
  set("leave", LEAVE.filter((item) => filter.leave.has(item)).join(","));
  set("gen", filter.generations?.join("-") ?? null);
  set("born", filter.born?.join("-") ?? null);
  set("place", filter.place);
  set("gender", GENDERS.filter((item) => filter.genders.has(item)).join(","));
  set("missing", MISSING.filter((item) => filter.missing.has(item)).join(","));
  set("others", filter.others === "faded" && "faded");
  return params;
}

/** Just the view's part of an address, for links between the tree and the timeline. */
export function viewSearch(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of VIEW_KEYS) {
    const value = params.get(key);
    if (value !== null) kept.set(key, value);
  }
  const search = kept.toString();
  return search ? `?${search}` : "";
}

/** An address with the view kept and the rest replaced: opening someone keeps the filters. */
export function withView(params: URLSearchParams, next: Record<string, string>): URLSearchParams {
  const kept = new URLSearchParams(viewSearch(params));
  for (const [key, value] of Object.entries(next)) kept.set(key, value);
  return kept;
}

export function isFiltered(filter: TreeFilter): boolean {
  return (
    filter.around !== null ||
    filter.leave.size > 0 ||
    filter.generations !== null ||
    filter.born !== null ||
    filter.place !== null ||
    filter.genders.size > 0 ||
    filter.missing.size > 0
  );
}

/** Who is linked to whom, by parent links (all kinds, or birth only) and marriages. */
export class Links {
  readonly parents = new Map<string, string[]>();
  readonly children = new Map<string, string[]>();
  readonly spouses = new Map<string, string[]>();

  constructor(graph: Graph, birthOnly: boolean) {
    const add = (map: Map<string, string[]>, key: string, value: string) => {
      const found = map.get(key);
      if (found) found.push(value);
      else map.set(key, [value]);
    };
    for (const link of graph.links) {
      if (link.type === "spouse") {
        add(this.spouses, link.source, link.target);
        add(this.spouses, link.target, link.source);
      } else if (!birthOnly || (link.kind ?? "biological") === "biological") {
        add(this.parents, link.target, link.source);
        add(this.children, link.source, link.target);
      }
    }
  }

  /** Everyone reached from `start` by `step`, with how many steps away. */
  reach(
    start: string,
    step: (id: string) => readonly string[],
    most = Infinity,
  ): Map<string, number> {
    const found = new Map([[start, 0]]);
    let frontier = [start];
    for (let depth = 1; frontier.length && depth <= most; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const other of step(id)) {
          if (found.has(other)) continue;
          found.set(other, depth);
          next.push(other);
        }
      }
      frontier = next;
    }
    return found;
  }

  up = (id: string): readonly string[] => this.parents.get(id) ?? [];
  down = (id: string): readonly string[] => this.children.get(id) ?? [];
  beside = (id: string): readonly string[] => this.spouses.get(id) ?? [];
  any = (id: string): readonly string[] => [...this.up(id), ...this.down(id), ...this.beside(id)];
}

function around(graph: Graph, filter: TreeFilter, focus: string): Set<string> {
  const links = new Links(graph, filter.leave.has("care"));
  const ancestors = () => new Set(links.reach(focus, links.up).keys());
  const descendants = () => new Set(links.reach(focus, links.down).keys());
  switch (filter.scope) {
    case "ancestors":
      return ancestors();
    case "descendants": {
      // With their husbands and wives: a descendant chart shows couples.
      const found = descendants();
      for (const id of [...found]) for (const spouse of links.beside(id)) found.add(spouse);
      return found;
    }
    case "line":
      return new Set([...ancestors(), ...descendants()]);
    case "blood": {
      // Up the birth links to every ancestor, then down from each.
      const birth = new Links(graph, true);
      const found = new Set<string>();
      for (const ancestor of birth.reach(focus, birth.up).keys()) {
        for (const id of birth.reach(ancestor, birth.down).keys()) found.add(id);
      }
      return found;
    }
    case "within":
      return new Set(links.reach(focus, links.any, filter.links).keys());
  }
}

/** Who the filter keeps, or null for everyone. Unknown parents come with their children. */
export function applyFilter(graph: Graph, filter: TreeFilter): Set<string> | null {
  if (!isFiltered(filter)) return null;
  const known = new Set(graph.people.map((person) => person.id));
  const inside =
    filter.around && known.has(filter.around) ? around(graph, filter, filter.around) : null;
  const generation = filter.generations ? standings(graph).of : null;
  const kept = new Set<string>();
  for (const person of graph.people) {
    if (person.placeholder) continue;
    const { id } = person;
    if (inside && !inside.has(id)) continue;
    const seat = graph.layout.seats[id];
    if (filter.leave.has("married") && seat?.unit.startsWith("cluster:")) continue;
    if (filter.leave.has("died") && person.is_living === false) continue;
    if (filter.leave.has("living") && person.is_living === true) continue;
    if (filter.generations && generation) {
      const at = generation.get(id)?.generation;
      if (at === undefined || at < filter.generations[0] || at > filter.generations[1]) continue;
    }
    const year = person.born?.year ?? person.birth_year;
    if (filter.born && (year == null || year < filter.born[0] || year > filter.born[1])) continue;
    if (filter.place && person.born_in !== filter.place) continue;
    if (filter.genders.size && !filter.genders.has(person.gender)) continue;
    if (filter.missing.has("year") && year != null) continue;
    if (filter.missing.has("photo") && person.photo_version != null) continue;
    kept.add(id);
  }
  if (!filter.leave.has("unknown")) {
    // An unknown parent ("?") stays with the children or partner it's linked to.
    const unknown = new Set(graph.people.filter((p) => p.placeholder).map((p) => p.id));
    for (const { source, target } of graph.links) {
      if (unknown.has(source) && kept.has(target)) kept.add(source);
      if (unknown.has(target) && kept.has(source)) kept.add(target);
    }
  }
  return kept;
}

const SCOPE_WORDS: Record<Scope, string> = {
  line: "direct line",
  ancestors: "ancestors",
  descendants: "descendants",
  blood: "blood relatives",
  within: "within links",
};

const LEAVE_WORDS: Record<LeaveOut, string> = {
  married: "Without married-in families",
  unknown: "Without unknown parents",
  care: "Without adoptive and foster links",
  died: "Without those who have died",
  living: "Without the living",
};

const GENDER_WORDS: Record<Gender, string> = {
  male: "men",
  female: "women",
  unknown: "gender not recorded",
};

const MISSING_WORDS: Record<Missing, string> = {
  year: "Missing a birth year",
  photo: "Missing a photo",
};

export function scopeWords(filter: TreeFilter): string {
  return filter.scope === "within"
    ? `within ${filter.links} link${filter.links === 1 ? "" : "s"}`
    : SCOPE_WORDS[filter.scope];
}

export type Chip = { key: string; label: string; without: (filter: TreeFilter) => TreeFilter };

/** The active filters, one chip each, each with how to take it away. */
export function chips(filter: TreeFilter, name: (id: string) => string): Chip[] {
  const found: Chip[] = [];
  if (filter.around) {
    found.push({
      key: "around",
      label: `Around ${name(filter.around)} · ${scopeWords(filter)}`,
      without: (f) => ({ ...f, around: null }),
    });
  }
  for (const item of LEAVE.filter((l) => filter.leave.has(l))) {
    found.push({
      key: `leave:${item}`,
      label: LEAVE_WORDS[item],
      without: (f) => ({ ...f, leave: new Set([...f.leave].filter((l) => l !== item)) }),
    });
  }
  if (filter.generations) {
    const [a, b] = filter.generations;
    found.push({
      key: "gen",
      label: a === b ? `Generation ${a}` : `Generations ${a}–${b}`,
      without: (f) => ({ ...f, generations: null }),
    });
  }
  if (filter.born) {
    const [a, b] = filter.born;
    found.push({
      key: "born",
      label: a === b ? `Born in ${a}` : `Born ${a}–${b}`,
      without: (f) => ({ ...f, born: null }),
    });
  }
  if (filter.place) {
    found.push({
      key: "place",
      label: `Born in ${filter.place}`,
      without: (f) => ({ ...f, place: null }),
    });
  }
  if (filter.genders.size) {
    const words = GENDERS.filter((g) => filter.genders.has(g)).map((g) => GENDER_WORDS[g]);
    found.push({
      key: "gender",
      label: `Only ${words.join(", ")}`,
      without: (f) => ({ ...f, genders: new Set() }),
    });
  }
  for (const item of MISSING.filter((m) => filter.missing.has(m))) {
    found.push({
      key: `missing:${item}`,
      label: MISSING_WORDS[item],
      without: (f) => ({ ...f, missing: new Set([...f.missing].filter((m) => m !== item)) }),
    });
  }
  return found;
}

/** The layouts that suit a filter, best first: ancestors make a fan chart, the
 *  descendants a family tree, a direct line an hourglass. */
export function layoutsFor(filter: TreeFilter): Layout[] {
  if (filter.around) {
    if (filter.scope === "ancestors") return ["fan", "hourglass", "tree", "rings"];
    if (filter.scope === "descendants") return ["tree", "hourglass", "rings", "fan"];
    if (filter.scope === "line") return ["hourglass", "tree", "fan", "rings"];
  }
  return LAYOUTS;
}
