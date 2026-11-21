// @vitest-environment jsdom
/**
 * How married-in families are placed, chosen under **Married-in families** in the tree's Layout
 * menu: three ways since your word of 21 Nov 2026, **Fans**, **Discs** and
 * **Tucked in**, in that order, each with its hint; Settled fans stays retired. The
 * way chosen is saved as this computer's, through the engine's tree settings, whose answers are
 * made up here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Graph, TreeSettings } from "@/api/types";
import { until } from "@/viewer/looking";
import { NO_FILTER, type TreeView } from "./filters";
import { TreeToolbar } from "./TreeToolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// As in a browser, "/api/…" is read against the page. (Before the app's API client is made.)
vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {}; // jsdom's signals aren't Node's
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

// A toolbar 1,600 pixels across, so every tool is in its line: jsdom lays nothing out.
const kept = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1600,
  });
});
afterAll(() => {
  if (kept) Object.defineProperty(HTMLElement.prototype, "clientWidth", kept);
});

/** No one yet: the toolbar's own tools are all this needs. */
const GRAPH: Graph = {
  people: [],
  links: [],
  layout: { units: [], seats: {}, unlinked: [], centre_chosen: false },
};
const RINGS: TreeView = { layout: "rings", depth: null, filter: NO_FILTER, from: null };

let root: Root | undefined;
let settings: TreeSettings = { centre: null, colours: "branch", married_in: "fans" };
const saved: TreeSettings[] = [];

/** The engine's tree settings, as this computer has them, and each saved in their place. */
function answer() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/api/settings" && request.method === "PUT") {
      settings = (await request.json()) as TreeSettings;
      saved.push(settings);
      return Response.json(settings);
    }
    if (path === "/api/settings") return Response.json(settings);
    return Response.json({ detail: "not here" }, { status: 404 });
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

async function show() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <ReactFlowProvider>
          <TreeToolbar
            graph={GRAPH}
            view={RINGS}
            onView={() => {}}
            focus={null}
            shown={null}
            onRearranged={() => {}}
            families={{ all: 0, folded: 0, big: false }}
            onFoldAll={() => {}}
            onShowFamily={() => {}}
            onHighlight={() => {}}
          />
        </ReactFlowProvider>
      </QueryClientProvider>,
    ),
  );
  for (let tries = 0; tries < 20; tries++) {
    await act(async () => new Promise((done) => setTimeout(done, 10)));
  }
}

const said = (element: Element | null | undefined) => element?.textContent?.trim() ?? "";

/** Opens the Layout menu: the ways under Married-in families, each its name and hint, and
 *  whether it's the one chosen. */
async function ways(): Promise<{ name: string; hint: string; chosen: boolean; item: Element }[]> {
  const trigger = document.querySelector('button[aria-label^="Layout: "]');
  if (!trigger) throw new Error("no Layout menu");
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  await until("Married-in families");
  const group = [...document.querySelectorAll('[role="menu"] [role="group"]')].find(
    (each) => said(each.previousElementSibling) === "Married-in families",
  );
  return [...(group?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((item) => ({
    name: said(item.querySelector(".font-medium")),
    hint: said(item.querySelector(".text-xs")),
    chosen: item.getAttribute("aria-checked") === "true",
    item,
  }));
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  settings = { centre: null, colours: "branch", married_in: "fans" };
  saved.length = 0;
});

describe("the Layout menu's married-in families", () => {
  it("offers Fans, Discs and Tucked in, in that order, Fans the first choice", async () => {
    answer();
    await show();
    const offered = await ways();
    expect(offered.map(({ name, hint }) => [name, hint])).toEqual([
      ["Fans", "Each opens out from the person who married in, the oldest generation nearest"],
      ["Discs", "Each on whole rings of its own, apart from the others"],
      [
        "Tucked in",
        "On their host's own rings, at their generations; unfolding one moves the others",
      ],
    ]);
    expect(offered.filter(({ chosen }) => chosen).map(({ name }) => name)).toEqual(["Fans"]);
    // Settled fans stays retired.
    expect(document.body.textContent).not.toContain("Settled");
  });

  it("saves Discs as this computer's way when it's chosen", async () => {
    answer();
    await show();
    const discs = (await ways()).find(({ name }) => name === "Discs");
    act(() => (discs?.item as HTMLElement | undefined)?.click());
    for (let tries = 0; tries < 20 && saved.length === 0; tries++) {
      await act(async () => new Promise((done) => setTimeout(done, 10)));
    }
    expect(saved).toEqual([{ centre: null, colours: "branch", married_in: "discs" }]);
    // Shown chosen when the menu opens again.
    const again = await ways();
    expect(again.filter(({ chosen }) => chosen).map(({ name }) => name)).toEqual(["Discs"]);
  });

  it("shows Discs chosen where this computer chose it before", async () => {
    answer();
    settings = { centre: null, colours: "branch", married_in: "discs" };
    await show();
    const offered = await ways();
    expect(offered.filter(({ chosen }) => chosen).map(({ name }) => name)).toEqual(["Discs"]);
  });
});
