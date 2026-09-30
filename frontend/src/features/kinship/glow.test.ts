import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, KinRelation, LayoutUnit, Seat } from "@/api/types";
import type { TreeEdge } from "@/features/tree/toFlow";
import { clustersToOpen, glowFor } from "./glow";

function parentLink(id: string, source: string, target: string): GraphLink {
  return {
    id,
    type: "parent",
    source,
    target,
    kind: "biological",
    status: null,
    in_layout: true,
  };
}

function relation(fields: Partial<KinRelation>): KinRelation {
  const statement = { term: "", sentence: "", detail: null, malay: null };
  return {
    type: "blood",
    forward: statement,
    reverse: statement,
    generations: 0,
    shared_ancestors: [],
    path: [],
    links: [],
    ...fields,
  };
}

// Tok and Nek's children Pak and Mak; Ali is Pak's son. Ali and Mak: nephew and aunt.
const tokPak = parentLink("l1", "tok", "pak");
const nekPak = parentLink("l2", "nek", "pak");
const tokMak = parentLink("l3", "tok", "mak");
const nekMak = parentLink("l4", "nek", "mak");
const pakAli = parentLink("l5", "pak", "ali");
const edges: TreeEdge[] = [
  {
    id: "family:pak",
    type: "child",
    source: "tok",
    target: "pak",
    data: { partner: "nek", links: [tokPak, nekPak], look: "blood", middle: null },
  },
  {
    id: "family:mak",
    type: "child",
    source: "tok",
    target: "mak",
    data: { partner: "nek", links: [tokMak, nekMak], look: "blood", middle: null },
  },
  {
    id: "family:ali",
    type: "child",
    source: "pak",
    target: "ali",
    data: { partner: null, links: [pakAli], look: "blood", middle: null },
  },
  {
    id: "spouse:m1",
    type: "spouse",
    source: "tok",
    target: "nek",
    data: {
      link: { ...pakAli, id: "m1", type: "spouse", source: "tok", target: "nek" },
      children: true,
    },
  },
];

describe("glowFor", () => {
  it("lights up the path, the shared ancestors and the line between the couple", () => {
    const glow = glowFor(
      relation({
        path: ["ali", "pak", "tok", "mak"],
        links: ["l5", "l1", "l3"],
        shared_ancestors: ["tok", "nek"],
      }),
      edges,
    );

    expect([...glow.people].sort()).toEqual(["ali", "mak", "nek", "pak", "tok"]);
    expect([...glow.edges].sort()).toEqual(["family:ali", "family:mak", "family:pak", "spouse:m1"]);
  });

  it("lights up a marriage on the way", () => {
    const glow = glowFor(
      relation({ type: "marriage", path: ["tok", "nek"], links: ["m1"] }),
      edges,
    );

    expect([...glow.edges]).toEqual(["spouse:m1"]);
  });
});

function seat(unit: string): Seat {
  return { unit, generation: 1, parent: null, order: 0, partner_of: null, branch: null };
}

function unit(id: string, anchor: string | null): LayoutUnit {
  return { id, centre: [], anchor, anchor_seat: null, size: 1 };
}

describe("clustersToOpen", () => {
  it("opens a folded family, and the one it hangs from", () => {
    const graph: Graph = {
      people: [],
      links: [],
      layout: {
        units: [unit("main:0", null), unit("cluster:wife", "wife"), unit("cluster:inlaw", "inlaw")],
        seats: {
          ali: seat("main:0"),
          wife: seat("main:0"),
          inlaw: seat("cluster:wife"),
          cousin: seat("cluster:inlaw"),
        },
        unlinked: [],
        centre_chosen: false,
      },
    };

    expect(clustersToOpen(graph, ["ali"])).toEqual([]);
    expect(clustersToOpen(graph, ["cousin"]).sort()).toEqual(["cluster:inlaw", "cluster:wife"]);
  });
});
