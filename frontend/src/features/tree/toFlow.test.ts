import { describe, expect, it } from "vitest";
import type { Graph, GraphLink, GraphPerson } from "@/api/types";
import type { ChildEdgeData, SpouseEdgeData } from "./edges";
import type { RingLayout } from "./rings";
import { type TreeEdge, toFlow } from "./toFlow";

/*
 * A couple's adopted and foster children hang from their marriage too: a child whose
 * two parents on the tree are a couple has one line from the dot on their marriage line, of any
 * kind, dashed for care and solid for blood, and the marriage line shows its dot. Parents who
 * aren't a couple each keep a line of their own. Routed links, side-by-side families, the
 * tree's picture and a copy all draw these lines. Made-up people.
 */

function person(id: string, gender: GraphPerson["gender"] = "unknown"): GraphPerson {
  return {
    id,
    full_name: id,
    nickname: null,
    gender,
    birth_year: null,
    death_year: null,
    birth_order: null,
    placeholder: false,
    photo_version: null,
    has_story: false,
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

/** The family, everyone shown, placed anywhere: the lines are what's checked. */
function flow(people: string[], links: GraphLink[]): TreeEdge[] {
  const graph = {
    people: people.map((id) => person(id)),
    links,
    layout: { units: [], seats: {} },
  } as unknown as Graph;
  const layout: RingLayout = {
    points: new Map(people.map((id, index) => [id, { x: index * 100, y: 0 }])),
    rings: [],
    hidden: new Set(),
    folds: new Map(),
    tray: null,
    middles: new Map(),
  };
  return toFlow(graph, layout, "off", { saved: false }).edges;
}

/** Each child's lines: where each starts, the parent and the other at the dot, and its look. */
function linesTo(edges: TreeEdge[], child: string): string[] {
  return edges
    .filter((edge) => edge.type === "child" && edge.target === child)
    .map((edge) => {
      const data = edge.data as ChildEdgeData;
      const from = data.partner ? `${edge.source}+${data.partner}` : edge.source;
      return `${from} ${data.look}`;
    })
    .sort();
}

function dotted(edges: TreeEdge[]): string[] {
  return edges
    .filter((edge) => edge.type === "spouse" && (edge.data as SpouseEdgeData).children)
    .map((edge) => `${edge.source}=${edge.target}`)
    .sort();
}

describe("a couple's adopted and foster children", () => {
  it("hang from their marriage's dot, dashed, and the marriage shows its dot", () => {
    const edges = flow(
      ["ali", "siti", "adik"],
      [
        married("ali", "siti"),
        parent("ali", "adik", "adoptive"),
        parent("siti", "adik", "adoptive"),
      ],
    );
    expect(linesTo(edges, "adik")).toEqual(["ali+siti care"]);
    expect(dotted(edges)).toEqual(["ali=siti"]);
    const [line] = edges.filter((edge) => edge.type === "child");
    expect(line?.id).toBe("family:adik");
    const data = line?.data as ChildEdgeData | undefined;
    expect(data?.links.map((link) => link.id).sort()).toEqual(["ali>adik", "siti>adik"]);
  });

  it("does so for a foster child, and for a stepfather who adopted with the mother", () => {
    const fostered = flow(
      ["ali", "siti", "anak"],
      [married("ali", "siti"), parent("ali", "anak", "foster"), parent("siti", "anak", "foster")],
    );
    expect(linesTo(fostered, "anak")).toEqual(["ali+siti care"]);
    const stepped = flow(
      ["mak", "ayah tiri", "anak"],
      [married("mak", "ayah tiri"), parent("mak", "anak"), parent("ayah tiri", "anak", "adoptive")],
    );
    expect(linesTo(stepped, "anak")).toEqual(["mak+ayah tiri care"]);
    expect(dotted(stepped)).toEqual(["mak=ayah tiri"]);
  });

  it("keeps a solid line from the dot for a couple's own child, as ever", () => {
    const edges = flow(
      ["ali", "siti", "anak"],
      [married("ali", "siti"), parent("ali", "anak"), parent("siti", "anak")],
    );
    expect(linesTo(edges, "anak")).toEqual(["ali+siti blood"]);
    expect(dotted(edges)).toEqual(["ali=siti"]);
  });

  it("gives parents who aren't a couple a line each", () => {
    const edges = flow(
      ["ali", "siti", "adik"],
      [parent("ali", "adik", "adoptive"), parent("siti", "adik", "adoptive")],
    );
    expect(linesTo(edges, "adik")).toEqual(["ali care", "siti care"]);
    expect(edges.some((edge) => edge.type === "pair")).toBe(false);
  });

  it("hangs a child from each couple: the birth parents' and the adoptive parents'", () => {
    const edges = flow(
      ["bapa", "ibu", "ali", "siti", "adik"],
      [
        married("bapa", "ibu"),
        married("ali", "siti"),
        parent("bapa", "adik"),
        parent("ibu", "adik"),
        parent("ali", "adik", "adoptive"),
        parent("siti", "adik", "adoptive"),
      ],
    );
    expect(linesTo(edges, "adik")).toEqual(["ali+siti care", "bapa+ibu blood"]);
    expect(dotted(edges)).toEqual(["ali=siti", "bapa=ibu"]);
    const ids = edges.filter((edge) => edge.type === "child").map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length); // each line its own
  });

  it("still joins birth parents who never married, by a line of their own", () => {
    const edges = flow(["bapa", "ibu", "anak"], [parent("bapa", "anak"), parent("ibu", "anak")]);
    expect(linesTo(edges, "anak")).toEqual(["bapa+ibu blood"]);
    expect(edges.filter((edge) => edge.type === "pair").map((edge) => edge.id)).toEqual([
      "pair:bapa+ibu",
    ]);
  });
});
