/**
 * Ways round the family through any link: parents and children of every kind, and marriages
 * (backend/src/ancestree/kinship/routes.py). In-laws and step-family are found this way.
 */
import { type Family, other } from "./family";

export type Move = "u" | "d" | "="; // to a parent, to a child, to a spouse

export type Step = {
  move: Move;
  to: string;
  link: string; // the link's id, for highlighting
  kind: string | null; // parent links: the relationship kind
};

const MAX_STEPS = 24; // far beyond any useful answer, but it keeps a search bounded
const MAX_ROUTES = 64;

export function stepsFrom(family: Family, person: string): Step[] {
  const steps: Step[] = [];
  for (const link of family.up(person)) {
    steps.push({ move: "u", to: link.parent, link: link.id, kind: link.kind });
  }
  for (const link of family.down(person)) {
    steps.push({ move: "d", to: link.child, link: link.id, kind: link.kind });
  }
  for (const marriage of family.wed(person)) {
    steps.push({ move: "=", to: other(marriage, person), link: marriage.id, kind: null });
  }
  return steps;
}

/** Every shortest way from A to B (up to MAX_ROUTES of them); none if unconnected. */
export function shortestRoutes(family: Family, a: string, b: string): Step[][] {
  const reached = new Map<string, number>([[a, 0]]);
  const before = new Map<string, [string, Step][]>();
  let frontier = [a];
  let depth = 0;
  while (frontier.length && !reached.has(b) && depth < MAX_STEPS) {
    depth += 1;
    const found: string[] = [];
    for (const person of frontier) {
      for (const step of stepsFrom(family, person)) {
        if (!reached.has(step.to)) {
          reached.set(step.to, depth);
          found.push(step.to);
        }
        if (reached.get(step.to) === depth) {
          const list = before.get(step.to);
          if (list) list.push([person, step]);
          else before.set(step.to, [[person, step]]);
        }
      }
    }
    frontier = found;
  }
  if (!reached.has(b)) return [];

  const routes: Step[][] = [];
  const back = (person: string, tail: Step[]): void => {
    if (routes.length >= MAX_ROUTES) return;
    if (person === a) {
      routes.push(tail.toReversed());
      return;
    }
    for (const [previous, step] of before.get(person) ?? []) back(previous, [...tail, step]);
  };
  back(b, []);
  return routes;
}

/** Every way from A to B in at most `most` steps that never visits anyone twice. For the
 *  relations a closer tie hides, e.g. a cousin who is also a sister-in-law. */
export function shortRoutes(family: Family, a: string, b: string, most: number): Step[][] {
  const routes: Step[][] = [];
  const walk = (person: string, seen: Set<string>, taken: Step[]): void => {
    if (routes.length >= MAX_ROUTES) return;
    for (const step of stepsFrom(family, person)) {
      if (step.to === b) {
        routes.push([...taken, step]);
      } else if (!seen.has(step.to) && taken.length + 1 < most) {
        walk(step.to, new Set([...seen, step.to]), [...taken, step]);
      }
    }
  };
  walk(a, new Set([a]), []);
  return routes
    .map((route, index) => ({ route, index }))
    .sort((x, y) => x.route.length - y.route.length || x.index - y.index)
    .map(({ route }) => route);
}
