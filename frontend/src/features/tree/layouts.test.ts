import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, GraphPerson, Seat } from "@/api/types";
import { applyFilter, NO_FILTER } from "./filters";
import {
  familyTreeLayout,
  fanLayout,
  fanRadii,
  generationWord,
  hourglassLayout,
  ROW,
} from "./layouts";
import { SPACING } from "./rings";

function person(
  id: string,
  gender: GraphPerson["gender"] = "unknown",
  placeholder = false,
): GraphPerson {
  return {
    id,
    full_name: id,
    nickname: null,
    gender,
    birth_year: null,
    death_year: null,
    birth_order: null,
    placeholder,
    photo_version: null,
  };
}

function parent(source: string, target: string): GraphLink {
  const id = `${source}>${target}`;
  return { id, type: "parent", source, target, kind: "biological", status: null, in_layout: true };
}

function married(source: string, target: string): GraphLink {
  const id = `${source}=${target}`;
  return { id, type: "spouse", source, target, kind: null, status: "married", in_layout: true };
}

function seat(unit: string, generation: number, fields: Partial<Seat> = {}): Seat {
  return { unit, generation, parent: null, order: 0, partner_of: null, branch: null, ...fields };
}

// Tok & Nek; their children Ali and Siti; Ali married Wife, whose father In-law is her own
// family; Ali and Wife's son Cucu. Loner isn't linked to anyone.
const graph: Graph = {
  people: [
    person("tok", "male"),
    person("nek", "female"),
    person("ali", "male"),
    person("siti", "female"),
    person("wife", "female"),
    person("inlaw", "male"),
    person("cucu", "male"),
    person("loner"),
  ],
  links: [
    married("tok", "nek"),
    parent("tok", "ali"),
    parent("nek", "ali"),
    parent("tok", "siti"),
    parent("nek", "siti"),
    married("ali", "wife"),
    parent("inlaw", "wife"),
    parent("ali", "cucu"),
    parent("wife", "cucu"),
  ],
  layout: {
    units: [
      { id: "main:0", centre: ["tok", "nek"], anchor: null, anchor_seat: null, size: 6 },
      {
        id: "cluster:wife",
        centre: ["inlaw"],
        anchor: "wife",
        anchor_seat: seat("cluster:wife", 2, { parent: "inlaw" }),
        size: 1,
      },
    ],
    seats: {
      tok: seat("main:0", 1),
      nek: seat("main:0", 1, { partner_of: "tok" }),
      ali: seat("main:0", 2, { parent: "tok", order: 0 }),
      siti: seat("main:0", 2, { parent: "tok", order: 1 }),
      wife: seat("main:0", 2, { partner_of: "ali" }),
      cucu: seat("main:0", 3, { parent: "ali" }),
      inlaw: seat("cluster:wife", 1),
    },
    unlinked: ["loner"],
    centre_chosen: false,
  },
};

const at = (points: Map<string, { x: number; y: number }>, id: string) =>
  points.get(id) ?? { x: Number.NaN, y: Number.NaN };

describe("familyTreeLayout", () => {
  it("puts a generation on each row, partners side by side, children under their parents", () => {
    const { points, hidden, guides, elbows } = familyTreeLayout(
      graph,
      new Set(["cluster:wife"]),
      null,
    );

    expect(at(points, "tok").y).toBe(0);
    expect(at(points, "ali").y).toBe(ROW);
    expect(at(points, "cucu").y).toBe(2 * ROW);
    expect(Math.abs(at(points, "tok").x - at(points, "nek").x)).toBeCloseTo(SPACING);
    expect(Math.abs(at(points, "ali").x - at(points, "wife").x)).toBeCloseTo(SPACING);
    // The married-in family lines up with the person who married in, to the right.
    expect(at(points, "inlaw").y).toBe(0);
    expect(at(points, "inlaw").x).toBeGreaterThan(at(points, "siti").x);
    expect(hidden.size).toBe(0);
    expect(elbows).toBe(true);
    expect(guides.filter((g) => g.kind === "row").map((g) => g.kind === "row" && g.label)).toEqual([
      "Generation 1",
      "Generation 2",
      "Generation 3",
    ]);
  });

  it("folds a married-in family away, and starts from whoever a filter keeps", () => {
    expect(familyTreeLayout(graph, new Set(), null).hidden).toEqual(new Set(["inlaw"]));

    const kept = applyFilter(graph, { ...NO_FILTER, around: "ali", scope: "descendants" });
    const { points, hidden } = familyTreeLayout(graph, new Set(["cluster:wife"]), kept);
    expect([...points.keys()].sort()).toEqual(["ali", "cucu", "wife"]);
    expect(at(points, "ali").y).toBe(ROW); // still on its own generation's row
    expect(hidden.has("tok")).toBe(true);
  });
});

describe("hourglassLayout", () => {
  it("puts ancestors above, fathers first, and descendants below with their partners", () => {
    const { points, focus, guides } = hourglassLayout(graph, "ali", 3, null);

    expect(focus).toBe("ali");
    expect(at(points, "tok").y).toBe(-ROW);
    expect(at(points, "tok").x).toBeLessThan(at(points, "nek").x);
    expect(at(points, "cucu").y).toBe(ROW);
    expect(at(points, "wife").y).toBe(0);
    expect(points.has("siti")).toBe(false); // a sister is neither ancestor nor descendant
    expect(guides.map((g) => g.kind === "row" && g.label)).toEqual(["Parents", "Children"]);
  });

  it("goes only as deep as asked", () => {
    const { points } = hourglassLayout(graph, "cucu", 1, null);
    expect([...points.keys()].sort()).toEqual(["ali", "cucu", "wife"]);
  });
});

describe("fanLayout", () => {
  it("spreads the ancestors over a half-circle, the father's side on the left", () => {
    const { points, guides } = fanLayout(graph, "cucu", 3, null);
    const radii = fanRadii(3);

    expect(at(points, "cucu")).toEqual({ x: 0, y: 0 });
    // Parents on the first band: father left, mother right, both above.
    expect(Math.hypot(at(points, "ali").x, at(points, "ali").y)).toBeCloseTo(radii[1] ?? 0);
    expect(at(points, "ali").x).toBeLessThan(0);
    expect(at(points, "wife").x).toBeGreaterThan(0);
    expect(at(points, "ali").y).toBeLessThan(0);
    // Grandparents on the second: the father's parents on the far left.
    expect(at(points, "tok").x).toBeLessThan(at(points, "nek").x);
    expect(at(points, "nek").x).toBeLessThan(0);
    expect(at(points, "inlaw").x).toBeGreaterThan(0);
    expect(guides.filter((g) => g.kind === "arc").map((g) => g.kind === "arc" && g.label)).toEqual([
      "Parents",
      "Grandparents",
    ]);
  });

  it("makes each band wide enough for everyone on it", () => {
    const radii = fanRadii(6);
    for (let g = 1; g <= 6; g++) {
      const between = ((radii[g] ?? 0) * Math.PI) / 2 ** g; // along the arc, place to place
      expect(between).toBeGreaterThanOrEqual(SPACING - 1e-9);
    }
  });

  it("names the generations", () => {
    expect(generationWord(-1)).toBe("Parents");
    expect(generationWord(-3)).toBe("Great-grandparents");
    expect(generationWord(-5)).toBe("3× great-grandparents");
    expect(generationWord(2)).toBe("Grandchildren");
  });
});
