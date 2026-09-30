import { describe, expect, it } from "vitest";
import type { Graph, GraphPerson, LayoutUnit, PartialDate, Seat } from "@/api/types";
import {
  arrange,
  fitAll,
  LANE_HEIGHT,
  MIN_SPAN,
  span,
  spans,
  standings,
  visibleRows,
  yearTicks,
  zoomAround,
} from "./lanes";

const TODAY = 2026.7;

function date(fields: Partial<PartialDate>): PartialDate {
  return {
    year: null,
    month: null,
    day: null,
    qualifier: "exact",
    year_to: null,
    original_text: null,
    ...fields,
  };
}

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
    ...fields,
  };
}

describe("span", () => {
  it("runs from birth to death, with the age at death", () => {
    const lane = span(
      person("tok", {
        born: date({ year: 1901, month: 3, day: 2 }),
        died: date({ year: 1975, month: 8, day: 9 }),
      }),
      TODAY,
    );
    expect(lane).toMatchObject({ ending: "death", years: "1901–1975", age: "died aged 74" });
    expect(lane?.start).toBeCloseTo(1901.17, 2);
  });

  it("reaches today for the living, and says it's approximate when it is", () => {
    const lane = span(
      person("aminah", { born: date({ year: 1962, qualifier: "about" }), is_living: true }),
      TODAY,
    );
    expect(lane).toMatchObject({
      ending: "today",
      end: TODAY,
      roughStart: true,
      years: "b. c. 1962",
      age: "about 64 years old",
    });
  });

  it("fades out when someone died but no one recorded when", () => {
    const lane = span(person("tok", { born: date({ year: 1927 }), is_living: false }), TODAY);
    expect(lane).toMatchObject({ ending: "unknown", start: 1927.5, end: 1987.5, age: null });
  });

  it("leaves people without dates for the Undated tray, and unknown parents out", () => {
    const { placed, undated } = spans(
      [
        person("dated", { born: date({ year: 1980 }), is_living: true }),
        person("undated"),
        person("?", { placeholder: true }),
      ],
      TODAY,
    );
    expect(placed.map((lane) => lane.person.id)).toEqual(["dated"]);
    expect(undated.map((p) => p.id)).toEqual(["undated"]);
  });
});

function seat(unit: string, generation: number, fields: Partial<Seat> = {}): Seat {
  return { unit, generation, parent: null, order: 0, partner_of: null, branch: null, ...fields };
}

function unit(
  id: string,
  anchor: string | null = null,
  anchorSeat: Seat | null = null,
): LayoutUnit {
  return { id, centre: [], anchor, anchor_seat: anchorSeat, size: 0 };
}

// Tok (gen 1); his children Pak (a branch) and Mak (another); Pak's wife Wife. Wife's own
// family is a cluster: her father In-law (gen 1 there) and her sister (gen 2 there, like her).
const graph: Graph = {
  people: [],
  links: [],
  layout: {
    units: [
      unit("main:0"),
      unit("cluster:wife", "wife", seat("cluster:wife", 2, { parent: "inlaw" })),
      unit("main:1"),
    ],
    seats: {
      tok: seat("main:0", 1),
      pak: seat("main:0", 2, { branch: "pak", order: 0 }),
      mak: seat("main:0", 2, { branch: "mak", order: 1 }),
      wife: seat("main:0", 2, { partner_of: "pak", branch: "pak" }),
      inlaw: seat("cluster:wife", 1),
      sister: seat("cluster:wife", 2, { parent: "inlaw", order: 1 }),
      stranger: seat("main:1", 1),
    },
    unlinked: ["loner"],
    centre_chosen: false,
  },
};

describe("standings", () => {
  it("lines a married-in family up with the person who married in", () => {
    const { of, branchOrder } = standings(graph);

    expect(of.get("wife")).toEqual({ generation: 2, family: 0, branch: "pak" });
    expect(of.get("inlaw")).toEqual({ generation: 1, family: 0, branch: "pak" });
    expect(of.get("sister")).toEqual({ generation: 2, family: 0, branch: "pak" });
    expect(of.get("stranger")).toEqual({ generation: 1, family: 1, branch: null });
    expect(of.get("loner")).toBeUndefined();
    expect(branchOrder).toEqual(["pak", "mak"]);
  });
});

describe("arrange", () => {
  const born = (year: number, fields: Partial<GraphPerson> = {}) =>
    person("", { born: date({ year }), is_living: true, ...fields });
  const lanes = [
    ["tok", 1900],
    ["pak", 1930],
    ["mak", 1928],
    ["wife", 1935],
    ["sister", 1932],
    ["stranger", 1910],
    ["loner", 1950],
  ].map(([id, year]) => span({ ...born(year as number), id: id as string }, TODAY)) as NonNullable<
    ReturnType<typeof span>
  >[];
  const names = new Map(lanes.map((lane) => [lane.person.id, lane.person.id.toUpperCase()]));

  it("groups by generation, family by family, the unlinked last; born first within each", () => {
    const { rows, height } = arrange(lanes, standings(graph), names, "generation", "birth");

    expect(rows.map((row) => (row.kind === "group" ? `# ${row.label}` : row.key))).toEqual([
      "# Generation 1",
      "tok",
      "# Generation 2",
      "mak",
      "pak",
      "sister",
      "wife",
      "# Another family: generation 1",
      "stranger",
      "# Not linked yet",
      "loner",
    ]);
    expect(height).toBe(4 * 34 + 7 * LANE_HEIGHT);
  });

  it("groups by branch, in the tree's colour order", () => {
    const { rows } = arrange(lanes, standings(graph), names, "branch", "name");

    expect(rows.filter((row) => row.kind === "group").map((row) => row.label)).toEqual([
      "The oldest generations",
      "PAK's branch",
      "MAK's branch",
      "Another family",
      "Not linked yet",
    ]);
  });

  it("finds the rows in view without looking at the rest", () => {
    const { rows } = arrange(lanes, standings(graph), names, "none", "birth");

    expect(visibleRows(rows, LANE_HEIGHT * 2 + 1, LANE_HEIGHT * 3).map((row) => row.key)).toEqual([
      "mak",
      "pak",
    ]);
  });
});

describe("zooming", () => {
  it("marks every 50, 10 or single year as the zoom allows", () => {
    expect(yearTicks({ start: 1850, end: 2030 }, 300)).toEqual([1850, 1900, 1950, 2000]);
    expect(yearTicks({ start: 1850, end: 2030 }, 700)).toEqual([
      1860, 1880, 1900, 1920, 1940, 1960, 1980, 2000, 2020,
    ]);
    expect(yearTicks({ start: 1955, end: 1985 }, 700)).toEqual([
      1955, 1960, 1965, 1970, 1975, 1980, 1985,
    ]);
    expect(yearTicks({ start: 1970, end: 1975 }, 700)).toEqual([
      1970, 1971, 1972, 1973, 1974, 1975,
    ]);
  });

  it("keeps the year under the pointer in place, down to half a decade", () => {
    const view = zoomAround({ start: 1900, end: 2026 }, 2, 1950);
    expect(view.start).toBeCloseTo(1925);
    expect(view.end).toBeCloseTo(1988);

    const deep = zoomAround(view, 1000, 1950);
    expect(deep.end - deep.start).toBeCloseTo(MIN_SPAN);
    expect(deep.start).toBeLessThan(1950);
    expect(deep.end).toBeGreaterThan(1950);
  });

  it("fits everyone's lives, up to today", () => {
    const lanes = [
      span(person("a", { born: date({ year: 1901 }), died: date({ year: 1975 }) }), TODAY),
      span(person("b", { born: date({ year: 1990 }), is_living: true }), TODAY),
    ].filter((lane) => lane !== null);
    const view = fitAll(lanes, TODAY);

    expect(view.start).toBeLessThan(1901.5);
    expect(view.end).toBeGreaterThan(TODAY);
    expect(fitAll([], TODAY)).toEqual({ start: TODAY - 100, end: TODAY + 5 });
  });
});
