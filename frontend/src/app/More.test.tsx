// @vitest-environment jsdom
/**
 * The top bar's More: what the bar has no room to name, each with its words; in a
 * view-only copy, only what a copy has. The Dictionary with its own icon. Export's two items in
 * it, the view-only copy's dialog opened from it; and Family facts never in it, but in its one
 * place, the ⓘ beside the family's name, at every width.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { type CopyAbout, CopyProvider } from "./copy";

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
  made_at: "2026-10-18T09:00:00+08:00",
  people: 64,
  hidden_living: false,
  archive: false,
  family: "",
  version: "0.8.5",
  centres: [],
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The top bar, as the app draws it, the engine answering nothing; More opened. */
async function more(copy: CopyAbout | null): Promise<HTMLElement[]> {
  vi.stubGlobal("fetch", async () => Response.json({ detail: "not here" }, { status: 404 }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <CopyProvider value={copy}>
            <AppLayout />
          </CopyProvider>
        ),
        children: [{ path: "tree", element: <div /> }],
      },
    ],
    { initialEntries: ["/tree"] },
  );
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
  const trigger = [...document.querySelectorAll("header button")].find(
    (button) => button.textContent?.trim() === "More",
  );
  if (!trigger) throw new Error("no More");
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menu"] > [role="menuitem"]')];
}

describe("the top bar's More", () => {
  it("holds the rest of the bar, each with its words, Export's two first", async () => {
    const items = await more(null);
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "View-only copy…",
      "Picture of the tree",
      "Dictionary",
      "Guide",
      "Settings",
    ]);
    // The Dictionary's own icon, no longer the life story's book.
    const dictionary = items[2]?.querySelector("svg")?.getAttribute("class") ?? "";
    expect(dictionary).toMatch(/lucide-languages/);
    expect(dictionary).not.toMatch(/lucide-book-open/);
  });

  it("holds only what a view-only copy has", async () => {
    const items = await more(COPY);
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Picture of the tree",
      "Import templateTo add people or correct details in Excel, and send it back",
      "Dictionary",
    ]);
  });

  it("opens the view-only copy's dialog", async () => {
    const items = await more(null);
    await act(async () => items[0]?.click());
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Make a view-only copy");
  });

  it("leaves Family facts to its ⓘ, at every width", async () => {
    const items = await more(null);
    expect(items.map((item) => item.textContent?.trim())).not.toContain("Family facts");
    const facts = document.querySelectorAll('header button[aria-label="Family facts"]');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.getAttribute("class")).not.toMatch(/\bhidden\b/);
    expect(facts[0]?.textContent).toBe(""); // the ⓘ alone, its words its tooltip's
    act(() => (facts[0] as HTMLButtonElement).click());
    expect(document.querySelector('aside[aria-label="Family facts"] h2')?.textContent).toBe(
      "Family facts",
    );
  });
});
