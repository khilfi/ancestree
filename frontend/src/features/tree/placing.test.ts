import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, GraphPerson, LayoutUnit, Seat } from "@/api/types";
import { allFamilies, ringLayout, WAYS, type Way } from "./placing";
import { measure } from "./sideBySide/measures";

/*
 * The four ways of placing married-in families, on a family seated
 * by hand: a son's wife and a daughter's husband each bring their family, and the wife's
 * sister's husband brings his, so one married-in family hangs off another. Then each way at
 * 2,000 people.
 */

function person(id: string): GraphPerson {
  return {
    id,
    full_name: id,
    nickname: null,
    gender: "unknown",
    birth_year: null,
    death_year: null,
    birth_order: null,
    placeholder: false,
    photo_version: null,
    birthplace: null,
    x: null,
    y: null,
  };
}

function seat(unit: string, generation: number, fields: Partial<Seat> = {}): Seat {
  return { unit, generation, parent: null, order: 0, partner_of: null, branch: null, ...fields };
}

const unit = (id: string, centre: string, anchor: string | null, size = 0): LayoutUnit => ({
  id,
  centre: [centre],
  anchor,
  anchor_seat: anchor ? seat(id, 2, { parent: centre, order: 0 }) : null,
  size,
});

const seats: Record<string, Seat> = {
  tok: seat("main:0", 1),
  nek: seat("main:0", 1, { partner_of: "tok" }),
  ali: seat("main:0", 2, { parent: "tok", order: 0 }),
  siti: seat("main:0", 2, { parent: "tok", order: 1 }),
  abu: seat("main:0", 2, { parent: "tok", order: 2 }),
  wife: seat("main:0", 2, { partner_of: "ali" }),
  husband: seat("main:0", 2, { partner_of: "siti" }),
  cucu: seat("main:0", 3, { parent: "ali", order: 0 }),
  inlaw: seat("cluster:wife", 1),
  inlawWife: seat("cluster:wife", 1, { partner_of: "inlaw" }),
  sister: seat("cluster:wife", 2, { parent: "inlaw", order: 1 }),
  brother: seat("cluster:wife", 2, { parent: "inlaw", order: 2 }),
  sistersHusband: seat("cluster:wife", 2, { partner_of: "sister" }),
  other: seat("cluster:husband", 1),
  otherWife: seat("cluster:husband", 1, { partner_of: "other" }),
  otherSon: seat("cluster:husband", 2, { parent: "other", order: 1 }),
  third: seat("cluster:sistersHusband", 1),
  thirdSon: seat("cluster:sistersHusband", 2, { parent: "third", order: 1 }),
};

let next = 0;
function link(type: "parent" | "spouse", source: string, target: string): GraphLink {
  next += 1;
  const id = `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
  return {
    id,
    type,
    source,
    target,
    kind: type === "parent" ? "biological" : null,
    status: type === "spouse" ? "married" : null,
    in_layout: true,
  };
}
const children = (parents: string[], kids: string[]) =>
  parents.flatMap((parent) => kids.map((kid) => link("parent", parent, kid)));

const graph: Graph = {
  people: Object.keys(seats).map(person),
  links: [
    link("spouse", "tok", "nek"),
    ...children(["tok", "nek"], ["ali", "siti", "abu"]),
    link("spouse", "ali", "wife"),
    link("spouse", "siti", "husband"),
    ...children(["ali", "wife"], ["cucu"]),
    link("spouse", "inlaw", "inlawWife"),
    ...children(["inlaw", "inlawWife"], ["wife", "sister", "brother"]),
    link("spouse", "sister", "sistersHusband"),
    link("spouse", "other", "otherWife"),
    ...children(["other", "otherWife"], ["husband", "otherSon"]),
    ...children(["third"], ["sistersHusband", "thirdSon"]),
  ],
  layout: {
    units: [
      unit("main:0", "tok", null),
      unit("cluster:wife", "inlaw", "wife", 5),
      unit("cluster:husband", "other", "husband", 3),
      unit("cluster:sistersHusband", "third", "sistersHusband", 2),
    ],
    seats,
    unlinked: [],
    centre_chosen: false,
  },
};

const everyone = allFamilies(graph);
const distance = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
  a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.NaN;

describe("the four ways of placing married-in families", () => {
  it.each(WAYS.map(({ way }) => way))("%s: places everyone, apart, the same every time", (way) => {
    const layout = ringLayout(graph, everyone, way as Way);
    expect([...layout.points.keys()].sort()).toEqual(Object.keys(seats).sort());
    expect(layout.hidden.size).toBe(0);
    expect(measure(graph, layout).overlaps).toBe(0);
    expect(measure(graph, layout).ringsCrossing).toBe(0);
    const again = ringLayout(graph, everyone, way as Way);
    expect([...again.points]).toEqual([...layout.points]);
  });

  it("fans, unless this computer chose another way", () => {
    expect(WAYS[0]?.way).toBe("fans");
    expect([...ringLayout(graph, everyone).points]).toEqual([
      ...ringLayout(graph, everyone, "fans").points,
    ]);
  });

  it("discs: each family keeps its whole rings, apart from its host's", () => {
    const layout = ringLayout(graph, everyone, "discs");
    expect(layout.rings.every((ring) => ring.span === undefined)).toBe(true);
    const families = layout.rings.filter((ring) => ring.unit === "cluster:wife");
    const host = layout.rings.filter((ring) => ring.unit === "main:0");
    const outer = (rings: typeof host) => Math.max(...rings.map((ring) => ring.radius));
    expect(distance(families[0], host[0])).toBeGreaterThan(outer(families) + outer(host));
  });

  it("fans: each family's rings are arcs, its oldest generation nearest its person", () => {
    const layout = ringLayout(graph, everyone, "fans");
    const arcs = layout.rings.filter((ring) => ring.unit !== "main:0");
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.every((ring) => ring.span && ring.span.to - ring.span.from < Math.PI)).toBe(true);
    const at = (id: string) => layout.points.get(id);
    expect(distance(at("inlaw"), at("wife"))).toBeLessThan(distance(at("sister"), at("wife")));
    expect(distance(at("third"), at("sistersHusband"))).toBeLessThan(
      distance(at("thirdSon"), at("sistersHusband")),
    );
  });

  it("tucked in: married-in families' people on their host's own rings", () => {
    const layout = ringLayout(graph, everyone, "tucked");
    expect(new Set(layout.rings.map((ring) => ring.unit))).toEqual(new Set(["main:0"]));
    const middle = layout.middles.get("main:0");
    const radii = [0, ...layout.rings.map((ring) => ring.radius)];
    for (const id of ["inlaw", "sister", "other", "third", "thirdSon"]) {
      const reach = distance(layout.points.get(id), middle);
      expect(Math.min(...radii.map((radius) => Math.abs(reach - radius))), id).toBeLessThan(
        // a partner sits beside their person, a little off the ring's line
        70,
      );
    }
  });

  it.each(WAYS.map(({ way }) => way))("%s: a folded family is hidden, with its badge", (way) => {
    const layout = ringLayout(graph, new Set(["cluster:husband"]), way as Way);
    for (const id of ["inlaw", "sister", "third", "thirdSon"])
      expect(layout.hidden.has(id)).toBe(true);
    expect(layout.hidden.has("other")).toBe(false);
    expect(layout.folds.get("wife")).toEqual([{ unit: "cluster:wife", size: 5, open: false }]);
    expect(layout.folds.get("husband")).toEqual([{ unit: "cluster:husband", size: 3, open: true }]);
  });
});

/** A made-up family of `size`: each couple has four children, three of whom marry, and every
 *  seventh who marries brings their parents and two brothers or sisters along. */
function bigFamily(size: number): Graph {
  const big: Record<string, Seat> = {
    p0: seat("main:0", 1),
    p1: seat("main:0", 1, { partner_of: "p0" }),
  };
  const units: LayoutUnit[] = [unit("main:0", "p0", null)];
  const waiting: [string, number][] = [["p0", 1]];
  let count = 2;
  let marriages = 0;
  while (count < size && waiting.length) {
    const [parent, generation] = waiting.shift() ?? ["", 0];
    for (let order = 0; order < 4 && count < size; order++) {
      const child = `p${count++}`;
      big[child] = seat("main:0", generation + 1, { parent, order });
      if (order === 3 || count >= size) continue;
      const spouse = `p${count++}`;
      big[spouse] = seat("main:0", generation + 1, { partner_of: child });
      waiting.push([child, generation + 1]);
      if (++marriages % 7 || count + 4 > size) continue;
      const family = `cluster:${spouse}`;
      const father = `p${count}`;
      big[father] = seat(family, 1);
      big[`p${count + 1}`] = seat(family, 1, { partner_of: father });
      big[`p${count + 2}`] = seat(family, 2, { parent: father, order: 1 });
      big[`p${count + 3}`] = seat(family, 2, { parent: father, order: 2 });
      count += 4;
      units.push(unit(family, father, spouse, 4));
    }
  }
  return {
    people: Object.keys(big).map(person),
    links: [],
    layout: { units, seats: big, unlinked: [], centre_chosen: false },
  };
}

describe("each way at 2,000 people", () => {
  const thousands = bigFamily(2000);
  const open = allFamilies(thousands);

  it.each(WAYS.map(({ way }) => way))("%s: within 50 milliseconds, nobody overlapping", (way) => {
    // The quickest of a few: the other tests run beside these, and take turns with them.
    let quickest = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 5; attempt++) {
      const started = performance.now();
      ringLayout(thousands, open, way as Way);
      quickest = Math.min(quickest, performance.now() - started);
    }
    expect(quickest).toBeLessThan(50);
    expect(measure(thousands, ringLayout(thousands, open, way as Way)).overlaps).toBe(0);
  });
});
