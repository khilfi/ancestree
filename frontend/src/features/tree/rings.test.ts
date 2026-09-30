import { describe, expect, it } from "vitest";
import type { Graph, GraphPerson, LayoutUnit, Seat } from "@/api/types";
import { RING_GAP, ringLayout, SPACING } from "./rings";

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

function graph(seats: Record<string, Seat>, units: LayoutUnit[], unlinked: string[] = []): Graph {
  return {
    people: [...Object.keys(seats), ...unlinked].map(person),
    links: [],
    layout: { units, seats, unlinked, centre_chosen: false },
  };
}

const main: LayoutUnit = {
  id: "main:0",
  centre: ["tok", "nek"],
  anchor: null,
  anchor_seat: null,
  size: 0,
};
const family = {
  tok: seat("main:0", 1),
  nek: seat("main:0", 1, { partner_of: "tok" }),
  ali: seat("main:0", 2, { parent: "tok", order: 0 }),
  siti: seat("main:0", 2, { parent: "tok", order: 1 }),
  wife: seat("main:0", 2, { partner_of: "ali" }),
  cucu: seat("main:0", 3, { parent: "ali", order: 0 }),
};

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("ringLayout", () => {
  it("puts the centre couple in the middle and each generation on its own ring", () => {
    const { points, rings } = ringLayout(graph(family, [main]), new Set());
    const at = (id: string) => points.get(id) ?? { x: Number.NaN, y: Number.NaN };
    const middle = { x: (at("tok").x + at("nek").x) / 2, y: at("tok").y };

    expect(distance(at("tok"), at("nek"))).toBeCloseTo(SPACING);
    expect(distance(at("ali"), middle)).toBeCloseTo(distance(at("siti"), middle));
    expect(distance(at("cucu"), middle)).toBeGreaterThan(
      distance(at("ali"), middle) + RING_GAP / 2,
    );
    expect(rings.map((ring) => ring.generation)).toEqual([2, 3]);
  });

  it("seats a wife beside her husband, on his ring", () => {
    const { points } = ringLayout(graph(family, [main]), new Set());
    const [ali, wife] = [points.get("ali"), points.get("wife")];

    expect(ali && wife && distance(ali, wife)).toBeCloseTo(SPACING, -1);
  });

  it("widens a crowded ring so that no two people overlap", () => {
    const seats: Record<string, Seat> = { tok: seat("main:0", 1) };
    for (let n = 0; n < 40; n++) seats[`c${n}`] = seat("main:0", 2, { parent: "tok", order: n });
    const { points, rings } = ringLayout(graph(seats, [{ ...main, centre: ["tok"] }]), new Set());

    const children = [...points.entries()].filter(([id]) => id !== "tok").map(([, p]) => p);
    const closest = Math.min(
      ...children.flatMap((a, i) => children.slice(i + 1).map((b) => distance(a, b))),
    );
    expect(closest).toBeGreaterThan(SPACING * 0.95);
    expect(rings[0]?.radius).toBeGreaterThan(RING_GAP);
  });

  it("keeps a wife's family folded until it's opened, then places it outside the rings", () => {
    const cluster: LayoutUnit = {
      id: "cluster:wife",
      centre: ["inlaw"],
      anchor: "wife",
      anchor_seat: seat("cluster:wife", 2, { parent: "inlaw", order: 0 }),
      size: 2,
    };
    const seats = {
      ...family,
      inlaw: seat("cluster:wife", 1),
      sister: seat("cluster:wife", 2, { parent: "inlaw", order: 1 }),
    };

    const folded = ringLayout(graph(seats, [main, cluster]), new Set());
    const opened = ringLayout(graph(seats, [main, cluster]), new Set(["cluster:wife"]));

    expect([...folded.hidden].sort()).toEqual(["inlaw", "sister"]);
    expect(folded.folds.get("wife")).toEqual([{ unit: "cluster:wife", size: 2, open: false }]);
    expect(opened.hidden.size).toBe(0);
    const middle = { x: 0, y: 0 };
    const outermost = Math.max(...[...folded.points.values()].map((p) => distance(p, middle)));
    const inlaw = opened.points.get("inlaw");
    expect(inlaw && distance(inlaw, middle)).toBeGreaterThan(outermost);
  });

  it("gathers people with no links in a tray beside the rings", () => {
    const { points, tray } = ringLayout(graph(family, [main], ["solo"]), new Set());

    expect(tray).not.toBeNull();
    expect(points.get("solo")?.x).toBeLessThan(
      Math.min(...["tok", "ali"].map((id) => points.get(id)?.x ?? 0)),
    );
  });
});
