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
  district: string | null; // a town's, where the gazetteer gives one
  state: string | null;
  country: string;
  rough: boolean; // only its state or country is known: it sits at the middle of that
  // Its own location, finer than its town: the house, the street, the postcode's area,
  // or by hand. None: its town's.
  exact?: "spot" | "street" | "postcode" | "town" | "hand" | null;
  address?: string | null; // where they live, to the house: a spot's name on the map
};

/** Whether a spot is confirmed, and so a pin: placed by hand, or confirmed with
 *  **Looks right**, which keeps it as one placed by hand. Any other, a house found, a street, a
 *  postcode's area or a town, is about there, however near it may be. */
export const pinned = (spot: Pick<Spot, "exact">) => spot.exact === "hand";

/** A pin on the map: a round head on a point, like Google Maps', its tip exactly on the
 *  spot, so the head stands above it. In pixels: its box, the head's middle and the tip. */
export const PIN = {
  width: 40,
  height: 50,
  head: { x: 20, y: 19, r: 17 },
  tip: { x: 20, y: 50 }, // where its outline's edge ends: on the spot
  stroke: 2.5,
};

export type Level = "countries" | "states" | "towns";

// Screen pixels per kilometre at which the map changes what it shows.
export const STATES_FROM = 0.05; // Malaysia about 100 px across: countries below this
export const TOWNS_FROM = 1.2; // a state about 200 px across: towns from here
export const NAMES_FROM = 6; // a town about 30 px across: names under the photos
// The deepest the map goes: MapLibre's zoom 19 in Malaysia, about 0.15 m a pixel (its
// tiles are 512 pixels: measured, 0.148 m), so a child a few metres from their parents has
// a pin of their own, apart.
export const DEEPEST_PER_KM = 6700;

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
  // Its people are about there, at their postcode's area or their town, not to the house:
  // a soft ring says so.
  about?: boolean;
};

const mean = (points: Point[]): Point => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / (points.length || 1),
  y: points.reduce((sum, p) => sum + p.y, 0) / (points.length || 1),
});

/** People at one spot: their pins within about 2 m of each other, the same house to
 *  anyone looking. One spot is one pin. */
export type OneSpot = { key: string; label: string; at: Point };

/**
 * Each pinned spot's one spot: pins within `reach` of each other on the plane are one, at their
 * middle, named by the address most of them have, else their place; a lone pin is a spot of its
 * own. On a grid, so a big family takes a moment; worked out once for the spots, not at each view.
 */
export function oneSpots(spots: readonly Spot[], reach: number): Map<string, OneSpot> {
  const pins = spots.filter((spot) => pinned(spot) && !spot.rough);
  const head = pins.map((_, index) => index);
  const find = (index: number): number => {
    let at = index;
    while (head[at] !== at) at = head[at] as number;
    head[index] = at;
    return at;
  };
  const grid = new Map<string, number[]>();
  const cellOf = (spot: Spot) => [Math.floor(spot.x / reach), Math.floor(spot.y / reach)];
  pins.forEach((spot, index) => {
    const [cx, cy] = cellOf(spot) as [number, number];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${cx + dx}|${cy + dy}`) ?? []) {
          const near = pins[other] as Spot;
          if (Math.hypot(near.x - spot.x, near.y - spot.y) <= reach) {
            head[find(index)] = find(other);
          }
        }
      }
    }
    const key = `${cx}|${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), index]);
  });
  const together = new Map<number, Spot[]>();
  pins.forEach((spot, index) => {
    const root = find(index);
    together.set(root, [...(together.get(root) ?? []), spot]);
  });
  const found = new Map<string, OneSpot>();
  for (const members of together.values()) {
    const named = new Map<string, number>();
    for (const { address } of members) {
      if (address) named.set(address, (named.get(address) ?? 0) + 1);
    }
    const [address] = [...named].sort((a, b) => b[1] - a[1])[0] ?? [];
    const first = members[0] as Spot;
    const spot = { key: `spot:${first.id}`, label: address ?? first.place, at: mean(members) };
    for (const member of members) found.set(member.id, spot);
  }
  return found;
}

/**
 * Everyone gathered for a level: by country, by state (at the state's middle, where its
 * shape is known), or by town, people at one spot as one pin. Biggest first.
 */
export function gather(
  spots: readonly Spot[],
  level: Level,
  toScreen: (point: Point) => Point,
  stateMiddle: (state: string) => Point | null,
  spotAt: (id: string) => OneSpot | undefined = () => undefined,
): Group[] {
  const gathered = new Map<
    string,
    { label: string; members: Spot[]; rough: boolean; anchor: Point | null; about: boolean }
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
      const one = spotAt(spot.id);
      key = one?.key ?? `${spot.x.toFixed(2)}|${spot.y.toFixed(2)}|${spot.place}`;
      label = one?.label ?? (spot.rough ? `Somewhere in ${spot.place}` : spot.place);
      anchor = one?.at ?? { x: spot.x, y: spot.y };
    }
    const group = gathered.get(key);
    const about = !pinned(spot);
    if (group) {
      group.members.push(spot);
      group.rough &&= spot.rough;
      group.about &&= about;
    } else gathered.set(key, { label, members: [spot], rough: spot.rough, anchor, about });
  }
  return [...gathered]
    .map(([key, { label, members, rough, anchor, about }]) => ({
      key,
      label,
      at: anchor ? toScreen(anchor) : mean(members.map(toScreen)),
      members: members.map((spot) => spot.id),
      rough,
      towns: level === "towns" ? 1 : 0,
      about: level === "towns" && about,
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
