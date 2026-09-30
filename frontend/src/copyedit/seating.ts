/**
 * Seats on the lineage rings, as backend/src/ancestree/lineage/seating.py decides them
 *: the seating twin of a copy to edit, which seats the
 * family itself after every change. It gives the same seats as Python, as golden files written
 * by Python prove (golden.test.ts).
 *
 * One rule for changes, as for the kinship twin: Python changes first, its golden files are
 * written again (backend: uv run python -m tests.copy_golden), and the twin follows.
 *
 * Where Python loops over a set, the result never depends on the order; where it loops over a
 * list or a dict, this keeps the same order, so ties go the same way.
 */
import type { Gender, PartialDate } from "@/api/types";
import { casefold, compareText, type Key, minBy, sortedBy } from "@/kinship/compare";
import { orderSiblings, type Sibling } from "@/kinship/order";

const LAST = 1_000_000; // sorts after any real birth year or marriage number

export type Member = {
  id: string;
  name: string;
  gender: Gender;
  birth: PartialDate | null;
  birthOrder: number | null;
};

export type ParentEdge = { parent: string; child: string; inLayout: boolean };
export type SpouseEdge = { a: string; b: string; order: number | null };

/** Where one person sits: see seating.py's Seat. */
export type Seat = {
  unit: string;
  generation: number;
  parent: string | null;
  order: number;
  partnerOf: string | null;
  branch: string | null;
};

export type Unit = {
  id: string;
  centre: string[];
  anchor: string | null;
  anchorSeat: Seat | null;
  size: number;
};

export type Seating = { units: Unit[]; seats: Map<string, Seat>; unlinked: string[] };

type SortKey = [number, string, string];

const pair = (a: string, b: string) => (compareText(a, b) <= 0 ? `${a}\n${b}` : `${b}\n${a}`);

function smallest(people: Iterable<string>): string {
  let best: string | undefined;
  for (const person of people)
    if (best === undefined || compareText(person, best) < 0) best = person;
  return best as string;
}

export function seatFamily(
  members: readonly Member[],
  parents: readonly ParentEdge[],
  spouses: readonly SpouseEdge[],
  centre: string | null = null,
): Seating {
  const family = new Family(members, parents, spouses);
  const linked = new Set([...family.members.keys()].filter((p) => family.neighbours(p).size));
  const lonely = [...family.members.keys()].filter((person) => !linked.has(person));
  const seating: Seating = {
    units: [],
    seats: new Map(),
    unlinked: sortedBy(lonely, (person) => family.sortKey(person)),
  };
  // The family holding the chosen centre comes first, as "main:0"; then the biggest first.
  const groups = sortedBy(family.components(linked), (group) => [
    !(centre !== null && group.has(centre)),
    -group.size,
    smallest(group),
  ]);
  groups.forEach((group, number) => {
    const chosen = centre !== null && group.has(centre) ? centre : null;
    family.seatUnit(group, `main:${number}`, chosen, null, seating);
  });
  return seating;
}

class Family {
  readonly members = new Map<string, Member>();
  private readonly parentsOf = new Map<string, string[]>(); // links that place
  private readonly childrenOf = new Map<string, string[]>();
  private readonly spousesOf = new Map<string, string[]>();
  private readonly marriageOrder = new Map<string, number>();
  private readonly linkedTo = new Map<string, Set<string>>(); // any link at all
  private readonly clustersAt = new Map<string, number>();

  constructor(
    members: readonly Member[],
    parents: readonly ParentEdge[],
    spouses: readonly SpouseEdge[],
  ) {
    for (const member of members) this.members.set(member.id, member);
    for (const edge of parents) {
      if (!this.members.has(edge.parent) || !this.members.has(edge.child)) continue;
      this.neighbours(edge.parent).add(edge.child);
      this.neighbours(edge.child).add(edge.parent);
      if (edge.inLayout) {
        this.list(this.parentsOf, edge.child).push(edge.parent);
        this.list(this.childrenOf, edge.parent).push(edge.child);
      }
    }
    for (const spouse of spouses) {
      if (!this.members.has(spouse.a) || !this.members.has(spouse.b) || spouse.a === spouse.b) {
        continue;
      }
      this.neighbours(spouse.a).add(spouse.b);
      this.neighbours(spouse.b).add(spouse.a);
      this.list(this.spousesOf, spouse.a).push(spouse.b);
      this.list(this.spousesOf, spouse.b).push(spouse.a);
      if (spouse.order != null) this.marriageOrder.set(pair(spouse.a, spouse.b), spouse.order);
    }
    // Parents of the same child belong together, married or not.
    for (const parentsOfChild of this.parentsOf.values()) {
      for (const parent of parentsOfChild) {
        for (const other of parentsOfChild)
          if (other !== parent) this.neighbours(parent).add(other);
      }
    }
  }

  // --- Small helpers -----------------------------------------------------------------------

  private list(map: Map<string, string[]>, key: string): string[] {
    const found = map.get(key) ?? [];
    map.set(key, found);
    return found;
  }

  neighbours(person: string): Set<string> {
    const found = this.linkedTo.get(person) ?? new Set<string>();
    this.linkedTo.set(person, found);
    return found;
  }

  private parents(person: string): string[] {
    return this.parentsOf.get(person) ?? [];
  }

  private children(person: string): string[] {
    return this.childrenOf.get(person) ?? [];
  }

  sortKey(person: string): SortKey {
    const member = this.members.get(person) as Member;
    const year = member.birth?.year ? member.birth.year : LAST;
    return [year, casefold(member.name), person];
  }

  /** Groups of people joined by links, using only links inside `people`. */
  components(people: Set<string>): Set<string>[] {
    const seen = new Set<string>();
    const groups: Set<string>[] = [];
    for (const start of [...people].sort(compareText)) {
      if (seen.has(start)) continue;
      const group = new Set([start]);
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        for (const neighbour of this.neighbours(queue.shift() as string)) {
          if (people.has(neighbour) && !seen.has(neighbour)) {
            seen.add(neighbour);
            group.add(neighbour);
            queue.push(neighbour);
          }
        }
      }
      groups.push(group);
    }
    return groups;
  }

  /** A person's families, in order: [the other parent or spouse, their children]. */
  families(person: string, group: Set<string>): [string | null, string[]][] {
    const byPartner = new Map<string | null, string[]>();
    for (const child of this.children(person)) {
      if (!group.has(child)) continue;
      const others = this.parents(child).filter((p) => p !== person && group.has(p));
      const partner = others.length ? (minBy(others, (p) => this.sortKey(p)) as string) : null;
      const children = byPartner.get(partner) ?? [];
      byPartner.set(partner, children);
      children.push(child);
    }
    for (const spouse of this.spousesOf.get(person) ?? []) {
      if (group.has(spouse) && !byPartner.has(spouse)) byPartner.set(spouse, []);
    }
    return sortedBy(byPartner.entries(), ([partner, children]): Key => {
      const married = this.marriageOrder.get(pair(person, partner ?? "")) ?? LAST;
      const eldest = Math.min(LAST, ...children.map((child) => this.sortKey(child)[0]));
      return [married, eldest, partner ? this.sortKey(partner) : [LAST, "", ""]];
    });
  }

  /** Generations below each person, counting only children inside `group`. */
  private depths(group: Set<string>): Map<string, number> {
    const depth = new Map<string, number>();
    for (const start of group) {
      const stack: [string, boolean][] = [[start, false]];
      while (stack.length) {
        const [person, expanded] = stack.pop() as [string, boolean];
        if (depth.has(person)) continue;
        const children = this.children(person).filter((child) => group.has(child));
        if (expanded || !children.length) {
          depth.set(person, 1 + Math.max(-1, ...children.map((child) => depth.get(child) ?? 0)));
          continue;
        }
        stack.push([person, true]);
        for (const child of children) if (!depth.has(child)) stack.push([child, false]);
      }
    }
    return depth;
  }

  /** The top of the longest line of descent: D2's epicentre. */
  private oldest(candidates: Set<string>, group: Set<string>): string {
    const roots = [...candidates].filter((p) => !this.parents(p).some((q) => group.has(q)));
    const pool = roots.length ? roots : [...candidates].sort(compareText);
    const depth = this.depths(group);
    const deepest = Math.max(...pool.map((p) => depth.get(p) as number));
    const tied = pool.filter((p) => depth.get(p) === deepest);
    if (tied.length === 1) return tied[0] as string;

    const descendants = (person: string) => {
      const seen = new Set([person]);
      const queue = [person];
      while (queue.length) {
        for (const child of this.children(queue.shift() as string)) {
          if (group.has(child) && !seen.has(child)) {
            seen.add(child);
            queue.push(child);
          }
        }
      }
      return seen.size;
    };
    return minBy(tied, (person): Key => {
      const maleFirst = this.members.get(person)?.gender === "male" ? 0 : 1;
      const key = this.sortKey(person);
      return [-descendants(person), key[0], maleFirst, key];
    }) as string;
  }

  /** Parents before children (Kahn's algorithm). */
  private topological(people: Set<string>): string[] {
    const waiting = new Map<string, number>();
    for (const person of people) {
      waiting.set(person, this.parents(person).filter((q) => people.has(q)).length);
    }
    const queue = sortedBy(
      [...waiting].filter(([, count]) => count === 0).map(([person]) => person),
      (person) => this.sortKey(person),
    );
    const order: string[] = [];
    while (queue.length) {
      const person = queue.shift() as string;
      order.push(person);
      for (const child of this.children(person)) {
        const count = waiting.get(child);
        if (count === undefined) continue;
        waiting.set(child, count - 1);
        if (count - 1 === 0) queue.push(child);
      }
    }
    const placed = new Set(order);
    const rest = [...people].filter((person) => !placed.has(person));
    return [...order, ...sortedBy(rest, (person) => this.sortKey(person))];
  }

  /** Where each line's colour starts: see seating.py's _Family.branches. */
  private branches(
    root: string,
    descendants: Set<string>,
    placedUnder: Map<string, string | null>,
    kidsOf: Map<string, Set<string>>,
  ): Map<string, string | null> {
    const kids = (person: string) => kidsOf.get(person) ?? new Set<string>();
    let fork = root;
    let lines = [...kids(fork)].filter((child) => kids(child).size);
    while (lines.length === 1) {
      fork = lines[0] as string;
      lines = [...kids(fork)].filter((child) => kids(child).size);
    }
    if (lines.length < 2) fork = root;
    const branch = new Map<string, string | null>();
    for (const person of this.topological(descendants)) {
      const parent = placedUnder.get(person) ?? null;
      if (parent === null) branch.set(person, null);
      else if (parent === fork) branch.set(person, person);
      else branch.set(person, branch.get(parent) ?? null);
    }
    return branch;
  }

  private inBirthOrder(children: readonly string[]): string[] {
    const siblings: Sibling[] = children.map((child) => {
      const member = this.members.get(child) as Member;
      return {
        id: child,
        gender: member.gender,
        birth: member.birth,
        birthOrder: member.birthOrder,
        tiebreak: this.sortKey(child).map(String).join("|"),
      };
    });
    return orderSiblings(siblings)[0].map((sibling) => sibling.id);
  }

  // --- Seating one set of rings ------------------------------------------------------------

  seatUnit(
    group: Set<string>,
    unitId: string,
    centre: string | null,
    anchor: string | null,
    seating: Seating,
  ): void {
    const root =
      centre ??
      this.oldest(anchor ? new Set([...group].filter((p) => p !== anchor)) : group, group);

    // The centre's line of descent, and everyone partnered with someone in it.
    const descendants = new Set([root]);
    const partnerOf = new Map<string, string>();
    const queue = [root];
    while (queue.length) {
      const person = queue.shift() as string;
      for (const child of this.children(person)) {
        if (group.has(child) && !descendants.has(child)) {
          descendants.add(child);
          partnerOf.delete(child); // married a cousin: seated by descent
          queue.push(child);
        }
      }
      for (const [partner] of this.families(person, group)) {
        if (partner && !descendants.has(partner) && !partnerOf.has(partner)) {
          partnerOf.set(partner, person);
        }
      }
    }

    const generation = new Map<string, number>();
    for (const person of this.topological(descendants)) {
      const placed = this.parents(person)
        .filter((p) => generation.has(p))
        .map((p) => generation.get(p) as number);
      generation.set(person, Math.max(0, ...placed) + 1);
    }

    // The parent a child hangs from: the one further out, then the father.
    const ringParent = (child: string): string | null => {
      const candidates = this.parents(child).filter((p) => descendants.has(p));
      if (child === root || !candidates.length) return null;
      return minBy(
        candidates,
        (p): Key => [
          -(generation.get(p) as number),
          this.members.get(p)?.gender !== "male",
          this.sortKey(p),
        ],
      ) as string;
    };

    const placedUnder = new Map<string, string | null>();
    for (const person of descendants) placedUnder.set(person, ringParent(person));
    const kidsOf = new Map<string, Set<string>>();
    for (const [person, parent] of placedUnder) {
      if (parent === null) continue;
      const kids = kidsOf.get(parent) ?? new Set<string>();
      kidsOf.set(parent, kids);
      kids.add(person);
    }
    const order = new Map<string, number>([[root, 0]]);
    const partnerRank = new Map<string, number>();
    for (const person of descendants) {
      let position = 0;
      this.families(person, group).forEach(([partner, children], rank) => {
        if (partner !== null && partnerOf.get(partner) === person) partnerRank.set(partner, rank);
        const kids = kidsOf.get(person) ?? new Set<string>();
        for (const child of this.inBirthOrder(children.filter((c) => kids.has(c)))) {
          order.set(child, position);
          position += 1;
        }
      });
    }
    const branch = this.branches(root, descendants, placedUnder, kidsOf);

    const seats = new Map<string, Seat>();
    for (const person of descendants) {
      seats.set(person, {
        unit: unitId,
        generation: generation.get(person) as number,
        parent: placedUnder.get(person) ?? null,
        order: order.get(person) ?? 0,
        partnerOf: null,
        branch: branch.get(person) ?? null,
      });
    }
    for (const [partner, person] of partnerOf) {
      seats.set(partner, {
        unit: unitId,
        generation: generation.get(person) as number,
        parent: null,
        order: partnerRank.get(partner) ?? partnerRank.size,
        partnerOf: person,
        branch: branch.get(person) ?? null,
      });
    }

    let anchorSeat: Seat | null = null;
    if (anchor) {
      anchorSeat = seats.get(anchor) ?? null;
      seats.delete(anchor);
    }
    // Not the anchor, who sits on the rings the cluster hangs from.
    const centrePartners = sortedBy(
      [...partnerOf].filter(([p, person]) => person === root && seats.has(p)).map(([p]) => p),
      (p) => (seats.get(p) as Seat).order,
    );
    seating.units.push({
      id: unitId,
      centre: [root, ...centrePartners],
      anchor,
      anchorSeat,
      size: seats.size,
    });
    for (const [person, seat] of seats) seating.seats.set(person, seat);

    // Everyone left hangs off the rings in a cluster: a wife's parents and siblings, say.
    const seated = new Set(seats.keys());
    if (anchor) seated.add(anchor);
    const rest = new Set([...group].filter((person) => !seated.has(person)));
    const parts = sortedBy(this.components(rest), (part) => [-part.size, smallest(part)]);
    for (const part of parts) {
      const touching = new Set<string>();
      for (const person of part) {
        for (const neighbour of this.neighbours(person)) {
          if (seated.has(neighbour)) touching.add(neighbour);
        }
      }
      const hook = minBy(
        touching,
        (p): Key => [
          !partnerOf.has(p), // a wife's family hangs off her, not her husband
          seats.has(p) ? (seats.get(p) as Seat).generation : LAST,
          this.sortKey(p),
        ],
      ) as string;
      const count = (this.clustersAt.get(hook) ?? 0) + 1;
      this.clustersAt.set(hook, count);
      const suffix = count > 1 ? `:${count}` : "";
      this.seatUnit(new Set([...part, hook]), `cluster:${hook}${suffix}`, null, hook, seating);
    }
  }
}
