import { type Edge, MarkerType } from "@xyflow/react";
import type { Graph, GraphLink, TreeSettings } from "@/api/types";
import { closeness, closenessColour } from "@/lib/closeness";
import { lifeYears } from "@/lib/people";
import { branchColours, generationColour } from "./colours";
import type { ChildFlowEdge, PairFlowEdge, SpouseFlowEdge } from "./edges";
import { generationShifts, treeGeneration } from "./generations";
import { cornerFor, nodeHandles, nodeSize } from "./geometry";
import type { PersonFlowNode } from "./PersonNode";
import type { RingLayout } from "./rings";

export type TreeEdge = ChildFlowEdge | SpouseFlowEdge | PairFlowEdge;

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Each person's colour on the rings: their branch's or generation's, how close they are to
 *  you ("Me"), or none. The timeline colours lifespans the same way. */
export function colourer(
  graph: Graph,
  colours: TreeSettings["colours"],
  me: string | null = null,
): (id: string) => string | null {
  if (colours === "closeness") {
    if (!me) return () => null; // until you've chosen who you are
    const places = closeness(graph, me);
    return (id) => closenessColour(places.get(id));
  }
  if (colours === "off") return () => null;
  if (colours === "generation") {
    // Married-in families too, in the tree's own generations: a wife's sister takes
    // the colour of the wife's generation.
    const shifts = generationShifts(graph);
    return (id) => {
      const generation = treeGeneration(graph, shifts, id);
      return generation === null ? null : generationColour(generation);
    };
  }
  // A branch's colour follows its line outward. A married-in family isn't of any
  // branch, so it stays grey.
  const colourOf = branchColours(graph);
  return (id) => {
    const seat = graph.layout.seats[id];
    const branch = seat && !seat.unit.startsWith("cluster:") ? seat.branch : null;
    return branch ? (colourOf.get(branch) ?? null) : null;
  };
}

export type FlowOptions = {
  me?: string | null; // who you are, for colouring by closeness
  saved?: boolean; // put people where they were dragged to (the rings only)
  elbows?: boolean; // links from parents drop down, across and down (the top-to-bottom layouts)
  faded?: ReadonlySet<string> | null; // a filter's others, shown faded; null: none
  care?: boolean; // adoptive and foster links; false when a filter leaves them out
};

/** The graph as the canvas's people and links. Selection is applied separately. */
export function toFlow(
  graph: Graph,
  layout: RingLayout,
  colours: TreeSettings["colours"],
  {
    me = null,
    saved: useSaved = true,
    elbows = false,
    faded = null,
    care = true,
  }: FlowOptions = {},
): { nodes: PersonFlowNode[]; edges: TreeEdge[] } {
  const shown = (id: string) => !layout.hidden.has(id) && layout.points.has(id);
  const dim = (...ids: string[]) =>
    faded && ids.some((id) => !faded.has(id)) ? "tree-faded" : undefined;
  const colourOf = colourer(graph, colours, me);

  const nodes: PersonFlowNode[] = graph.people
    .filter((p) => shown(p.id))
    .map((person) => {
      const point = layout.points.get(person.id) ?? { x: 0, y: 0 };
      const saved =
        useSaved && person.x != null && person.y != null ? { x: person.x, y: person.y } : null;
      const size = nodeSize(person.placeholder);
      return {
        id: person.id,
        type: person.placeholder ? "unknown" : "person",
        position: saved ?? cornerFor(point, person.placeholder),
        className: dim(person.id),
        ...size,
        measured: size,
        handles: nodeHandles(person.placeholder),
        data: {
          person,
          years: lifeYears(person),
          colour: colourOf(person.id),
          folds: layout.folds.get(person.id) ?? [],
        },
      };
    });

  // A child's birth parents share one line from the dot between them; other parents
  // (adoptive, foster: dashed; kinds not on the rings, like a guardian: dotted) get their own.
  // Links between people on the same rings curve around their middle.
  const middleFor = (parent: string, child: string) => {
    const [a, b] = [graph.layout.seats[parent]?.unit, graph.layout.seats[child]?.unit];
    return a && a === b ? (layout.middles.get(a) ?? null) : null;
  };
  const byChild = new Map<string, GraphLink[]>();
  const edges: TreeEdge[] = [];
  const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#a8a29e" };
  const blood = (link: GraphLink) => (link.kind ?? "biological") === "biological";
  for (const link of graph.links) {
    if (link.type !== "parent" || !shown(link.source) || !shown(link.target)) continue;
    if (!care && !blood(link)) continue;
    if (link.in_layout) append(byChild, link.target, link);
    else {
      edges.push({
        id: `link:${link.id}`,
        type: "child",
        sourceHandle: "out",
        targetHandle: "in",
        source: link.source,
        target: link.target,
        markerEnd: arrow,
        className: dim(link.source, link.target),
        data: {
          partner: null,
          links: [link],
          look: "loose",
          middle: middleFor(link.source, link.target),
          elbow: elbows,
        },
      });
    }
  }
  const couples = new Map<string, [string, string]>();
  for (const [child, links] of byChild) {
    const byBirth = links.filter(blood);
    const [first, second] = byBirth;
    if (first) {
      edges.push({
        id: `family:${child}`,
        type: "child",
        sourceHandle: "out",
        targetHandle: "in",
        source: first.source,
        target: child,
        markerEnd: arrow,
        className: dim(first.source, child),
        data: {
          partner: second?.source ?? null,
          links: byBirth.slice(0, 2),
          look: "blood",
          middle: middleFor(first.source, child),
          elbow: elbows,
        },
      });
      if (second) {
        const pair = [first.source, second.source].sort() as [string, string];
        couples.set(pair.join("+"), pair);
      }
    }
    for (const link of [...byBirth.slice(2), ...links.filter((l) => !byBirth.includes(l))]) {
      edges.push({
        id: `link:${link.id}`,
        type: "child",
        sourceHandle: "out",
        targetHandle: "in",
        source: link.source,
        target: child,
        markerEnd: arrow,
        className: dim(link.source, child),
        data: {
          partner: null,
          links: [link],
          look: byBirth.includes(link) ? "blood" : "care",
          middle: middleFor(link.source, child),
          elbow: elbows,
        },
      });
    }
  }

  for (const link of graph.links) {
    if (link.type !== "spouse" || !shown(link.source) || !shown(link.target)) continue;
    const key = [link.source, link.target].sort().join("+");
    const children = couples.delete(key);
    edges.push({
      id: `spouse:${link.id}`,
      type: "spouse",
      sourceHandle: "out",
      targetHandle: "in",
      source: link.source,
      target: link.target,
      className: dim(link.source, link.target),
      data: { link, children },
    });
  }
  // Parents of the same children with no marriage recorded, or with an unknown parent.
  for (const [key, [a, b]] of couples) {
    edges.push({
      id: `pair:${key}`,
      type: "pair",
      sourceHandle: "out",
      targetHandle: "in",
      source: a,
      target: b,
      className: dim(a, b),
      data: { children: true },
    });
  }
  return { nodes, edges: edges as Edge[] as TreeEdge[] };
}
