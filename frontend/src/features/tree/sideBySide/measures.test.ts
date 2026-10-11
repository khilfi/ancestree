import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, GraphPerson, Seat } from "@/api/types";
import { pathPoints } from "../geometry";
import type { RingLayout } from "../rings";
import { crossings, measure, segmentsCross } from "./measures";

/*
 * What spike S7 measures, each counted on a layout placed by hand.
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

const seat = (unit: string): Seat => ({
  unit,
  generation: 1,
  parent: null,
  order: 0,
  partner_of: null,
  branch: null,
});

function couple(id: string, source: string, target: string): GraphLink {
  return { id, type: "spouse", source, target, kind: null, status: "married", in_layout: true };
}

describe("what S7 measures", () => {
  it("follows the tree's lines, straight or curved", () => {
    expect(pathPoints("M 0,0 L 10,0")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const curve = pathPoints("M 0,0 C 0,10 10,10 10,0");
    expect(curve).toHaveLength(17);
    expect(curve[0]).toEqual({ x: 0, y: 0 });
    expect(curve.at(-1)).toEqual({ x: 10, y: 0 });
    expect(curve[8]?.y).toBeCloseTo(7.5);
  });

  it("counts a long straight line wherever another crosses it, whichever comes first", () => {
    const people = (...ids: string[]) => new Set(ids);
    const long = {
      people: people("a", "b"),
      points: [
        { x: 0, y: 0 },
        { x: 5000, y: 0 },
      ],
      between: true,
    };
    const short = {
      people: people("c", "d"),
      points: [
        { x: 4000, y: -50 },
        { x: 4010, y: 50 },
      ],
      between: false,
    };
    expect(crossings([long, short])).toBe(1);
    expect(crossings([short, long])).toBe(1);
  });

  it("counts lines that cross, not those that only meet", () => {
    const at = (x: number, y: number) => ({ x, y });
    expect(segmentsCross(at(0, 0), at(10, 10), at(0, 10), at(10, 0))).toBe(true);
    expect(segmentsCross(at(0, 0), at(10, 0), at(10, 0), at(20, 5))).toBe(false); // they meet
    expect(segmentsCross(at(0, 0), at(10, 0), at(0, 5), at(10, 5))).toBe(false); // side by side
  });

  it("counts photos that overlap, photos under lines, rings through others, and crossings", () => {
    // a and b too close; c and d married, their line over e; g and h married, crossing it; and
    // a married-in family's ring through e.
    const seats: Record<string, Seat> = {
      a: seat("main:0"),
      b: seat("main:0"),
      e: seat("main:0"),
      g: seat("main:0"),
      h: seat("main:0"),
      c: seat("cluster:x"),
      d: seat("cluster:x"),
    };
    const graph: Graph = {
      people: Object.keys(seats).map(person),
      links: [
        couple("00000000-0000-4000-8000-000000000001", "c", "d"),
        couple("00000000-0000-4000-8000-000000000002", "g", "h"),
      ],
      layout: { units: [], seats, unlinked: [], centre_chosen: false },
    };
    const points = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 30, y: 0 }],
      ["c", { x: -200, y: 100 }],
      ["d", { x: 200, y: 100 }],
      ["e", { x: 0, y: 100 }],
      ["g", { x: -100, y: 50 }],
      ["h", { x: -40, y: 150 }],
    ]);
    const ring = { unit: "cluster:x", generation: 2, x: 0, y: 400, radius: 300, cluster: true };
    const layout: RingLayout = {
      points,
      rings: [ring],
      hidden: new Set(),
      folds: new Map(),
      tray: null,
      middles: new Map([
        ["main:0", { x: 0, y: 0 }],
        ["cluster:x", { x: 0, y: 400 }],
      ]),
    };

    const measured = measure(graph, layout);

    expect(measured.overlaps).toBe(1);
    expect(measured.underLines).toBe(1);
    expect(measured.ringsCrossing).toBe(1);
    expect(measured.crossings).toBe(1);
    expect(measured.longest).toBeCloseTo(400 - 2 * 28);
    expect(measured.width).toBeGreaterThan(400);
    // An arc that stops short of e crosses nobody.
    const arc = { ...ring, span: { from: (2 * Math.PI) / 3, to: (4 * Math.PI) / 3 } };
    expect(measure(graph, { ...layout, rings: [arc] }).ringsCrossing).toBe(0);
  });
});
