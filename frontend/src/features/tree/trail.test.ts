import { describe, expect, it } from "vitest";
import type { Graph, GraphPerson } from "@/api/types";
import { NO_FILTER, type TreeView } from "./filters";
import { focusFor, NO_TRAIL, step, visit } from "./trail";

function person(id: string, placeholder = false): GraphPerson {
  return {
    id,
    full_name: id,
    nickname: null,
    gender: "unknown",
    birth_year: null,
    death_year: null,
    birth_order: null,
    placeholder,
    photo_version: null,
    has_story: false,
  };
}

// Tok & Nek at the centre of the rings; Ali, Siti and an unknown parent among the family.
const graph: Graph = {
  people: ["tok", "nek", "ali", "siti"].map((id) => person(id)).concat(person("unknown", true)),
  links: [],
  layout: {
    units: [{ id: "main:0", centre: ["tok", "nek"], anchor: null, anchor_seat: null, size: 4 }],
    seats: {},
    unlinked: [],
    centre_chosen: false,
  },
};

const fan = (from: string | null, around: string | null = null): TreeView => ({
  layout: "fan",
  depth: null,
  filter: { ...NO_FILTER, around },
  from,
});

describe("whom an hourglass or fan chart is drawn from", () => {
  it("stays with its person while someone else is opened, or the panel closed", () => {
    expect(focusFor(graph, fan("ali"), "siti")).toBe("ali");
    expect(focusFor(graph, fan("ali"), null)).toBe("ali");
    expect(focusFor(graph, { ...fan("ali"), layout: "hourglass" }, "siti")).toBe("ali");
  });

  it("before it has one: the filter's person, whoever is open, or the centre of the rings", () => {
    expect(focusFor(graph, fan(null, "nek"), "siti")).toBe("nek");
    expect(focusFor(graph, fan(null), "siti")).toBe("siti");
    expect(focusFor(graph, fan(null), null)).toBe("tok");
    // Someone gone from the family, or an unknown parent, is never drawn from.
    expect(focusFor(graph, fan("gone"), "unknown")).toBe("tok");
  });

  it("names, on the rings, whom a chart would be drawn from: the one open", () => {
    expect(focusFor(graph, { ...fan("ali"), layout: "rings" }, "siti")).toBe("siti");
  });
});

describe("Back and Forward through those it was drawn from", () => {
  it("steps back and forward, and drops what was ahead when it goes somewhere new", () => {
    let trail = visit(visit(visit(NO_TRAIL, "tok"), "ali"), "siti");
    expect(trail).toEqual({ ids: ["tok", "ali", "siti"], at: 2 });
    trail = step(trail, -1) ?? trail;
    trail = step(trail, -1) ?? trail;
    expect(trail.ids[trail.at]).toBe("tok");
    expect(step(trail, -1)).toBeNull(); // nothing before the first
    trail = step(trail, 1) ?? trail;
    expect(trail.ids[trail.at]).toBe("ali");
    trail = visit(trail, "nek");
    expect(trail).toEqual({ ids: ["tok", "ali", "nek"], at: 2 });
    expect(step(trail, 1)).toBeNull(); // Siti was ahead, and went
  });

  it("takes in the person it's drawn from again as nothing new", () => {
    const trail = visit(visit(NO_TRAIL, "tok"), "ali");
    expect(visit(trail, "ali")).toBe(trail);
  });
});
