/*
 * A bundle on the map: people too close together to show
 * apart, as one circle. Named by its eldest, opened where it is when zooming in wouldn't part
 * them. One spot: people at the same house, one pin, whose people stand in
 * columns above it when it's opened. Plain arithmetic, tested without a browser.
 */
import type { GraphPerson } from "@/api/types";
import { shortName } from "@/features/tree/words";
import { PLANE_PER_KM } from "./geo";
import { MOST, type Point, type Spot } from "./levels";

/** People within this of each other are at one spot, the same house to anyone looking. */
export const SPOT_KM = 0.002;
/** The most an opened spot stands in one column; fewer where the window is short. */
export const COLUMN = 8;
/** The most columns an opened spot stands in: more people open as a card. */
export const COLUMNS = 5;
/** A bundle whose people are within this of each other opens where it is: zooming in, even to
 *  the deepest, wouldn't part them. */
export const TOGETHER_KM = 0.03;
/** How many a bundle opens as photos around its spot; more, as a card. */
export const FANNED = MOST;

type Someone = Pick<GraphPerson, "full_name" | "nickname" | "birth_year" | "born">;

/**
 * Eldest first: the one born first, an approximate date counting by its year; then those with
 * no date of birth, by their generation on the rings, then their name.
 */
export function eldestFirst(
  ids: readonly string[],
  people: ReadonlyMap<string, Someone>,
  generationOf: (id: string) => number | undefined,
): string[] {
  const key = (id: string) => {
    const person = people.get(id);
    const year = person?.born?.year ?? person?.birth_year ?? null;
    return {
      dated: year != null,
      when: [year ?? 0, person?.born?.month ?? 0, person?.born?.day ?? 0],
      generation: generationOf(id) ?? Number.POSITIVE_INFINITY,
      name: person?.full_name ?? "",
    };
  };
  const keys = new Map(ids.map((id) => [id, key(id)]));
  return [...ids].sort((a, b) => {
    const [x, y] = [keys.get(a), keys.get(b)];
    if (!x || !y) return 0;
    if (x.dated !== y.dated) return x.dated ? -1 : 1;
    for (let part = 0; x.dated && part < 3; part++) {
      const by = (x.when[part] ?? 0) - (y.when[part] ?? 0);
      if (by) return by;
    }
    return x.generation - y.generation || x.name.localeCompare(y.name);
  });
}

/** "Fatimah and 2 more": the eldest's short name, and everyone else. */
export function bundleName(eldest: readonly string[], people: ReadonlyMap<string, Someone>) {
  const first = people.get(eldest[0] ?? "");
  const name = first ? shortName(first) : "Someone";
  const more = eldest.length - 1;
  return more > 0 ? `${name} and ${more} more` : name;
}

/** "Fatimah, Aminah, Zulkifli and 4 more": the first few, eldest first. */
export function firstFew(
  eldest: readonly string[],
  people: ReadonlyMap<string, Someone>,
  few = 3,
): string {
  const names = eldest.slice(0, few).map((id) => {
    const person = people.get(id);
    return person ? shortName(person) : "";
  });
  const more = eldest.length - names.length;
  return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
}

/** Where a spot is, as the map says it: "Kajang, Hulu Langat". */
export function spotPlace(spot: Pick<Spot, "place" | "district" | "rough">): string {
  if (spot.rough) return `Somewhere in ${spot.place}`;
  return spot.district && spot.district !== spot.place
    ? `${spot.place}, ${spot.district}`
    : spot.place;
}

/** Where a bundle's people are: one place, or the most of them first: "Klang and 2 more places". */
export function bundlePlace(
  ids: readonly string[],
  spotOf: (id: string) => Spot | undefined,
): string {
  const counted = new Map<string, number>();
  for (const id of ids) {
    const spot = spotOf(id);
    if (spot) counted.set(spotPlace(spot), (counted.get(spotPlace(spot)) ?? 0) + 1);
  }
  const places = [...counted].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [first] = places[0] ?? [""];
  const more = places.length - 1;
  return more > 0 ? `${first} and ${more} more place${more === 1 ? "" : "s"}` : first;
}

/** How far apart a bundle's people are, in km: across the box around their spots. */
export function spreadKm(ids: readonly string[], spotOf: (id: string) => Spot | undefined) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const spot = spotOf(id);
    if (!spot) continue;
    [x0, y0] = [Math.min(x0, spot.x), Math.min(y0, spot.y)];
    [x1, y1] = [Math.max(x1, spot.x), Math.max(y1, spot.y)];
  }
  return x0 === Infinity ? 0 : Math.hypot(x1 - x0, y1 - y0) / PLANE_PER_KM;
}

/** Whether a bundle opens where it is: its people within about 30 m, or the map at its
 *  deepest, where zooming in would part nothing. */
export function opensHere(
  ids: readonly string[],
  spotOf: (id: string) => Spot | undefined,
  deepest: boolean,
): boolean {
  return deepest || spreadKm(ids, spotOf) <= TOGETHER_KM;
}

/** Where each photo of an open bundle goes: a ring around its spot, the first at the top and
 *  the rest clockwise, far enough out for their names to sit apart. */
export function fanned(count: number, width: number): { at: Point[]; radius: number } {
  const radius = Math.max(56, (count * width) / (2 * Math.PI));
  const at = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(count, 1);
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  return { at, radius };
}

/** How an opened spot stands: `rows` the window has room for above its pin. Up to 8 to a
 *  column, the next column beside it; past 5 columns, a card instead. */
export function stacked(count: number, rows: number) {
  const perColumn = Math.max(1, Math.min(COLUMN, rows));
  const columns = Math.ceil(count / perColumn);
  return { perColumn, columns, card: columns > COLUMNS };
}
