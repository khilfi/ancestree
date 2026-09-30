import type { Graph } from "@/api/types";

/*
 * How close everyone is to you, for "Me": blood relatives by
 * degree, counted as up to the shared ancestor and down again (a parent or child 1; a brother,
 * sister or grandparent 2; an uncle, aunt, nephew or niece 3; a first cousin 4 …); others you're
 * linked to, by marriage or adoption, apart; and no one else.
 */

export type Closeness = { kind: "blood"; degree: number } | { kind: "linked" };

function append(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function reach(start: string, next: (id: string) => readonly string[]): Map<string, number> {
  const found = new Map([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; frontier.length; depth++) {
    const following: string[] = [];
    for (const id of frontier) {
      for (const other of next(id)) {
        if (found.has(other)) continue;
        found.set(other, depth);
        following.push(other);
      }
    }
    frontier = following;
  }
  return found;
}

export function closeness(graph: Graph, me: string): Map<string, Closeness> {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const near = new Map<string, string[]>();
  for (const link of graph.links) {
    append(near, link.source, link.target);
    append(near, link.target, link.source);
    if (link.type === "parent" && (link.kind ?? "biological") === "biological") {
      append(parents, link.target, link.source);
      append(children, link.source, link.target);
    }
  }
  const found = new Map<string, Closeness>();
  // Up to each ancestor, then down from them: the fewest steps is the degree.
  for (const [ancestor, up] of reach(me, (id) => parents.get(id) ?? [])) {
    for (const [relative, down] of reach(ancestor, (id) => children.get(id) ?? [])) {
      const degree = up + down;
      const known = found.get(relative);
      if (!known || (known.kind === "blood" && degree < known.degree)) {
        found.set(relative, { kind: "blood", degree });
      }
    }
  }
  for (const id of reach(me, (id) => near.get(id) ?? []).keys()) {
    if (!found.has(id)) found.set(id, { kind: "linked" });
  }
  return found;
}

/** The colours: warm for the closest, cooler further out; violet for those linked otherwise. */
export const CLOSENESS_COLOURS = {
  you: "#9a3412",
  degrees: ["#dc2626", "#f97316", "#eab308", "#65a30d", "#0d9488", "#0284c7"], // 1 … 6 and more
  linked: "#a78bfa",
} as const;

export function closenessColour(place: Closeness | undefined): string | null {
  if (!place) return null;
  if (place.kind === "linked") return CLOSENESS_COLOURS.linked;
  if (place.degree === 0) return CLOSENESS_COLOURS.you;
  const { degrees } = CLOSENESS_COLOURS;
  return degrees[Math.min(place.degree, degrees.length) - 1] ?? null;
}
