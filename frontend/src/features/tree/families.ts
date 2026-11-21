import type { Graph, GraphPerson } from "@/api/types";
import { branchColours } from "./colours";
import type { Ring } from "./rings";
import { shortName } from "./words";

/*
 * The families in the tree: the one at the centre, with its branches; each
 * married-in family, hanging off the person who married in; and any family not linked to the
 * rest. Worked out from the seats the backend sends, for the Centre menu.
 */

export type Family = {
  unit: string; // its set of rings
  centre: string; // whom "Centre the tree here" puts at the centre: the oldest in its middle
  name: string; // "Ismail & Fatimah", from the couple in its middle
  people: number; // not counting unknown parents
  anchor: string | null; // the person it hangs off, on the rings it hangs from
  married: string | null; // whom that person married there, if they married in
  depth: number; // 0: rings of its own; 1: hangs off them; 2: off a family that hangs off them…
};

export type Branch = {
  id: string; // the person whose line it is
  name: string;
  people: number;
  colour: string | null;
};

type Named = Pick<GraphPerson, "full_name" | "nickname" | "placeholder">;

/** "Ismail & Fatimah"; "Ali's parents" when both are unknown parents. */
function familyName(
  people: ReadonlyMap<string, Named>,
  centre: readonly string[],
  firstChild: string | undefined,
): string {
  const names = centre
    .map((id) => people.get(id))
    .filter((person): person is Named => !!person && !person.placeholder)
    .map(shortName);
  if (names.length) return names.join(" & ");
  const child = firstChild ? people.get(firstChild) : undefined;
  return child ? `${shortName(child)}'s parents` : "Unknown parents";
}

export function familiesOf(graph: Graph): { families: Family[]; branches: Branch[] } {
  const people = new Map(graph.people.map((person) => [person.id, person]));
  const real = (id: string) => !people.get(id)?.placeholder;
  const seats = Object.entries(graph.layout.seats);
  const depthOf = new Map<string, number>();
  const families: Family[] = [];
  for (const unit of graph.layout.units) {
    const members = seats.filter(([, seat]) => seat.unit === unit.id);
    const anchorSeat = unit.anchor ? graph.layout.seats[unit.anchor] : undefined;
    const depth = anchorSeat ? (depthOf.get(anchorSeat.unit) ?? 0) + 1 : 0;
    depthOf.set(unit.id, depth);
    const root = unit.centre[0] ?? "";
    const firstChild = members
      .filter(([, seat]) => seat.parent === root)
      .sort(([, a], [, b]) => a.order - b.order)[0]?.[0];
    families.push({
      unit: unit.id,
      centre: root,
      name: familyName(people, unit.centre, firstChild),
      people: members.filter(([id]) => real(id)).length,
      anchor: unit.anchor,
      married: anchorSeat?.partner_of ?? null,
      depth,
    });
  }

  // The branches of the family at the centre, in their colours (Colour by branch).
  const centreUnit = graph.layout.units[0]?.id;
  const colours = branchColours(graph);
  const branches: Branch[] = [...colours]
    .filter(([id]) => graph.layout.seats[id]?.unit === centreUnit)
    .map(([id, colour]) => {
      const person = people.get(id);
      return {
        id,
        name: person ? shortName(person) : "?",
        people: seats.filter(([other, seat]) => seat.branch === id && real(other)).length,
        colour,
      };
    });
  return { families, branches };
}

/**
 * What each ring says, as you answered on 20 Nov 2026: each generation once. A family's
 * own rings say their generation: the one at the centre, and one not linked to the rest, which
 * counts its own. A married-in family's arcs (or discs) say no number, which the main rings
 * already say, though they keep it for their colours; its oldest is named for its couple,
 * as the Centre menu names them: "Rashid & Kamariah".
 */
export function nameRings(graph: Graph, rings: Ring[]): Ring[] {
  const oldest = new Map<string, number>();
  for (const ring of rings) {
    if (ring.cluster)
      oldest.set(ring.unit, Math.min(oldest.get(ring.unit) ?? ring.generation, ring.generation));
  }
  const names = new Map<string, string>();
  if (oldest.size) {
    const people = new Map(graph.people.map((person) => [person.id, person]));
    // Each named family's first child of its middle, for "Ali's parents" when both are unknown.
    const firstChild = new Map<string, { id: string; order: number }>();
    const middleOf = new Map(graph.layout.units.map((unit) => [unit.id, unit.centre[0] ?? ""]));
    for (const [id, seat] of Object.entries(graph.layout.seats)) {
      if (!oldest.has(seat.unit) || seat.parent !== middleOf.get(seat.unit)) continue;
      const found = firstChild.get(seat.unit);
      if (!found || seat.order < found.order) firstChild.set(seat.unit, { id, order: seat.order });
    }
    for (const unit of graph.layout.units) {
      if (oldest.has(unit.id)) {
        names.set(unit.id, familyName(people, unit.centre, firstChild.get(unit.id)?.id));
      }
    }
  }
  return rings.map((ring) => ({
    ...ring,
    label: !ring.cluster
      ? `Generation ${ring.generation}`
      : ring.generation === oldest.get(ring.unit)
        ? (names.get(ring.unit) ?? null)
        : null,
  }));
}

/** Everyone in a family's rings, and the person it hangs off: what Show brings into view. */
export function familyMembers(graph: Graph, unit: string): string[] {
  const ids = Object.entries(graph.layout.seats)
    .filter(([, seat]) => seat.unit === unit)
    .map(([id]) => id);
  const anchor = graph.layout.units.find((candidate) => candidate.id === unit)?.anchor;
  return anchor ? [...ids, anchor] : ids;
}

/** Everyone on a branch: its line of descent and whom they married. */
export function branchMembers(graph: Graph, branch: string): string[] {
  return Object.entries(graph.layout.seats)
    .filter(([, seat]) => seat.branch === branch)
    .map(([id]) => id);
}
