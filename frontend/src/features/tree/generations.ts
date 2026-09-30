import type { Graph } from "@/api/types";

/**
 * How far each set of rings counts its generations from the tree's own. A family's
 * own rings count from their centre: no shift. A married-in family counts from the couple in
 * its own middle, so it moves by the generation of the person who married in, less their
 * generation in their own family: a wife's sister is in her generation. Through a
 * family that hangs off a married-in family, the moves add up. The backend lists a family
 * before the families that hang off it, so one pass is enough.
 */
export function generationShifts(graph: Graph): Map<string, number> {
  const shifts = new Map<string, number>();
  for (const unit of graph.layout.units) {
    if (!unit.anchor) {
      shifts.set(unit.id, 0);
      continue;
    }
    const seat = graph.layout.seats[unit.anchor];
    const host = seat ? shifts.get(seat.unit) : undefined;
    if (!seat || host === undefined) continue;
    shifts.set(unit.id, seat.generation + host - (unit.anchor_seat?.generation ?? seat.generation));
  }
  return shifts;
}

/** Someone's generation in the tree's own numbers, or null if they have no seat. */
export function treeGeneration(
  graph: Graph,
  shifts: ReadonlyMap<string, number>,
  id: string,
): number | null {
  const seat = graph.layout.seats[id];
  const shift = seat ? shifts.get(seat.unit) : undefined;
  return seat && shift !== undefined ? seat.generation + shift : null;
}
