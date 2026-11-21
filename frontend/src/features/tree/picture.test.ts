import { describe, expect, it } from "vitest";
import type { GraphPerson } from "@/api/types";
import type { PersonFlowNode } from "./PersonNode";
import { drawTree, type Measure, type TreeSnapshot, wrapName } from "./picture";
import type { TreeEdge } from "./toFlow";

// Every character 6.5 pixels wide: close to the 12px name font, and predictable.
const measure: Measure = (text) => text.length * 6.5;

function person(id: string, fullName: string, more: Partial<GraphPerson> = {}): GraphPerson {
  return {
    id,
    full_name: fullName,
    nickname: null,
    gender: "unknown",
    birth_year: null,
    death_year: null,
    birth_order: null,
    placeholder: false,
    photo_version: null,
    has_story: false,
    ...more,
  };
}

function node(
  who: GraphPerson,
  x: number,
  y: number,
  more: Partial<PersonFlowNode["data"]> = {},
): PersonFlowNode {
  return {
    id: who.id,
    type: who.placeholder ? "unknown" : "person",
    position: { x, y },
    data: { person: who, years: "", colour: null, folds: [], ...more },
  };
}

const hassan = person("h", "Hassan bin Ismail", { photo_version: 2 });
const mariam = person("m", "Mariam & Salleh's daughter");
const yusof = person("y", "Yusof");
const unknown = person("u", "Unknown", { placeholder: true });

const snapshot: TreeSnapshot = {
  nodes: [
    node(hassan, 0, 0, { years: "1938–2011", colour: "#0284c7" }),
    node(mariam, 200, 0, { folds: [{ unit: "cluster:m", size: 3, open: false }] }),
    node(yusof, 100, 250),
    node(unknown, -300, 250),
  ],
  edges: [
    {
      id: "family:y",
      type: "child",
      source: "h",
      target: "y",
      data: { partner: "m", links: [], look: "blood", middle: null },
    },
    {
      id: "spouse:1",
      type: "spouse",
      source: "h",
      target: "m",
      data: {
        link: {
          id: "1",
          type: "spouse",
          source: "h",
          target: "m",
          kind: null,
          status: "divorced",
          order: null,
        },
        children: true,
      },
    },
  ] as TreeEdge[],
  rings: [{ unit: "main", generation: 2, x: 164, y: 300, radius: 400, cluster: false }],
  tray: { x: -600, y: 900, width: 300, height: 150 },
};

describe("names under a photo", () => {
  it("stay on one line when they fit", () => {
    expect(wrapName("Yusof", 128, measure)).toEqual(["Yusof"]);
  });

  it("take a second line, like the canvas", () => {
    expect(wrapName("Hassan bin Ismail bin Abu", 128, measure)).toEqual([
      "Hassan bin Ismail",
      "bin Abu",
    ]);
  });

  it("end in … when two lines aren't enough", () => {
    const lines = wrapName("Nik Nur Aisyah binti Nik Abdul Rashid al-Haj", 128, measure);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(measure(lines[1] ?? "", "")).toBeLessThanOrEqual(128);
  });
});

describe("the picture", () => {
  const { svg, width, height } = drawTree(snapshot, {
    photos: new Map([["h", "data:image/webp;base64,AAAA"]]),
    fontFace: "@font-face{}",
    measure,
  });

  it("is an SVG big enough for everyone, the rings and the tray", () => {
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    const [left, top] =
      svg
        .match(/viewBox="(-?[\d.]+) (-?[\d.]+)/)
        ?.slice(1)
        .map(Number) ?? [];
    expect(left).toBeLessThanOrEqual(-600); // the tray's edge
    expect(top).toBeLessThanOrEqual(300 - 400 - 24); // the ring's label
    expect(width).toBeGreaterThan(1000);
    expect(height).toBeGreaterThan(1000);
  });

  it("has everyone: photos, initials, names, years and an unknown parent", () => {
    expect(svg).toContain('href="data:image/webp;base64,AAAA"');
    expect(svg).toContain(">MS</text>"); // Mariam has no photo
    expect(svg).toContain(">Hassan bin Ismail</text>");
    expect(svg).toContain(">1938–2011</text>");
    expect(svg).toContain(">?</text>");
    expect(svg).toContain('stroke="#0284c7"'); // Hassan's branch colour
  });

  it("writes names safely", () => {
    expect(svg).toContain("Mariam &amp; Salleh");
    expect(svg).not.toContain("Mariam & Salleh");
  });

  it("draws the links, the rings, a folded family and the tray", () => {
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain('stroke-dasharray="6 4"'); // the divorce
    expect(svg).toContain('r="4.5"'); // the dot their child hangs from
    expect(svg).toContain(">Generation 2</text>");
    expect(svg).toContain(">+3</text>");
    expect(svg).toContain(">Not linked yet</text>");
  });

  it("stands each name and its years on a soft background, as the tree does", () => {
    const lines = svg.split("\n");
    for (const name of [">Hassan bin Ismail</text>", ">Yusof</text>"]) {
      const at = lines.findIndex((line) => line.includes(name));
      expect(at).toBeGreaterThan(0);
      // Just before the name, a box the paper's colour, a little see-through, round its words.
      expect(lines[at - 1]).toMatch(/^<rect [^>]*fill="#ffffff" fill-opacity="0.9"\/>$/);
    }
    // Hassan's box takes his name and his years: two lines, 30 pixels and more high.
    const hassan = lines.findIndex((line) => line.includes(">Hassan bin Ismail</text>"));
    const high = Number(/height="([\d.]+)"/.exec(lines[hassan - 1] ?? "")?.[1]);
    expect(high).toBeGreaterThanOrEqual(30);
  });
});

describe("the rings' words in the picture", () => {
  // As the tree says them: each generation once, a married-in family's oldest arc named for
  // its couple, and its other arcs nothing.
  const { svg } = drawTree(
    {
      ...snapshot,
      rings: [
        { unit: "main", generation: 2, x: 0, y: 0, radius: 400, cluster: false },
        { unit: "main", generation: 3, x: 0, y: 0, radius: 600, cluster: false },
        ...[2, 3].map((generation) => ({
          unit: "cluster:m",
          generation,
          x: 1500,
          y: 0,
          radius: 210 * (generation - 1),
          cluster: true,
          span: { from: 0.5, to: 1.5 },
        })),
      ].map((ring) => ({
        ...ring,
        label: ring.cluster
          ? ring.generation === 2
            ? "Pak & Mak"
            : null
          : `Generation ${ring.generation}`,
      })),
    },
    { photos: new Map(), fontFace: "", measure },
  );

  it("are the rings' own: each generation once, and the family's name", () => {
    expect(svg.match(/>Generation 2<\/text>/g)).toHaveLength(1);
    expect(svg.match(/>Generation 3<\/text>/g)).toHaveLength(1);
    expect(svg).toContain(">Pak &amp; Mak</text>");
  });
});
