/*
 * What the map shows at each zoom: a circle for each country, then
 * each state, with how many people are there; then each town's people, as their photos.
 * Worked out in screen pixels, so nothing covers anything; plain arithmetic, tested without a
 * browser.
 */

export type Point = { x: number; y: number };

/** One person on the map, where their place is on the plane. */
export type Spot = {
  id: string;
  x: number;
  y: number;
  place: string; // what it was found as: the town, or the state or country for a rough one
  state: string | null;
  country: string;
  rough: boolean; // only its state or country is known: it sits at the middle of that
};

export type Level = "countries" | "states" | "towns";

// Screen pixels per kilometre at which the map changes what it shows.
export const STATES_FROM = 0.05; // Malaysia about 100 px across: countries below this
export const TOWNS_FROM = 1.2; // a state about 200 px across: towns from here
export const NAMES_FROM = 6; // a town about 30 px across: names under the photos

export function levelAt(perKm: number): Level {
  return perKm < STATES_FROM ? "countries" : perKm < TOWNS_FROM ? "states" : "towns";
}

/** A circle on the map: a country's, a state's or a town's people. */
export type Group = {
  key: string;
  label: string; // "Selangor", "Shah Alam", "Somewhere in Kelantan"
  at: Point; // on screen
  members: string[];
  rough: boolean; // at the middle of a state or country whose town isn't known
  towns: number; // how many towns are in it: 0 above the towns, more than 1 when merged
};

const mean = (points: Point[]): Point => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / (points.length || 1),
  y: points.reduce((sum, p) => sum + p.y, 0) / (points.length || 1),
});

/**
 * Everyone gathered for a level: by country, by state (at the state's middle, where its
 * shape is known), or by town. Biggest first.
 */
export function gather(
  spots: readonly Spot[],
  level: Level,
  toScreen: (point: Point) => Point,
  stateMiddle: (state: string) => Point | null,
): Group[] {
  const gathered = new Map<
    string,
    { label: string; members: Spot[]; rough: boolean; anchor: Point | null }
  >();
  for (const spot of spots) {
    let key: string;
    let label: string;
    let anchor: Point | null = null;
    if (level === "countries") {
      key = spot.country;
      label = spot.country;
    } else if (level === "states") {
      // A country without states, such as Singapore, is its own.
      key = `${spot.country}|${spot.state ?? ""}`;
      label = spot.state ?? spot.country;
      anchor = spot.state ? stateMiddle(spot.state) : null;
    } else {
      key = `${spot.x.toFixed(2)}|${spot.y.toFixed(2)}|${spot.place}`;
      label = spot.rough ? `Somewhere in ${spot.place}` : spot.place;
      anchor = { x: spot.x, y: spot.y };
    }
    const group = gathered.get(key);
    if (group) {
      group.members.push(spot);
      group.rough &&= spot.rough;
    } else gathered.set(key, { label, members: [spot], rough: spot.rough, anchor });
  }
  return [...gathered]
    .map(([key, { label, members, rough, anchor }]) => ({
      key,
      label,
      at: anchor ? toScreen(anchor) : mean(members.map(toScreen)),
      members: members.map((spot) => spot.id),
      rough,
      towns: level === "towns" ? 1 : 0,
    }))
    .sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
}

/** A count's circle: bigger for more people, never too small to read, and small enough for
 *  the Peninsula's states to sit side by side: past about 60 people the number says how many. */
export function bubbleRadius(count: number): number {
  return Math.min(32, 12 + 2.5 * Math.sqrt(count));
}

const GAP = 6;

/**
 * Circles pushed apart until none overlaps, the smaller moving more: a state's circle stays
 * near its state, and Selangor's doesn't hide Kuala Lumpur's.
 */
export function separate(groups: Group[], radius: (group: Group) => number): Group[] {
  const at = groups.map((group) => ({ ...group.at }));
  const radii = groups.map(radius);
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        const [a, b] = [at[i] as Point, at[j] as Point];
        const [ra, rb] = [radii[i] ?? 0, radii[j] ?? 0];
        let [dx, dy] = [b.x - a.x, b.y - a.y];
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          // On top of each other: apart in a direction of their own.
          [dx, dy] = [Math.cos(j * 2.4), Math.sin(j * 2.4)];
          distance = 1;
        }
        const need = ra + rb + GAP;
        if (distance >= need) continue;
        const push = need - distance;
        const [ux, uy] = [dx / distance, dy / distance];
        const shareA = rb / (ra + rb || 1);
        a.x -= ux * push * shareA;
        a.y -= uy * push * shareA;
        b.x += ux * push * (1 - shareA);
        b.y += uy * push * (1 - shareA);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return groups.map((group, index) => ({ ...group, at: at[index] ?? group.at }));
}

/**
 * Towns that would cover each other become one circle, at the bigger town, with how many
 * towns it holds: a click zooms in to them. Biggest first, on a grid, so thousands of people
 * take a moment.
 */
export function mergeTowns(groups: Group[], radius: (group: Group) => number): Group[] {
  const merged: Group[] = [];
  const cell = 90;
  const grid = new Map<string, number[]>();
  const cellOf = (p: Point) => [Math.floor(p.x / cell), Math.floor(p.y / cell)] as const;
  for (const group of groups) {
    const [cx, cy] = cellOf(group.at);
    let hit: Group | undefined;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const index of grid.get(`${cx + dx}|${cy + dy}`) ?? []) {
          const other = merged[index] as Group;
          const distance = Math.hypot(other.at.x - group.at.x, other.at.y - group.at.y);
          if (distance < radius(other) + radius(group)) {
            hit = other;
            break;
          }
        }
      }
    }
    if (hit) {
      hit.members = [...hit.members, ...group.members];
      hit.towns += group.towns;
      hit.rough = hit.rough && group.rough;
    } else {
      merged.push({ ...group, members: [...group.members] });
      const key = `${cx}|${cy}`;
      grid.set(key, [...(grid.get(key) ?? []), merged.length - 1]);
    }
  }
  return merged;
}

export const PHOTO = 34; // a photo's size on the map, in pixels
export const MOST = 12; // photos a town shows before "+8"

// The sunflower's step, and how far out its second photo starts: a whole photo from the first.
const STEP = 0.62;
const START = 1.6;

/**
 * Where each photo of a town goes around its point: a sunflower, the first in the middle and
 * each next one further round and out by the golden angle, so they pack evenly without
 * covering each other.
 */
export function sunflower(count: number, spacing: number): Point[] {
  const step = spacing * STEP;
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? { x: 0, y: 0 }
      : {
          x: step * Math.sqrt(index + START) * Math.cos(index * 2.39996),
          y: step * Math.sqrt(index + START) * Math.sin(index * 2.39996),
        },
  );
}

/** How far a town's photos reach from its point. */
export function flowerRadius(count: number, spacing: number): number {
  return count <= 1 ? spacing / 2 : spacing * STEP * Math.sqrt(count - 1 + START) + spacing / 2;
}
