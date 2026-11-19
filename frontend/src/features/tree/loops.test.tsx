// @vitest-environment jsdom
/**
 * A loop of parents stored before 0.8.7: Ismail is Hassan's parent, Hassan
 * is Ali's, and Ali is Ismail's. The engine seats the family without the loop's newest link
 * and lists the loop; here, every way the tree is laid out, folded and filtered, and the
 * finder, stop at it; What's missing lists it, with the link to take out; and a link refused
 * on its way back from the Trash is said. The family is the fictional one; its layout is as the
 * engine seats it (services/graph.py, build_graph).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Graph, GraphLink, GraphPerson, RestoreResult } from "@/api/types";
import { MissingSection } from "@/features/settings/MissingSection";
import { standings } from "@/features/timeline/lanes";
import { golden } from "@/kinship/golden";
import { KinshipTwin } from "@/kinship/twin";
import { showRestored } from "@/lib/notify";
import { until } from "@/viewer/looking";
import { applyFilter, NO_FILTER, type Scope } from "./filters";
import { familyTreeLayout, fanLayout, hourglassLayout } from "./layouts";
import { allFamilies, ringLayout, WAYS } from "./placing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {};
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

const [TOK, HASSAN, ALI, MARIAM, ROKIAH] = [1, 2, 3, 4, 5].map(
  (n) => `00000000-0000-4000-8000-00000000000${n}`,
) as [string, string, string, string, string];
const LOOP = "01a1f3e0-0000-7000-8000-000000000006"; // Ali as Ismail's father: the newest

function person(id: string, full_name: string, gender: "male" | "female", year: number) {
  return {
    id,
    full_name,
    nickname: null,
    gender,
    birth_year: year,
    death_year: null,
    birth_order: null,
    placeholder: false,
    photo_version: null,
    born: { year, month: null, day: null, qualifier: "exact", year_to: null, original_text: null },
    died: null,
    is_living: true,
    has_story: false,
  } as GraphPerson;
}

function link(n: number, type: "parent" | "spouse", source: string, target: string): GraphLink {
  const parent = type === "parent";
  return {
    id: `01a1f3e0-0000-7000-8000-00000000000${n}`,
    type,
    source,
    target,
    kind: parent ? "biological" : null,
    status: parent ? null : "married",
    in_layout: true,
  };
}

const seat = (unit: string, generation: number, parent: string | null, more = {}) => ({
  unit,
  generation,
  parent,
  order: 0,
  partner_of: null,
  branch: null,
  ...more,
});

const MARIAMS = `cluster:${MARIAM}`;
const graph: Graph = {
  people: [
    person(TOK, "Ismail bin Ahmad", "male", 1920),
    person(HASSAN, "Hassan bin Ismail", "male", 1945),
    person(ALI, "Ali bin Hassan", "male", 1970),
    person(MARIAM, "Mariam binti Daud", "female", 1948),
    person(ROKIAH, "Rokiah binti Salleh", "female", 1925),
  ],
  links: [
    link(1, "parent", TOK, HASSAN),
    link(2, "parent", HASSAN, ALI),
    link(3, "parent", MARIAM, ALI),
    link(4, "spouse", HASSAN, MARIAM),
    link(5, "parent", ROKIAH, MARIAM),
    link(6, "parent", ALI, TOK),
  ],
  layout: {
    units: [
      { id: "main:0", centre: [TOK], anchor: null, anchor_seat: null, size: 4 },
      {
        id: MARIAMS,
        centre: [ROKIAH],
        anchor: MARIAM,
        anchor_seat: seat(MARIAMS, 2, ROKIAH, { branch: MARIAM }),
        size: 1,
      },
    ],
    seats: {
      [TOK]: seat("main:0", 1, null),
      [HASSAN]: seat("main:0", 2, TOK, { branch: HASSAN }),
      [ALI]: seat("main:0", 3, HASSAN, { branch: HASSAN }),
      [MARIAM]: seat("main:0", 2, null, { partner_of: HASSAN, branch: HASSAN }),
      [ROKIAH]: seat(MARIAMS, 1, null),
    },
    unlinked: [],
    centre_chosen: false,
    loops: [{ link: LOOP, people: [TOK, HASSAN, ALI] }],
  },
};

describe("a stored loop of parents, stopped at", () => {
  it("lays the tree out every way, each family folded or open", () => {
    const families = allFamilies(graph);
    for (const { way } of WAYS) {
      for (const open of [new Set<string>(), families]) {
        const layout = ringLayout(graph, open, way);
        expect(layout.points.has(ALI)).toBe(true);
      }
    }
    expect(familyTreeLayout(graph, families, null).points.size).toBeGreaterThan(0);
    for (const focus of [TOK, ALI]) {
      expect(hourglassLayout(graph, focus, 6, null).points.has(focus)).toBe(true);
      expect(fanLayout(graph, focus, 6, null).points.has(focus)).toBe(true);
    }
    expect(standings(graph).of.get(ALI)?.generation).toBe(3);
  });

  it("filters around anyone in it", () => {
    const scopes: Scope[] = ["line", "ancestors", "descendants", "blood", "within"];
    for (const scope of scopes) {
      const kept = applyFilter(graph, { ...NO_FILTER, around: ALI, scope, links: 9 });
      expect(kept?.has(ALI)).toBe(true);
    }
  });

  it("finds how they're related, as a copy does", () => {
    const seed = golden("seed");
    const twin = new KinshipTwin(graph.people, graph.links, seed.kinds, seed.kinship);
    expect(twin.answer(ALI, TOK).relations.length).toBeGreaterThan(0);
    expect(twin.answer(TOK, ROKIAH)).toBeTruthy();
  });
});

let root: Root | undefined;
let asked: { method: string; path: string }[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  asked = [];
});

function render(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/", element }]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
}

describe("What's missing: A loop of parents", () => {
  it("lists the loop, and takes out its newest link in one click", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input as Request;
      const path = new URL(request.url).pathname;
      asked.push({ method: request.method, path });
      if (path === "/api/graph") return Response.json(graph);
      if (path === "/api/map") return Response.json({ people: [], pins: [], towns: [] });
      if (path === "/api/family/facts")
        return Response.json({ to_fill_in: { no_birth_order: [] } });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("{}", { status: 404 });
    });
    render(<MissingSection />);
    await until("A loop of parents");
    expect(document.body.textContent).toContain(
      "Ismail bin Ahmad is Hassan bin Ismail's parent, Hassan bin Ismail is Ali bin Hassan's, " +
        "and Ali bin Hassan is Ismail bin Ahmad's.",
    );
    const take = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Take out Ali bin Hassan as Ismail bin Ahmad's parent",
    );
    act(() => take?.click());
    await vi.waitFor(() =>
      expect(asked).toContainEqual({ method: "DELETE", path: `/api/relationships/${LOOP}` }),
    );
  });

  it("isn't there when no one is their own ancestor", async () => {
    const fine = { ...graph, layout: { ...graph.layout, loops: [] } };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const path = new URL((input as Request).url).pathname;
      if (path === "/api/graph") return Response.json(fine);
      if (path === "/api/family/facts")
        return Response.json({ to_fill_in: { no_birth_order: [] } });
      return new Response("{}", { status: 404 });
    });
    render(<MissingSection />);
    await until("Gender not recorded");
    expect(document.body.textContent).not.toContain("A loop of parents");
    expect(document.body.textContent).not.toContain("three birth parents");
  });
});

describe("What's missing: A child with three birth parents", () => {
  it("lists them, and takes out the newest birth parent's link in one click", async () => {
    const THIRD = "01a1f3e0-0000-7000-8000-000000000007"; // Rokiah, as Ali's mother too
    const three = {
      ...graph,
      links: [...graph.links, link(7, "parent", ROKIAH, ALI)],
      layout: {
        ...graph.layout,
        loops: [],
        three_birth_parents: [{ child: ALI, parents: [HASSAN, MARIAM, ROKIAH], link: THIRD }],
      },
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input as Request;
      const path = new URL(request.url).pathname;
      asked.push({ method: request.method, path });
      if (path === "/api/graph") return Response.json(three);
      if (path === "/api/family/facts")
        return Response.json({ to_fill_in: { no_birth_order: [] } });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("{}", { status: 404 });
    });
    render(<MissingSection />);
    await until("A child with three birth parents");
    expect(document.body.textContent).toContain(
      "Ali bin Hassan has three birth parents: Hassan bin Ismail, Mariam binti Daud and " +
        "Rokiah binti Salleh.",
    );
    const take = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent === "Take out Rokiah binti Salleh as Ali bin Hassan's birth parent",
    );
    act(() => take?.click());
    await vi.waitFor(() =>
      expect(asked).toContainEqual({ method: "DELETE", path: `/api/relationships/${THIRD}` }),
    );
  });
});

describe("back from the Trash", () => {
  it("says each link the rules refused", () => {
    const warned = vi.spyOn(toast, "warning").mockImplementation(() => "");
    vi.spyOn(toast, "success").mockImplementation(() => "");
    const said =
      "Hassan bin Ismail's link to Ali bin Hassan can't come back: Ali bin Hassan is already " +
      "an ancestor of Hassan bin Ismail. This would make Ali bin Hassan their own ancestor.";
    const result = {
      person: { id: HASSAN, full_name: "Hassan bin Ismail" },
      restored_links: 1,
      skipped_links: 0,
      left_out: [said],
    } as unknown as RestoreResult;
    showRestored(result);
    expect(warned).toHaveBeenCalledWith(said, expect.anything());
  });
});
