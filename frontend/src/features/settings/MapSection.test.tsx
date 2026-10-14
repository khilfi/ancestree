// @vitest-environment jsdom
/**
 * Settings → Map: the world's pack, then every country, the family's first, with a
 * search; each with its size and how it stands on this computer, and Download, Stop, Try again
 * or Remove as fits; a country split by state with its states beneath, each to fetch alone. The
 * world stays once it's here: the map would only fetch it again. And the online extra,
 * off unless chosen.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapCountry, MapPack, MapPacks } from "@/api/types";
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

const pack = (key: string, title: string, size: number, more: Partial<MapPack> = {}): MapPack => ({
  key,
  title,
  country: key === "world" ? "" : (key.split("-")[0] ?? key),
  size,
  minzoom: key === "world" ? 0 : 7,
  maxzoom: key === "world" ? 6 : key === "de" ? 13 : 14,
  first: key === "world",
  installed: false,
  fetching: false,
  done: 0,
  error: null,
  ...more,
});

const country = (key: string, title: string, packs: string[] = [key]): MapCountry => ({
  key,
  title,
  continent: "Asia",
  packs,
});

const PACKS: MapPacks = {
  build: "20261010",
  packs: [
    pack("world", "The world", 45_058_792, { installed: true }),
    pack("my", "Malaysia", 157_000_000, { installed: true }),
    pack("sg", "Singapore", 12_000_000),
    pack("de", "Germany", 1_300_000_000, { fetching: true, done: 400_000_000 }),
    pack("ax", "Åland", 9_000_000),
    pack("us-ca", "California", 519_000_000, {
      error: "California couldn't be fetched: no internet",
    }),
    pack("us-ny", "New York", 230_000_000),
    pack("us-tx", "Texas", 610_000_000, { installed: true }),
  ],
  countries: [
    country("ax", "Åland"),
    country("de", "Germany"),
    country("my", "Malaysia"),
    country("sg", "Singapore"),
    country("us", "United States", ["us-ca", "us-ny", "us-tx"]),
  ],
  online: false,
  lookup: "ask",
};

let root: Root | undefined;
const asked: string[] = [];

async function show(packs: MapPacks = PACKS) {
  vi.stubGlobal("fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    const body = request.method === "PUT" ? ` ${await request.text()}` : "";
    asked.push(`${request.method} ${path}${body}`);
    const answer = path.endsWith("/family") ? { countries: ["my", "de"] } : packs;
    return Response.json(answer, { headers: { "content-type": "application/json" } });
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
  await until("Where your family lives or was born");
}

/** Each country's row: its own line, without its states'. */
const countries = () =>
  [...document.querySelectorAll("li")].map((row) => {
    const own = row.firstElementChild; // its name and how it stands, then its buttons
    return {
      text: own?.firstElementChild?.textContent ?? "",
      buttons: [...(own?.querySelectorAll("button") ?? [])].map((button) => button.textContent),
    };
  });

/** A country's row, by its name. */
const row = (title: string) =>
  [...document.querySelectorAll("li")].find((each) =>
    each.firstElementChild?.textContent?.startsWith(title),
  );

const button = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll("button")].find((each) => each.textContent === name);

function search(text: string) {
  const box = document.querySelector<HTMLInputElement>('input[type="search"]');
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(box, text);
    box?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Settings → Map", () => {
  afterEach(() => {
    act(() => root?.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    asked.length = 0;
  });

  it("lists the family's countries first, then every other, each as it stands", async () => {
    await show();
    const headings = [...document.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Where your family lives or was born", "Every other country"]);
    const [germany, malaysia, aland, singapore, usa] = countries();
    expect(germany?.text).toBe("Germany1.3 GB · Fetching: 400 MB of 1.3 GB");
    expect(germany?.buttons).toEqual(["Stop"]);
    expect(malaysia).toEqual({ text: "Malaysia157 MB · On this computer", buttons: ["Remove"] });
    expect(aland?.text).toBe("Åland9 MB · Not on this computer");
    expect(singapore?.buttons).toEqual(["Download"]);
    // Split by state: some here, one failed, so it's said, with both ways to go on.
    expect(usa?.text).toBe("United States1.4 GB · California couldn't be fetched: no internet");
    expect(usa?.buttons).toEqual(["Remove", "Try again"]);
    expect(document.body.textContent).toContain("The world45 MB · On this computer");
    expect(document.body.textContent).toContain("as Protomaps cut it on 10/10/2026");
  });

  it("downloads a whole country, and stops one on its way", async () => {
    await show();
    const singapore = row("Singapore");
    await act(async () => singapore && button("Download", singapore)?.click());
    await act(async () => button("Stop")?.click());
    expect(asked).toContain("POST /api/map/countries/sg");
    expect(asked).toContain("DELETE /api/map/countries/de");
  });

  it("lists a split country's states beneath it, each to fetch alone", async () => {
    await show();
    const states = [...document.querySelectorAll("details")].at(-1);
    expect(states?.querySelector("summary")?.textContent).toBe(
      "Or one of its 3 states or provinces",
    );
    expect(states?.textContent).toContain("Texas610 MB · On this computer");
    const newYork = [...(states?.querySelectorAll(".font-medium") ?? [])].find(
      (title) => title.textContent === "New York",
    )?.parentElement?.parentElement;
    await act(async () => newYork && button("Download", newYork)?.click());
    expect(asked).toContain("POST /api/map/packs/us-ny");
  });

  it("finds a country by its name, or by one of its states', accents aside", async () => {
    await show();
    search("aland");
    expect(countries().map((row) => row.text.split(/\d/)[0])).toEqual(["Åland"]);
    search("tex");
    expect(countries().map((row) => row.text.split(/\d/)[0])).toEqual(["United States"]);
    const states = document.querySelector("details");
    expect(states?.open).toBe(true);
    expect(states?.textContent).toContain("Texas");
    expect(states?.textContent).not.toContain("California");
    search("narnia");
    expect(document.body.textContent).toContain("No country or state is called that.");
  });

  it("counts each country's places in, and the world's towns and postcodes", async () => {
    const places = (country: string, size: number, installed: boolean) => ({
      country,
      size,
      installed,
      fetching: false,
      done: 0,
      error: null,
    });
    await show({
      ...PACKS,
      places: [
        places("world", 21_900_000, true),
        places("my", 400_000, false), // Malaysia's pack came before its places did
        places("sg", 700_000, false),
      ],
    });
    expect(document.body.textContent).toContain("The world67 MB · On this computer");
    const malaysia = row("Malaysia");
    expect(malaysia?.textContent).toContain("157 MB · On this computer, without its places");
    expect(malaysia && button("Download", malaysia)).toBeDefined();
    expect(row("Singapore")?.textContent).toContain("13 MB · Not on this computer");
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
    expect(asked.every((each) => each.startsWith("GET "))).toBe(true); // nothing chosen yet
    await act(async () => online?.click());
    expect(asked).toContain('PUT /api/map/online {"on":true}');
  });

  it("asks before each online lookup until chosen otherwise, saying what goes", async () => {
    await show();
    const ask = document.querySelector<HTMLButtonElement>("#map-lookup-ask");
    expect(ask?.getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain(
      "It sends the address as typed, with its country, and Photon sees this computer's internet address",
    );
    const never = document.querySelector<HTMLButtonElement>("#map-lookup-never");
    await act(async () => never?.click());
    expect(asked).toContain('PUT /api/map/lookup {"lookup":"never"}');
  });

  it("says how many addresses its places placed more exactly as they came", async () => {
    await show({ ...PACKS, placed: { my: 34 } });
    expect(document.body.textContent).toContain(
      "34 addresses in Malaysia placed on the map more exactly, as its places came. Undo takes them back.",
    );
  });
});
