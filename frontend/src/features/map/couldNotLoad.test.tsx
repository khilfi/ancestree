// @vitest-environment jsdom
/**
 * The map and the timeline, when the family can't be read, with `CouldNotLoad`:
 * the reason in words, and **Try again**, which asks again, as the tree has it. Before, they said
 * "Could not load" with nothing to do but start AncesTree again.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelinePage } from "@/features/timeline/TimelinePage";
import { MapPage } from "./MapPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// As in a browser, "/api/…" is read against the page. (Before the app's API client is made.)
vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {};
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

let root: Root | undefined;
let asked: string[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  asked = [];
});

/** The engine, there but failing whatever is asked. */
vi.stubGlobal("fetch", async (input: Request) => {
  asked.push(new URL(input.url).pathname);
  return new Response(JSON.stringify({ detail: "Neo4j isn't answering" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
});

async function show(path: string, element: ReactNode): Promise<HTMLElement> {
  const router = createMemoryRouter([{ path, element }], { initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Could not load"));
  return host;
}

const tryAgain = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again");

describe("Could not load, on the map and the timeline", () => {
  it.each([
    ["the map", "/map", <MapPage key="map" />, "Could not load the map."],
    ["the timeline", "/timeline", <TimelinePage key="timeline" />, "Could not load the family."],
  ])("offers Try again on %s, which asks for the family again", async (_, path, page, said) => {
    const host = await show(path, page);
    expect(host.textContent).toContain(said);
    const button = tryAgain(host);
    expect(button).toBeDefined();
    const before = asked.filter((each) => each === "/api/graph").length;
    await act(async () => button?.click());
    await vi.waitFor(() =>
      expect(asked.filter((each) => each === "/api/graph").length).toBeGreaterThan(before),
    );
  });
});
