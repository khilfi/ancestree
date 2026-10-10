// @vitest-environment jsdom
/**
 * Settings → Map: each of the map's packs, its size and how it stands on this computer,
 * with Fetch, Stop, Try again or Remove as fits. The world stays once it's here: the map would
 * only fetch it again. And the online extra, off unless chosen.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapPack, MapPacks } from "@/api/types";
import { until } from "@/viewer/looking";
import { MapSection } from "./MapSection";

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

const pack = (key: MapPack["key"], title: string, size: number, more: Partial<MapPack>) => ({
  key,
  title,
  size,
  minzoom: key === "world" ? 0 : 7,
  maxzoom: key === "malaysia" ? 14 : key === "world" ? 6 : 13,
  first: key === "world",
  installed: false,
  fetching: false,
  done: 0,
  error: null,
  ...more,
});

const PACKS: MapPacks = {
  build: "20261010",
  packs: [
    pack("world", "The world", 45_058_792, { installed: true }),
    pack("malaysia", "Malaysia, Singapore and Brunei", 168_037_092, {
      error: "Malaysia, Singapore and Brunei couldn't be fetched: no internet",
    }),
    pack("indonesia", "Indonesia", 337_704_723, { fetching: true, done: 120_000_000 }),
  ],
  online: false,
};

let root: Root | undefined;
const asked: string[] = [];

async function show() {
  vi.stubGlobal("fetch", async (request: Request) => {
    const body = request.method === "PUT" ? ` ${await request.text()}` : "";
    asked.push(`${request.method} ${new URL(request.url).pathname}${body}`);
    return Response.json(PACKS, { headers: { "content-type": "application/json" } });
  });
  const router = createMemoryRouter([{ path: "/", element: <MapSection /> }]);
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
  await until("On this computer"); // the list, not the words above it
}

const rows = () =>
  [...document.querySelectorAll("li")].map((row) => ({
    text: row.textContent ?? "",
    buttons: [...row.querySelectorAll("button")].map((button) => button.textContent),
  }));

describe("Settings → Map", () => {
  afterEach(() => {
    act(() => root?.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    asked.length = 0;
  });

  it("says each pack's size and how it stands, with what can be done", async () => {
    await show();
    const [world, malaysia, indonesia] = rows();
    expect(world).toEqual({ text: "The world45 MB · On this computer", buttons: [] });
    expect(malaysia?.text).toContain("168 MB · Malaysia, Singapore and Brunei couldn't be fetched");
    expect(malaysia?.buttons).toEqual(["Try again"]);
    expect(indonesia?.text).toContain("338 MB · Fetching: 120 MB of 338 MB");
    expect(indonesia?.buttons).toEqual(["Stop"]);
    expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      "120000000",
    );
    expect(document.body.textContent).toContain("as Protomaps cut it on 10/10/2026");
  });

  it("fetches a region when asked, and stops one on its way", async () => {
    await show();
    const button = (name: string) =>
      [...document.querySelectorAll("button")].find((each) => each.textContent === name);
    await act(async () => button("Try again")?.click());
    await act(async () => button("Stop")?.click());
    expect(asked).toContain("POST /api/map/packs/malaysia");
    expect(asked).toContain("DELETE /api/map/packs/indonesia");
  });

  it("has online detail off until chosen, and says what it tells OpenFreeMap", async () => {
    await show();
    const online = document.querySelector<HTMLButtonElement>("#map-online");
    expect(online?.getAttribute("role")).toBe("switch");
    expect(online?.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector('label[for="map-online"]')?.textContent).toBe(
      "Online detail where the packs end",
    );
    expect(document.body.textContent).toContain(
      "it learns which parts of the world you look at, from this computer's internet address",
    );
    expect(asked.every((each) => each === "GET /api/map/packs")).toBe(true); // nothing chosen yet
    await act(async () => online?.click());
    expect(asked).toContain('PUT /api/map/online {"on":true}');
  });
});
