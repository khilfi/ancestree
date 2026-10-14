import type { Graph } from "@/api/types";
import { drawnFrom, type TreeView } from "./filters";

/*
 * Whom an hourglass or fan chart is drawn from, and those it was drawn from before. A
 * click opens someone's panel and leaves the chart as it is; Fan from here, a double-click,
 * Back and Forward are what move it.
 */

function real(graph: Graph, id: string | null | undefined): string | null {
  return id && graph.people.some((person) => person.id === id && !person.placeholder) ? id : null;
}

/** Whom an hourglass or fan chart is (or would be) around: the person it's drawn from; else
 *  the filter's person, whoever is open in the panel, or the centre of the rings. The Layout
 *  menu names them before either is chosen. */
export function focusFor(graph: Graph, view: TreeView, selectedId: string | null): string | null {
  return (
    (drawnFrom(view.layout) ? real(graph, view.from) : null) ??
    real(graph, view.filter.around) ??
    real(graph, selectedId) ??
    graph.layout.units[0]?.centre.map((id) => real(graph, id)).find(Boolean) ??
    null
  );
}

/** The people a chart was drawn from, in order, and which one it's drawn from now. */
export type Trail = { readonly ids: readonly string[]; readonly at: number };

export const NO_TRAIL: Trail = { ids: [], at: -1 };

/** Drawn from `id` now: what was ahead of the one before is dropped, as a browser drops its
 *  forward pages when you go somewhere new. */
export function visit(trail: Trail, id: string): Trail {
  if (trail.ids[trail.at] === id) return trail;
  const ids = [...trail.ids.slice(0, trail.at + 1), id];
  return { ids, at: ids.length - 1 };
}

/** One step back (-1) or forward (+1) along the trail; null at either end. */
export function step(trail: Trail, by: -1 | 1): Trail | null {
  const at = trail.at + by;
  return at >= 0 && at < trail.ids.length ? { ...trail, at } : null;
}
