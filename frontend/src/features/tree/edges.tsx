import { BaseEdge, type Edge, type EdgeProps, useInternalNode } from "@xyflow/react";
import { memo } from "react";
import type { GraphLink } from "@/api/types";
import { midpoint, photoCentre, photoRadius, rim } from "./geometry";
import type { Point } from "./rings";

/*
 * Links meet photos at their rim ("floating" links), so they look right anywhere on the
 * rings. A couple's children hang from a small dot on the line between the parents: the
 * automatic version of the "Kahwin" circles in the old chart.
 */

export type ChildEdgeData = {
  partner: string | null; // the other parent: the line starts at the dot between them
  links: GraphLink[];
  look: "blood" | "care" | "loose"; // biological; adoptive, foster; a kind not on the rings
  middle: Point | null; // the middle of their rings: the line curves around it, not across
  elbow?: boolean; // top to bottom: down, across and down, as in a printed tree
};
export type ChildFlowEdge = Edge<ChildEdgeData, "child">;

export type SpouseEdgeData = { link: GraphLink; children: boolean };
export type SpouseFlowEdge = Edge<SpouseEdgeData, "spouse">;

export type PairEdgeData = { children: boolean };
export type PairFlowEdge = Edge<PairEdgeData, "pair">;

const DASH = { blood: undefined, care: "7 5", loose: "2 5" } as const;

/** A point on the line from `middle` through `point`, `radius` from `middle`. */
function onRay(middle: Point, point: Point, radius: number): Point {
  const length = Math.hypot(point.x - middle.x, point.y - middle.y) || 1;
  return {
    x: middle.x + ((point.x - middle.x) / length) * radius,
    y: middle.y + ((point.y - middle.y) / length) * radius,
  };
}

/** From a parent out to a child on the next ring: straight out, around, and straight in,
 *  like d3's radial links, so lines stay between the rings instead of crossing the middle. */
export function outward(start: Point, to: Point, middle: Point | null, childRadius: number) {
  const bend =
    middle &&
    Math.hypot(to.x - middle.x, to.y - middle.y) -
      Math.hypot(start.x - middle.x, start.y - middle.y);
  if (!middle || !bend || bend < 40) {
    const end = rim(to, childRadius, start);
    return { path: `M ${start.x},${start.y} L ${end.x},${end.y}` };
  }
  const halfway = Math.hypot(start.x - middle.x, start.y - middle.y) + bend / 2;
  const first = onRay(middle, start, halfway);
  const second = onRay(middle, to, halfway);
  const end = rim(to, childRadius, second);
  return {
    path: `M ${start.x},${start.y} C ${first.x},${first.y} ${second.x},${second.y} ${end.x},${end.y}`,
  };
}

/** A parent's line to a child: from the dot between the parents (or the parent's rim) to the
 *  child's rim. Top to bottom it drops down, across and down; on the rings it goes outward. */
export function childPath(
  parent: { centre: Point; radius: number },
  partner: Point | null,
  child: { centre: Point; radius: number },
  data: Pick<ChildEdgeData, "middle" | "elbow"> | undefined,
): string {
  const to = child.centre;
  const below = parent.centre.y < to.y - child.radius - 24;
  if (data?.elbow && below) {
    const start = partner
      ? midpoint(parent.centre, partner)
      : { x: parent.centre.x, y: parent.centre.y + parent.radius };
    const top = to.y - child.radius - 3;
    const bend = start.y + (top - start.y) / 2;
    return `M ${start.x},${start.y} L ${start.x},${bend} L ${to.x},${bend} L ${to.x},${top}`;
  }
  const start = partner ? midpoint(parent.centre, partner) : rim(parent.centre, parent.radius, to);
  return outward(start, to, data?.middle ?? null, child.radius + 3).path;
}

export const ChildEdge = memo(function ChildEdge({
  id,
  source,
  target,
  data,
  markerEnd,
}: EdgeProps<ChildFlowEdge>) {
  const parent = useInternalNode(source);
  const other = useInternalNode(data?.partner ?? "");
  const child = useInternalNode(target);
  if (!parent || !child) return null;

  const path = childPath(
    { centre: photoCentre(parent), radius: photoRadius(parent) },
    other ? photoCentre(other) : null,
    { centre: photoCentre(child), radius: photoRadius(child) },
    data,
  );
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={16}
      className="tree-link"
      style={{ strokeDasharray: DASH[data?.look ?? "blood"] }}
    />
  );
});

function TwoPeople({
  id,
  source,
  target,
  double,
  dashed,
  dot,
}: {
  id: string;
  source: string;
  target: string;
  double: boolean;
  dashed: boolean;
  dot: boolean;
}) {
  const a = useInternalNode(source);
  const b = useInternalNode(target);
  if (!a || !b) return null;
  const [pa, pb] = [photoCentre(a), photoCentre(b)];
  const start = rim(pa, photoRadius(a), pb);
  const end = rim(pb, photoRadius(b), pa);
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const [nx, ny] = [(-(end.y - start.y) / length) * 2.5, ((end.x - start.x) / length) * 2.5];
  const line = (shift: number) =>
    `M ${start.x + nx * shift},${start.y + ny * shift} L ${end.x + nx * shift},${end.y + ny * shift}`;
  const junction = midpoint(pa, pb);
  const dash = dashed ? "6 4" : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={double ? `${line(1)} ${line(-1)}` : line(0)}
        interactionWidth={16}
        className={double ? "tree-link tree-marriage" : "tree-link tree-pair"}
        style={{ strokeDasharray: dash }}
      />
      {dot && <circle cx={junction.x} cy={junction.y} r={4.5} className="tree-junction" />}
    </>
  );
}

export const SpouseEdge = memo(function SpouseEdge({
  id,
  source,
  target,
  data,
}: EdgeProps<SpouseFlowEdge>) {
  return (
    <TwoPeople
      id={id}
      source={source}
      target={target}
      double
      dashed={data?.link.status === "divorced"}
      dot={!!data?.children}
    />
  );
});

/** Two parents of the same children who aren't recorded as married (or one is unknown). */
export const PairEdge = memo(function PairEdge({
  id,
  source,
  target,
  data,
}: EdgeProps<PairFlowEdge>) {
  return (
    <TwoPeople
      id={id}
      source={source}
      target={target}
      double={false}
      dashed
      dot={!!data?.children}
    />
  );
});
