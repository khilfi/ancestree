import { describe, expect, it } from "vitest";
import type { Graph, GraphPerson, LayoutUnit, Seat } from "@/api/types";
import { branchColours, generationColour, RING_LINE, ringStroke, tint } from "./colours";
import { branchMembers, familiesOf, familyMembers } from "./families";
import { generationShifts, treeGeneration } from "./generations";
import { ringLayout } from "./rings";
import { colourer } from "./toFlow";

/*
 * A family at the centre with two branches; Siti, who married Ali, with her own family
 * hanging off her (her parents and her brother); her brother's wife's family hanging off his
 * wife in turn; and a family not linked to the rest.
 */

function person(id: string, more: Partial<GraphPerson> = {}): GraphPerson {
  return {
    id,
    full_name: `${id[0]?.toUpperCase()}${id.slice(1)} bin Someone`,
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
    ...more,
  };
}

function seat(unit: string, generation: number, fields: Partial<Seat> = {}): Seat {
  return { unit, generation, parent: null, order: 0, partner_of: null, branch: null, ...fields };
}

const unit = (id: string, centre: string[], fields: Partial<LayoutUnit> = {}): LayoutUnit => ({
  id,
  centre,
  anchor: null,
  anchor_seat: null,
  size: 0,
  ...fields,
});

const seats: Record<string, Seat> = {
  tok: seat("main:0", 1),
  nek: seat("main:0", 1, { partner_of: "tok" }),
  ali: seat("main:0", 2, { parent: "tok", order: 0, branch: "ali" }),
  siti: seat("main:0", 2, { partner_of: "ali", branch: "ali" }),
  cucu: seat("main:0", 3, { parent: "ali", order: 0, branch: "ali" }),
  abu: seat("main:0", 2, { parent: "tok", order: 1, branch: "abu" }),
  // Siti's family: her parents in its middle, her brother Daud beside where she'd sit.
  pak: seat("cluster:siti", 1),
  mak: seat("cluster:siti", 1, { partner_of: "pak" }),
  daud: seat("cluster:siti", 2, { parent: "pak", order: 1 }),
  wati: seat("cluster:siti", 2, { partner_of: "daud" }),
  // Wati's family, hanging off her: her mother.
  ibu: seat("cluster:wati", 1),
  // A family not linked to the rest: an unknown parent and his son.
  unknown: seat("main:1", 1),
  jo: seat("main:1", 2, { parent: "unknown", order: 0, branch: "jo" }),
};

const graph: Graph = {
  people: Object.keys(seats).map((id) => person(id, { placeholder: id === "unknown" })),
  links: [],
  layout: {
    units: [
      unit("main:0", ["tok", "nek"]),
      unit("cluster:siti", ["pak", "mak"], {
        anchor: "siti",
        anchor_seat: seat("cluster:siti", 2, { parent: "pak", order: 0 }),
      }),
      unit("cluster:wati", ["ibu"], {
        anchor: "wati",
        anchor_seat: seat("cluster:wati", 2, { parent: "ibu", order: 0 }),
      }),
      unit("main:1", ["unknown"]),
    ],
    seats,
    unlinked: [],
    centre_chosen: false,
  },
};

describe("married-in families on the tree's own generations", () => {
  it("shifts each family's numbers to the person who married in, adding up down the line", () => {
    const shifts = generationShifts(graph);
    expect(Object.fromEntries(shifts)).toEqual({
      "main:0": 0,
      // Siti is generation 2 on the rings and in her own family: no shift.
      "cluster:siti": 0,
      // Wati is generation 2 in Siti's family, and 2 in her own: none either.
      "cluster:wati": 0,
      "main:1": 0,
    });
    // Her brother is in her generation, and his wife's mother one generation up.
    expect(treeGeneration(graph, shifts, "daud")).toBe(2);
    expect(treeGeneration(graph, shifts, "ibu")).toBe(1);
  });

  it("moves a family whose person married in further out", () => {
    // Siti married Ali's son instead: she's generation 3 on the rings.
    const deeper: Graph = {
      ...graph,
      layout: {
        ...graph.layout,
        seats: { ...seats, siti: seat("main:0", 3, { partner_of: "cucu", branch: "ali" }) },
      },
    };
    const shifts = generationShifts(deeper);
    expect(shifts.get("cluster:siti")).toBe(1);
    expect(shifts.get("cluster:wati")).toBe(1);
    expect(treeGeneration(deeper, shifts, "pak")).toBe(2);
    expect(treeGeneration(deeper, shifts, "daud")).toBe(3);

    const siti = ringLayout(deeper, new Set(["cluster:siti"])).rings.filter(
      (ring) => ring.unit === "cluster:siti",
    );
    expect(siti.map((ring) => ring.generation)).toEqual([3]);
  });

  it("colours them by generation like everyone else, but by branch not at all", () => {
    const byGeneration = colourer(graph, "generation");
    expect(byGeneration("daud")).toBe(byGeneration("ali"));
    expect(byGeneration("pak")).toBe(byGeneration("tok"));
    expect(byGeneration("daud")).not.toBe(byGeneration("tok"));

    const byBranch = colourer(graph, "branch");
    expect(byBranch("cucu")).toBe(byBranch("ali"));
    expect(byBranch("abu")).not.toBe(byBranch("ali"));
    expect(byBranch("daud")).toBeNull();
    expect(byBranch("pak")).toBeNull();
  });
});

describe("the rings' colours", () => {
  it("tints a generation's ring only when colouring by generation", () => {
    expect(ringStroke(2, false)).toBe(RING_LINE);
    expect(ringStroke(undefined, true)).toBe(RING_LINE);
    expect(ringStroke(2, true)).toBe(tint(generationColour(2), 0.4));
  });

  it("mixes a colour with white", () => {
    expect(tint("#000000", 0.4)).toBe("#999999");
    expect(tint("#0284c7", 1)).toBe("#0284c7");
    expect(tint("#0284c7", 0)).toBe("#ffffff");
  });

  it("wraps generations before the centre's round the palette", () => {
    expect(generationColour(0)).toBe(generationColour(10));
    expect(generationColour(-1)).toBe(generationColour(9));
  });
});

describe("the families list", () => {
  it("lists every family, nested under the one it hangs off, with how it joins", () => {
    const { families } = familiesOf(graph);
    expect(
      families.map((family) => [family.name, family.people, family.depth, family.anchor]),
    ).toEqual([
      ["Tok & Nek", 6, 0, null],
      ["Pak & Mak", 4, 1, "siti"],
      ["Ibu", 1, 2, "wati"],
      ["Jo's parents", 1, 0, null],
    ]);
    expect(families[1]).toMatchObject({ centre: "pak", married: "ali" });
    expect(families[2]).toMatchObject({ married: "daud" });
  });

  it("gives the branches of the family at the centre, in their colours", () => {
    const { branches } = familiesOf(graph);
    const colours = branchColours(graph);
    expect(branches).toEqual([
      { id: "ali", name: "Ali", people: 3, colour: colours.get("ali") },
      { id: "abu", name: "Abu", people: 1, colour: colours.get("abu") },
    ]);
  });

  it("shows a family with the person it hangs off, and lights a branch with whom they married", () => {
    expect(familyMembers(graph, "cluster:siti").sort()).toEqual([
      "daud",
      "mak",
      "pak",
      "siti",
      "wati",
    ]);
    expect(branchMembers(graph, "ali").sort()).toEqual(["ali", "cucu", "siti"]);
  });
});
