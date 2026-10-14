// @vitest-environment jsdom
/**
 * Same person as…, merging, with the engine's answers made up here: two records of Ali made one,
 * from the warning on adding the second, whose panel was open. Names are made up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MergePreview, PersonDetail } from "@/api/types";
import { until } from "@/viewer/looking";
import { MergeDialog } from "./MergeDialog";

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

const KEPT = "ali-first";
const TWICE = "ali-again";
const ali = { id: KEPT, full_name: "Ali bin Hassan" } as PersonDetail;
const preview: MergePreview = {
  keep: KEPT,
  keep_name: "Ali bin Hassan",
  other: TWICE,
  other_name: "Ali bin Hassan",
  details: [],
  links: [],
  photo: "taken",
  story: "none",
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Same person as…", () => {
  it("opens the one kept when the one made one with them was open", async () => {
    const merged: unknown[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input as Request;
      const path = new URL(request.url).pathname;
      if (path === `/api/persons/${KEPT}/merge/${TWICE}`) return Response.json(preview);
      if (path === `/api/persons/${KEPT}/merge` && request.method === "POST") {
        merged.push(await request.clone().json());
        return Response.json({ person: ali, notices: [] });
      }
      return new Response("{}", { status: 404 });
    });
    const router = createMemoryRouter(
      [
        {
          path: "/tree",
          element: <MergeDialog person={ali} other={TWICE} open onOpenChange={() => {}} />,
        },
      ],
      { initialEntries: [`/tree?layout=fan&person=${TWICE}`] },
    );
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
    await until("Ali bin Hassan takes their photo.");

    const make = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Make them one person",
    );
    act(() => make?.click());
    for (let tries = 0; tries < 100 && router.state.location.search.includes(TWICE); tries++) {
      await act(async () => {
        await new Promise((done) => setTimeout(done, 10));
      });
    }

    expect(merged).toEqual([{ other: TWICE }]);
    expect(router.state.location.search).toBe(`?layout=fan&person=${KEPT}`);
  });
});
