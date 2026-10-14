// @vitest-environment jsdom
/**
 * The family folder's word at the top of a relative's app: what of its own waits for
 * the keeper, with Send now; on a viewer's computer, its words about people alone. And a
 * new install's welcome, with Look around first, the example family. The family and
 * computers are made up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { until } from "@/viewer/looking";
import { FamilyFolderBar } from "./FamilyFolderBar";

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

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

let asked: string[] = [];

// The desktop app's engine, for a new install: its update state, and its families (0.4.0).
const FIRST = { id: "aaaaaaaaaaaaaaaa", name: "My family", open: true, role: "", in_step: null };
const EXAMPLE = { ...FIRST, id: "dddddddddddddddd", name: "Keluarga Contoh", open: false };

function show(status: object, desktop = false) {
  asked = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
      .pathname;
    asked.push(`${init?.method ?? (input instanceof Request ? input.method : "GET")} ${path}`);
    if (path === "/api/family-folder") return Response.json(status);
    if (path === "/api/graph") return Response.json({ people: [], links: [] });
    if (desktop && path === "/api/desktop/update") return Response.json({ version: "0.8.0" });
    if (desktop && path === "/api/desktop/families/example") {
      return Response.json({
        open: FIRST.id,
        families: [FIRST, { ...EXAMPLE, example: true }],
        removed: [],
        added: EXAMPLE.id,
      });
    }
    if (desktop && path.endsWith("/open")) {
      return Response.json({ open: FIRST.id, families: [FIRST], removed: [] });
    }
    return new Response("{}", { status: 404 });
  });
  const router = createMemoryRouter([{ path: "/", element: <FamilyFolderBar /> }]);
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

const sendNow = () =>
  [...document.querySelectorAll("button")].some((each) => each.textContent === "Send now");

describe("a relative's word at the top", () => {
  it("on a viewer's computer, says its words go to the keeper, and sends them now", async () => {
    show({ setup: "member", role: "viewer", family: "Keluarga Contoh", pending: 1 });
    await until("Your words about 1 person wait for them.");
    expect(sendNow()).toBe(true);
  });

  it("on a viewer's computer with nothing waiting, says only words can be added there", async () => {
    show({ setup: "member", role: "viewer", family: "Keluarga Contoh", pending: 0 });
    await until("Only your words about people can be added here: they go to the keeper first.");
    expect(sendNow()).toBe(false);
  });

  it("on a contributor's, says its changes wait, as before", async () => {
    show({ setup: "member", role: "contributor", family: "Keluarga Contoh", pending: 2 });
    await until("Your changes to 2 people and links wait for them.");
    expect(sendNow()).toBe(true);
  });

  it("on a new install, offers to look around the example family first", async () => {
    show({}, true);
    await until("Look around first");
    const look = [...document.querySelectorAll("button")].find(
      (each) => each.textContent === "Look around first",
    );
    await act(async () => look?.click());
    await until("Opening Keluarga Contoh…");
    expect(asked).toContain("POST /api/desktop/families/example");
    expect(asked).toContain(`POST /api/desktop/families/${EXAMPLE.id}/open`);
  });
});
