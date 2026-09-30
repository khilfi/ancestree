import type { Graph, KinRelation } from "@/api/types";
import type { TreeEdge } from "@/features/tree/toFlow";

/** What lights up for one way two people are related: everyone on the path, the
 *  shared ancestors (a couple at the top), and the lines between them. */
export type Glow = { people: Set<string>; edges: Set<string> };

export function glowFor(relation: KinRelation, edges: readonly TreeEdge[]): Glow {
  const people = new Set([...relation.path, ...relation.shared_ancestors]);
  const links = new Set(relation.links);
  const lit = new Set<string>();
  for (const edge of edges) {
    if (edge.type === "child" && edge.data?.links.some((link) => links.has(link.id))) {
      lit.add(edge.id);
    } else if (edge.type === "spouse" && edge.data && links.has(edge.data.link.id)) {
      lit.add(edge.id);
    }
  }
  // The couple the two descend from: the line between them glows too.
  const [one, other] = relation.shared_ancestors;
  if (one && other) {
    for (const edge of edges) {
      const ends = [edge.source, edge.target];
      if (
        (edge.type === "spouse" || edge.type === "pair") &&
        ends.includes(one) &&
        ends.includes(other)
      ) {
        lit.add(edge.id);
      }
    }
  }
  return { people, edges: lit };
}

/** The folded clusters to open so that all of `people` can be seen, nested ones included. */
export function clustersToOpen(graph: Graph, people: Iterable<string>): string[] {
  const units = new Map(graph.layout.units.map((unit) => [unit.id, unit]));
  const open = new Set<string>();
  for (const id of people) {
    let unit = units.get(graph.layout.seats[id]?.unit ?? "");
    while (unit?.anchor && !open.has(unit.id)) {
      open.add(unit.id);
      unit = units.get(graph.layout.seats[unit.anchor]?.unit ?? "");
    }
  }
  return [...open];
}
