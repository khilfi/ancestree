// @vitest-environment jsdom
/**
 * The family leaf in the top bar: the app's icon as it's drawn for small sizes,
 * path for path, so the two never drift apart; beside the name, in the app and in a view-only
 * copy, and there still where a narrow window hides the name.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { type CopyAbout, CopyProvider } from "./copy";
import { LeafMark } from "./LeafMark";

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

const paths = (svg: string) => [...svg.matchAll(/\bd="([^"]+)"/g)].map(([, d]) => d);

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

/** The top bar, as the app draws it, the engine answering nothing. */
async function topBar(copy: CopyAbout | null): Promise<HTMLElement> {
  vi.stubGlobal("fetch", async () => Response.json({ detail: "not here" }, { status: 404 }));
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
  const header = document.querySelector("header");
  if (!header) throw new Error("no top bar");
  return header;
}

describe("the family leaf in the top bar", () => {
  it("is the app's icon as it's drawn small, path for path", () => {
    // The tests run in frontend/; the drawing is the desktop app's.
    const drawing = readFileSync(join(process.cwd(), "../desktop/icon-small.svg"), "utf-8");
    const mark = renderToStaticMarkup(<LeafMark />);
    expect(paths(mark)).toEqual(paths(drawing));
    expect(mark).toContain('fill="#059669"');
    expect(mark).toContain('aria-hidden="true"');
  });

  it("stands before the name, in the app and in a copy", async () => {
    for (const copy of [null, COPY]) {
      const header = await topBar(copy);
      const leaf = header.querySelector('svg[viewBox="290 168 466 688"]');
      const name = [...header.querySelectorAll("span")].find(
        (span) => span.textContent === "AncesTree",
      );
      expect(leaf).not.toBeNull();
      expect(name).toBeDefined();
      // The leaf comes first in the bar.
      expect(leaf?.compareDocumentPosition(name as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      // The name gives way where the bar is short; the leaf stays.
      expect(leaf?.getAttribute("class")).toContain("shrink-0");
      expect(leaf?.getAttribute("class")).not.toMatch(/hidden|sr-only/);
      act(() => root?.unmount());
      document.body.replaceChildren();
    }
  });
});
