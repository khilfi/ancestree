import type { Graph, GraphPerson, PartialDate, Seat } from "@/api/types";
import { branchColours } from "@/features/tree/colours";
import { generationShifts } from "@/features/tree/generations";
import { ageOf, yearOf } from "@/lib/dates";

/*
 * The timeline: one lane per person, a photo at the birth year and a
 * bar across their lifetime, grouped by lineage generation (as on the rings) or branch.
 * Everything here is plain arithmetic, so it can be tested without a browser.
 */

export { yearNow } from "@/lib/dates";

export type Grouping = "generation" | "branch" | "none";
export type Sorting = "birth" | "name" | "death";
export type View = { start: number; end: number }; // the years in view, with fractions

export const GROUP_HEIGHT = 34;
export const LANE_HEIGHT = 44;
export const MIN_SPAN = 5; // zoomed in: half a decade across
export const MAX_SPAN = 400;
const FADE_YEARS = 60; // how long a bar lasts before fading out when the death date is unknown

function rough(date: PartialDate): boolean {
  return date.qualifier !== "exact";
}

function said(date: PartialDate): string {
  if (date.qualifier === "between" && date.year_to != null) return `c. ${Math.round(yearOf(date))}`;
  const prefix = { exact: "", about: "c. ", before: "bef. ", after: "aft. ", between: "" };
  return `${prefix[date.qualifier]}${date.year}`;
}

export type Span = {
  person: GraphPerson;
  start: number | null; // the birth, where the photo sits; null: only the death is known
  end: number; // where the bar ends
  ending: "death" | "today" | "unknown"; // unknown: died, but not recorded when
  roughStart: boolean; // an approximate date: a soft end and "c."
  roughEnd: boolean;
  years: string; // "c. 1901–1975", "b. 1962", "d. 1975"
  age: string | null; // "died aged 74", "43 years old": as everywhere else (lib/dates)
};

/** Someone's lane, or null when they have no dates: they wait in the Undated tray. */
export function span(person: GraphPerson, today: number): Span | null {
  const born = person.born?.year != null ? person.born : null;
  const died = person.died?.year != null ? person.died : null;
  if (!born && !died) return null;
  const { age } = ageOf({ born, died, living: person.is_living }, today);
  if (!born && died) {
    return {
      person,
      start: null,
      end: yearOf(died),
      ending: "death",
      roughStart: true,
      roughEnd: rough(died),
      years: `d. ${said(died)}`,
      age: null,
    };
  }
  const bornDate = born as PartialDate;
  const start = yearOf(bornDate);
  if (died) {
    return {
      person,
      start,
      end: yearOf(died),
      ending: "death",
      roughStart: rough(bornDate),
      roughEnd: rough(died),
      years: `${said(bornDate)}–${said(died)}`,
      age,
    };
  }
  if (person.is_living) {
    return {
      person,
      start,
      end: Math.max(today, start),
      ending: "today",
      roughStart: rough(bornDate),
      roughEnd: false,
      years: `b. ${said(bornDate)}`,
      age,
    };
  }
  return {
    person,
    start,
    end: Math.min(start + FADE_YEARS, Math.max(today, start)),
    ending: "unknown",
    roughStart: rough(bornDate),
    roughEnd: true,
    years: `b. ${said(bornDate)}`,
    age: null,
  };
}

export function spans(
  people: GraphPerson[],
  today: number,
): { placed: Span[]; undated: GraphPerson[] } {
  const placed: Span[] = [];
  const undated: GraphPerson[] = [];
  for (const person of people) {
    if (person.placeholder) continue; // unknown parents have no life to draw
    const lane = span(person, today);
    if (lane) placed.push(lane);
    else undated.push(person);
  }
  return { placed, undated };
}

/** Where someone sits in the family: their lineage generation (as on the rings), which family
 *  (the main one is 0), and their branch. A married-in family lines up with the person who
 *  married in: a wife's sister is in her generation. Nobody here: not linked yet. */
export type Standing = { generation: number; family: number; branch: string | null };

export function standings(graph: Graph): { of: Map<string, Standing>; branchOrder: string[] } {
  const byUnit = new Map<string, [string, Seat][]>();
  for (const [id, seat] of Object.entries(graph.layout.seats)) {
    const list = byUnit.get(seat.unit);
    if (list) list.push([id, seat]);
    else byUnit.set(seat.unit, [[id, seat]]);
  }
  const of = new Map<string, Standing>();
  // The same shift the rings number a married-in family's generations with (D29).
  const shifts = generationShifts(graph);
  for (const unit of graph.layout.units) {
    const members = byUnit.get(unit.id) ?? [];
    if (!unit.anchor) {
      const family = Number(unit.id.split(":")[1] ?? 0) || 0;
      for (const [id, seat] of members) {
        of.set(id, { generation: seat.generation, family, branch: seat.branch });
      }
      continue;
    }
    const anchor = of.get(unit.anchor);
    const shift = shifts.get(unit.id);
    if (!anchor || shift === undefined) continue;
    for (const [id, seat] of members) {
      of.set(id, { ...anchor, generation: seat.generation + shift });
    }
  }
  // Branches in the order the tree colours them: by where they start on the rings.
  const branchOrder = [...branchColours(graph).keys()];
  return { of, branchOrder };
}

export type Row =
  | { kind: "group"; key: string; label: string; count: number; top: number }
  | { kind: "lane"; key: string; span: Span; top: number };

type Group = { key: string; label: string; rank: number[]; lanes: Span[] };

/** The lanes in order, under a header per group, each at its height down the page. */
export function arrange(
  lanes: Span[],
  standing: ReturnType<typeof standings>,
  names: Map<string, string>,
  grouping: Grouping,
  sorting: Sorting,
): { rows: Row[]; height: number } {
  const groups = new Map<string, Group>();
  for (const lane of lanes) {
    const where = standing.of.get(lane.person.id);
    const { key, label, rank } = groupOf(where, grouping, standing.branchOrder, names);
    const group = groups.get(key);
    if (group) group.lanes.push(lane);
    else groups.set(key, { key, label, rank, lanes: [lane] });
  }
  const ordered = [...groups.values()].sort((a, b) => compareRanks(a.rank, b.rank));
  const rows: Row[] = [];
  let top = 0;
  for (const group of ordered) {
    if (grouping !== "none") {
      rows.push({
        kind: "group",
        key: group.key,
        label: group.label,
        count: group.lanes.length,
        top,
      });
      top += GROUP_HEIGHT;
    }
    for (const lane of group.lanes.sort(byOrder(sorting, names))) {
      rows.push({ kind: "lane", key: lane.person.id, span: lane, top });
      top += LANE_HEIGHT;
    }
  }
  return { rows, height: top };
}

function groupOf(
  where: Standing | undefined,
  grouping: Grouping,
  branchOrder: string[],
  names: Map<string, string>,
): { key: string; label: string; rank: number[] } {
  if (grouping === "none") return { key: "all", label: "Everyone", rank: [0] };
  if (!where) return { key: "unlinked", label: "Not linked yet", rank: [9e9] };
  if (grouping === "generation") {
    const label =
      where.family === 0
        ? `Generation ${where.generation}`
        : `Another family: generation ${where.generation}`;
    return {
      key: `generation:${where.family}:${where.generation}`,
      label,
      rank: [where.family, where.generation],
    };
  }
  if (where.family !== 0) {
    return { key: `family:${where.family}`, label: "Another family", rank: [2, where.family] };
  }
  if (!where.branch) return { key: "trunk", label: "The oldest generations", rank: [0] };
  const index = branchOrder.indexOf(where.branch);
  return {
    key: `branch:${where.branch}`,
    label: `${names.get(where.branch) ?? "A"}'s branch`,
    rank: [1, index === -1 ? branchOrder.length : index],
  };
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? -1) - (b[i] ?? -1);
    if (difference) return difference;
  }
  return 0;
}

/** Birth year (birth order for twins), name, or death year. */
function byOrder(sorting: Sorting, names: Map<string, string>): (a: Span, b: Span) => number {
  const name = (lane: Span) => names.get(lane.person.id) ?? lane.person.full_name;
  const byName = (a: Span, b: Span) =>
    name(a).localeCompare(name(b), undefined, { sensitivity: "base" });
  const byBirth = (a: Span, b: Span) =>
    (a.start ?? a.end) - (b.start ?? b.end) ||
    (a.person.birth_order ?? 999) - (b.person.birth_order ?? 999) ||
    byName(a, b);
  if (sorting === "name") return (a, b) => byName(a, b) || byBirth(a, b);
  if (sorting === "death") {
    const died = (lane: Span) => (lane.ending === "death" ? lane.end : Number.POSITIVE_INFINITY);
    return (a, b) => died(a) - died(b) || byBirth(a, b);
  }
  return byBirth;
}

/** The first and last rows that reach into view, from their heights down the page. */
export function visibleRows(rows: Row[], from: number, to: number): Row[] {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const row = rows[middle];
    if (row && row.top + LANE_HEIGHT < from) low = middle + 1;
    else high = middle;
  }
  const shown: Row[] = [];
  for (let i = low; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.top > to) break;
    shown.push(row);
  }
  return shown;
}

/** Year marks that fit: every 50, 10, 5 or 1 year as the zoom allows. */
export function yearTicks(view: View, width: number): number[] {
  const perYear = width / (view.end - view.start);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200].find((s) => s * perYear >= 64) ?? 200;
  const marks: number[] = [];
  for (let year = Math.ceil(view.start / step) * step; year <= view.end; year += step) {
    marks.push(year);
  }
  return marks;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Zoom by `factor` (more than 1 zooms in) keeping the year `at` where it is on screen. */
export function zoomAround(view: View, factor: number, at: number): View {
  const span = clamp((view.end - view.start) / factor, MIN_SPAN, MAX_SPAN);
  const start = at - ((at - view.start) * span) / (view.end - view.start);
  return { start, end: start + span };
}

export function panBy(view: View, years: number): View {
  return { start: view.start + years, end: view.end + years };
}

/** Everyone's lives, with a little room either side; a century when nobody is dated yet. */
export function fitAll(lanes: Span[], today: number): View {
  const starts = lanes.map((lane) => lane.start ?? lane.end);
  const ends = lanes.map((lane) => lane.end);
  if (!starts.length) return { start: today - 100, end: today + 5 };
  const from = Math.min(...starts);
  const to = Math.max(today, ...ends);
  const margin = Math.max(3, (to - from) * 0.04);
  const view = { start: from - margin, end: to + margin };
  const span = view.end - view.start;
  if (span >= MIN_SPAN) return view;
  const middle = (view.start + view.end) / 2;
  return { start: middle - MIN_SPAN / 2, end: middle + MIN_SPAN / 2 };
}
