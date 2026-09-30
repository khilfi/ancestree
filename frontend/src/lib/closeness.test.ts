import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, GraphPerson } from "@/api/types";
import { CLOSENESS_COLOURS, closeness, closenessColour } from "./closeness";

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

// Tok's sons Hassan and Rahman; Hassan's daughter Aminah and her son Ali; Rahman's daughter
// Siti. Ali married Nadia; Rahman adopted Anak. Loner isn't linked to anyone.
const graph: Graph = {
  people: ["tok", "hassan", "rahman", "aminah", "ali", "siti", "nadia", "anak", "loner"].map(
    person,
  ),
  links: [
    parent("tok", "hassan"),
    parent("tok", "rahman"),
    parent("hassan", "aminah"),
    parent("aminah", "ali"),
    parent("rahman", "siti"),
    married("ali", "nadia"),
    parent("rahman", "anak", "adoptive"),
  ],
  layout: { units: [], seats: {}, unlinked: ["loner"], centre_chosen: false },
};

describe("closeness", () => {
  it("counts blood relatives by degree: up to the shared ancestor and down again", () => {
    const from = closeness(graph, "ali");
    const degree = (id: string) => {
      const place = from.get(id);
      return place?.kind === "blood" ? place.degree : place?.kind;
    };

    expect(degree("ali")).toBe(0);
    expect(degree("aminah")).toBe(1); // mother
    expect(degree("hassan")).toBe(2); // grandfather
    expect(degree("tok")).toBe(3); // great-grandfather
    expect(degree("rahman")).toBe(4); // great-uncle
    expect(degree("siti")).toBe(5); // first cousin once removed
  });

  it("keeps those linked otherwise apart, and leaves out those not linked at all", () => {
    const from = closeness(graph, "ali");

    expect(from.get("nadia")).toEqual({ kind: "linked" }); // his wife
    expect(from.get("anak")).toEqual({ kind: "linked" }); // adopted, not blood
    expect(from.has("loner")).toBe(false);
  });

  it("colours the closest warm and those further out cooler", () => {
    expect(closenessColour({ kind: "blood", degree: 0 })).toBe(CLOSENESS_COLOURS.you);
    expect(closenessColour({ kind: "blood", degree: 1 })).toBe(CLOSENESS_COLOURS.degrees[0]);
    expect(closenessColour({ kind: "blood", degree: 9 })).toBe(CLOSENESS_COLOURS.degrees[5]);
    expect(closenessColour({ kind: "linked" })).toBe(CLOSENESS_COLOURS.linked);
    expect(closenessColour(undefined)).toBeNull();
  });
});
