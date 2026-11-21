// @vitest-environment jsdom
/**
 * Family facts, one name: never "Family at a glance"; and What's missing, no longer
 * Settings', its second tab, reached from its facts' **Fill them in…** too. Not in a view-only
 * copy, which has the facts alone. The engine's answers are made up here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CopyAbout, CopyProvider } from "@/app/copy";
import type { FactsTab } from "@/lib/familyFacts";
import { until } from "@/viewer/looking";
import { FamilyFactsPanel } from "./FamilyFactsPanel";

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

const COPY: CopyAbout = {
  title: "Keluarga Contoh",
  made_at: "2026-11-19T09:00:00+08:00",
  people: 1,
  hidden_living: false,
  archive: false,
  family: "",
  version: "0.9.0",
  centres: [],
};

const ALI = { id: "ali", full_name: "Ali bin Rosli", gender: "unknown", placeholder: false };
const FACTS = {
  counts: { people: 1, links: 0, couples: 0, unknown_parents: 0, families: 1, unlinked: 1 },
  generations: [],
  names: [],
  birthplaces: [],
  decades: [],
  cousins_married: [],
  this_month: [],
  month: "November",
  to_fill_in: {
    no_gender: [{ id: "ali", name: "Ali bin Rosli" }],
    no_birth_year: [],
    no_birth_order: [],
  },
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function Panel({ first }: { first: FactsTab }) {
  const [tab, setTab] = useState<FactsTab>(first);
  return <FamilyFactsPanel tab={tab} onTab={setTab} onClose={() => {}} />;
}

async function show(first: FactsTab, copy: CopyAbout | null = null) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL((input as Request).url).pathname;
    if (path === "/api/family/facts") return Response.json(FACTS);
    if (path === "/api/graph") {
      return Response.json({ people: [ALI], links: [], layout: { unlinked: ["ali"] } });
    }
    if (path === "/api/map") return Response.json({ people: [], pins: [], towns: [] });
    return Response.json({ detail: "not here" }, { status: 404 });
  });
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <CopyProvider value={copy}>
          <Panel first={first} />
        </CopyProvider>
      ),
    },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
}

const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
const button = (words: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent?.trim() === words,
  );

describe("Family facts, and What's missing beside it", () => {
  it("is named Family facts, with its facts and What's missing as its tabs", async () => {
    await show("facts");
    const panel = document.querySelector("aside");
    expect(panel?.getAttribute("aria-label")).toBe("Family facts");
    expect(panel?.querySelector("h2")?.textContent).toBe("Family facts");
    expect(document.body.textContent).not.toContain("at a glance");
    expect(tabs()).toEqual(["Facts", "What's missing"]);
    await until("1 without a gender");
  });

  it("opens What's missing from Fill them in…, as its second tab", async () => {
    await show("facts");
    await until("Fill them in…");
    act(() => button("Fill them in…")?.click());
    await until("Gender not recorded");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "What's missing",
    );
    expect(button("Man")).toBeDefined(); // its quick fix, as in Settings before
  });

  it("opens at What's missing, as its old addresses ask", async () => {
    await show("missing");
    await until("Not linked to anyone");
  });

  it("has its facts alone in a view-only copy", async () => {
    await show("missing", COPY);
    await until("when this copy was made");
    expect(tabs()).toEqual([]);
    expect(document.body.textContent).not.toContain("What's missing");
    expect(document.body.textContent).not.toContain("Fill them in…");
  });
});
