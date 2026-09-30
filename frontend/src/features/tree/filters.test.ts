import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, GraphPerson, Seat } from "@/api/types";
import {
  applyFilter,
  chips,
  layoutsFor,
  NO_FILTER,
  readView,
  type TreeFilter,
  viewSearch,
  withView,
  writeView,
} from "./filters";

function person(id: string, fields: Partial<GraphPerson> = {}): GraphPerson {
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
    is_living: true,
    ...fields,
  };
}

function parent(source: string, target: string, kind = "biological"): GraphLink {
  const id = `${source}>${target}`;
  return { id, type: "parent", source, target, kind, status: null, in_layout: true };
}

function married(source: string, target: string): GraphLink {
  const id = `${source}=${target}`;
  return { id, type: "spouse", source, target, kind: null, status: "married", in_layout: true };
}

function seat(unit: string, generation: number, fields: Partial<Seat> = {}): Seat {
  return { unit, generation, parent: null, order: 0, partner_of: null, branch: null, ...fields };
}

// Tok & Nek; their sons Hassan and Rahman; Hassan married Mariam, whose father Pak Wan is her
// own (married-in) family; their daughter Aminah had Ali with an unknown parent; Rahman had
// Siti and adopted Anak. Loner isn't linked to anyone.
const graph: Graph = {
  people: [
    person("tok", { gender: "male", birth_year: 1900, is_living: false }),
    person("nek", { gender: "female", is_living: false }),
    person("hassan", { gender: "male", birth_year: 1938, born_in: "Kelantan" }),
    person("rahman", { gender: "male", birth_year: 1941, photo_version: 2 }),
    person("mariam", { gender: "female", birth_year: 1940, born_in: "Selangor" }),
    person("pakwan", { gender: "male" }),
    person("aminah", { gender: "female", birth_year: 1962 }),
    person("unknown", { placeholder: true }),
    person("ali", { birth_year: 1985 }),
    person("siti", { gender: "female", birth_year: 1970, born_in: "Selangor" }),
    person("anak", { gender: "male", birth_year: 1975 }),
    person("loner"),
  ],
  links: [
    married("tok", "nek"),
    parent("tok", "hassan"),
    parent("nek", "hassan"),
    parent("tok", "rahman"),
    parent("nek", "rahman"),
    married("hassan", "mariam"),
    parent("pakwan", "mariam"),
    parent("hassan", "aminah"),
    parent("mariam", "aminah"),
    parent("aminah", "ali"),
    parent("unknown", "ali"),
    parent("rahman", "siti"),
    parent("rahman", "anak", "adoptive"),
  ],
  layout: {
    units: [
      { id: "main:0", centre: ["tok", "nek"], anchor: null, anchor_seat: null, size: 10 },
      {
        id: "cluster:mariam",
        centre: ["pakwan"],
        anchor: "mariam",
        anchor_seat: seat("cluster:mariam", 2, { parent: "pakwan" }),
        size: 1,
      },
    ],
    seats: {
      tok: seat("main:0", 1),
      nek: seat("main:0", 1, { partner_of: "tok" }),
      hassan: seat("main:0", 2, { parent: "tok" }),
      rahman: seat("main:0", 2, { parent: "tok", order: 1 }),
      mariam: seat("main:0", 2, { partner_of: "hassan" }),
      aminah: seat("main:0", 3, { parent: "hassan" }),
      unknown: seat("main:0", 3, { partner_of: "aminah" }),
      ali: seat("main:0", 4, { parent: "aminah" }),
      siti: seat("main:0", 3, { parent: "rahman" }),
      anak: seat("main:0", 3, { parent: "rahman", order: 1 }),
      pakwan: seat("cluster:mariam", 1),
    },
    unlinked: ["loner"],
    centre_chosen: false,
  },
};

function kept(filter: Partial<TreeFilter>): string[] {
  return [...(applyFilter(graph, { ...NO_FILTER, ...filter }) ?? [])].sort();
}

describe("the view in the address", () => {
  it("round-trips, and leaves out what is the default", () => {
    const view = readView(
      new URLSearchParams(
        "layout=fan&depth=4&around=ali&scope=within&links=2&leave=married,died&gen=2-4&born=1960-1900&place=Selangor&gender=unknown&missing=year&others=faded&person=x",
      ),
    );
    expect(view.layout).toBe("fan");
    expect(view.filter.born).toEqual([1900, 1960]);
    const written = writeView(view);
    expect(written.get("person")).toBeNull();
    expect(readView(written)).toEqual(view);
    expect(writeView(readView(new URLSearchParams())).toString()).toBe("");
  });

  it("keeps the view when someone is opened, and passes it between the tree and timeline", () => {
    const params = new URLSearchParams("gen=2-2&person=ali&relate=pick");
    expect(withView(params, { person: "siti" }).toString()).toBe("gen=2-2&person=siti");
    expect(viewSearch(params)).toBe("?gen=2-2");
    expect(viewSearch(new URLSearchParams("person=ali"))).toBe("");
  });
});

describe("applyFilter", () => {
  it("keeps everyone when nothing is chosen", () => {
    expect(applyFilter(graph, NO_FILTER)).toBeNull();
  });

  it("chooses around someone: their line, ancestors, descendants, blood relatives", () => {
    expect(kept({ around: "ali", scope: "ancestors" })).toEqual(
      ["ali", "aminah", "hassan", "mariam", "nek", "pakwan", "tok", "unknown"].sort(),
    );
    // Descendants come with their husbands and wives.
    expect(kept({ around: "hassan", scope: "descendants" })).toEqual(
      ["ali", "aminah", "hassan", "mariam", "unknown"].sort(),
    );
    // Blood: up the birth links, then down; not the adopted son, nor Mariam.
    expect(kept({ around: "siti", scope: "blood" })).toEqual(
      ["ali", "aminah", "hassan", "nek", "rahman", "siti", "tok", "unknown"].sort(),
    );
    expect(kept({ around: "aminah", scope: "within", links: 1 })).toEqual(
      ["ali", "aminah", "hassan", "mariam", "unknown"].sort(),
    );
  });

  it("leaves out married-in families, those who have died, adoptive links", () => {
    expect(kept({ leave: new Set(["married"]) })).not.toContain("pakwan");
    expect(kept({ leave: new Set(["died"]) })).not.toContain("tok");
    expect(kept({ around: "rahman", scope: "descendants", leave: new Set(["care"]) })).toEqual([
      "rahman",
      "siti",
    ]);
    expect(kept({ leave: new Set(["unknown"]) })).not.toContain("unknown");
  });

  it("keeps only a generation, a span of births, a birthplace, a gender, what's missing", () => {
    expect(kept({ generations: [2, 2] })).toEqual(["hassan", "mariam", "rahman"]);
    expect(kept({ born: [1960, 1979] })).toEqual(["aminah", "anak", "siti"]);
    expect(kept({ place: "Selangor" })).toEqual(["mariam", "siti"]);
    // An unknown parent comes with the child it's linked to, whatever its own gender.
    expect(kept({ genders: new Set(["unknown"]) })).toEqual(["ali", "loner", "unknown"]);
    expect(kept({ missing: new Set(["year"]) })).toEqual(["loner", "nek", "pakwan"]);
    expect(kept({ missing: new Set(["photo"]) })).not.toContain("rahman");
  });
});

describe("chips and layouts", () => {
  it("names each active filter, and takes it away", () => {
    const filter: TreeFilter = {
      ...NO_FILTER,
      around: "ali",
      scope: "within",
      links: 2,
      generations: [2, 4],
      genders: new Set(["male", "unknown"]),
    };
    const found = chips(filter, (id) => id.toUpperCase());
    expect(found.map((chip) => chip.label)).toEqual([
      "Around ALI · within 2 links",
      "Generations 2–4",
      "Only men, gender not recorded",
    ]);
    expect(found[0]?.without(filter).around).toBeNull();
  });

  it("offers the layouts that suit the filter first", () => {
    expect(layoutsFor(NO_FILTER)[0]).toBe("rings");
    expect(layoutsFor({ ...NO_FILTER, around: "ali", scope: "ancestors" })[0]).toBe("fan");
    expect(layoutsFor({ ...NO_FILTER, around: "ali", scope: "descendants" })[0]).toBe("tree");
    expect(layoutsFor({ ...NO_FILTER, around: "ali" })[0]).toBe("hourglass");
  });
});
