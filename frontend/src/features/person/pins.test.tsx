// @vitest-environment jsdom
/**
 * People pinned where they live, by themselves, in the person form, with the
 * engine's answers made up here: where it is, marked; coordinates typed or pasted; a pin put
 * first filling the address in; moving house from a pin put by hand; the small map where it
 * can't be drawn; and an address looked up online only as this computer allows, saying first
 * what goes. Names and addresses are made up; the places are real.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Exactness,
  Located,
  Lookup,
  MapPacks,
  PersonDetail,
  PlaceSuggestion,
} from "@/api/types";
import { placedWords } from "@/features/settings/ImportSection";
import { aboutThere } from "@/features/settings/MissingSection";
import { until } from "@/viewer/looking";
import { PersonForm } from "./PersonForm";

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

const kajang: PlaceSuggestion = {
  town: "Kajang",
  district: "Hulu Langat",
  state: "Selangor",
  postcode: "43000",
  country: "Malaysia",
  lat: 2.993,
  lon: 101.788,
  exact: "hand",
  address: "",
};
const house: PlaceSuggestion = {
  ...kajang,
  address: "3 Jalan Sultan",
  town: "Kota Bharu",
  district: "Kota Bharu",
  state: "Kelantan",
  postcode: "15050",
  lat: 6.1301,
  lon: 102.2402,
  exact: "spot",
};
const packs = (lookup: Lookup, world = false): MapPacks => ({
  build: "20261007",
  packs: [
    {
      key: "world",
      title: "The world",
      country: "",
      size: 70_000_000,
      minzoom: 0,
      maxzoom: 6,
      first: true,
      installed: world,
      fetching: false,
      done: 0,
    },
  ],
  countries: [],
  places: [],
  online: false,
  lookup,
});
const aina = {
  id: "aina",
  full_name: "Aina binti Hassan",
  gender: "female",
  residence: null,
  birth_place: null,
  death_place: null,
  living: null,
  is_living: true,
  parents: [],
  residence_at_parents: null,
  parents_apart: false,
  lives_with: null,
} as unknown as PersonDetail;
const byHand = {
  ...aina,
  residence: {
    address: "No. 12, Jalan Melati 3",
    town: "Kajang",
    state: "Selangor",
    country: "Malaysia",
    lat: 3.0006,
    lon: 101.7869,
    exact: "hand",
  },
} as unknown as PersonDetail;

let root: Root | undefined;
let asked: { method: string; path: string; body: unknown; query: string }[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  asked = [];
});

function answer({ lookup = "ask" as Lookup, here = [] as PlaceSuggestion[] } = {}) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    const url = new URL(request.url);
    const body = ["POST", "PUT", "PATCH"].includes(request.method)
      ? await request
          .clone()
          .json()
          .catch(() => null)
      : null;
    asked.push({ method: request.method, path: url.pathname, body, query: url.search });
    const found = (suggestions: PlaceSuggestion[]) =>
      Response.json({ country: "my", downloaded: true, suggestions });
    if (url.pathname === "/api/places/suggest") return found(here);
    if (url.pathname === "/api/places/lookup") return found([house]);
    if (url.pathname === "/api/places/near") return Response.json(kajang);
    if (url.pathname === "/api/map/packs") return Response.json(packs(lookup));
    if (url.pathname.startsWith("/api/persons/"))
      return Response.json({ person: aina, notices: [] });
    return new Response("{}", { status: 404 });
  });
}

function show(person: PersonDetail) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // A web view that draws WebGL 2: the small map would be drawn, once the world's map is here.
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  const element = <PersonForm person={person} onSaved={() => {}} onCancel={() => {}} />;
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

function field(label: string): HTMLTextAreaElement {
  const found = document.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`No field ${label}`);
  return found;
}

function type(element: HTMLTextAreaElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      element,
      text,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function enter(element: HTMLTextAreaElement) {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((each) => each.textContent?.trim() === name);

async function saved() {
  for (let tries = 0; tries < 100; tries++) {
    const sent = asked.find((each) => each.path === `/api/persons/${aina.id}` && each.body);
    if (sent) return sent.body as { residence: Record<string, unknown> };
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
  throw new Error("never saved");
}

describe("where a place is", () => {
  it("is put there by coordinates pasted, marked as by hand, and fills the address in", async () => {
    answer();
    show(aina);
    const where = field("Lives in: where it is");
    type(where, "https://www.google.com/maps/@2.993,101.788,17z");
    enter(where); // read there, not saved
    await until("Exact (placed by hand)");
    expect(document.body.textContent).toContain("2.9930, 101.7880");
    await until("Filled in from the nearest place known: Kajang");
    expect(field("Lives in: town").value).toBe("Kajang");
    expect(field("Lives in: district").value).toBe("Hulu Langat");
    expect(asked.some((each) => each.path === "/api/persons/aina")).toBe(false);
    act(() => button("Save")?.click());
    const { residence } = await saved();
    expect(residence).toMatchObject({ lat: 2.993, lon: 101.788, exact: "hand", town: "Kajang" });
  });

  it("says why it can't read what was pasted", () => {
    answer();
    show(aina);
    const where = field("Lives in: where it is");
    type(where, "https://maps.app.goo.gl/AbCdEf123");
    enter(where);
    expect(document.body.textContent).toContain("A short link only says where once it's opened");
  });

  it("asks, moving house, whether a pin put by hand stays", async () => {
    answer();
    show(byHand);
    type(field("Lives in: town"), "Semenyih");
    await until("Its pin was put on the map by hand.");
    act(() => button("Keep it there")?.click());
    expect(document.body.textContent).toContain("3.0006, 101.7869");
    type(field("Lives in: postcode"), "43500");
    await until("Its pin was put on the map by hand.");
    act(() => button("Place it from the address")?.click());
    expect(document.body.textContent).not.toContain("3.0006, 101.7869");
    expect(document.body.textContent).not.toContain("Its pin was put on the map by hand.");
  });

  it("says what would help where the small map can't be drawn", async () => {
    answer();
    show(byHand);
    await until("Show on the map");
    act(() => button("Show on the map")?.click());
    await until("The small map needs the world's map, downloaded once.");
    expect(button("Download the world's map")).toBeDefined();
  });
});

describe("an address looked up online, once", () => {
  it("says first what goes and to whom, and asks", async () => {
    answer();
    show(aina);
    type(field("Lives in: address"), "No. 3, Jalan Sultan");
    await until("Not found without the internet.");
    act(() => button("Look it up online once")?.click());
    await until("Look this address up online?");
    expect(document.body.textContent).toContain(
      "AncesTree will send “No. 3, Jalan Sultan, Malaysia” to Photon",
    );
    expect(asked.some((each) => each.path === "/api/places/lookup")).toBe(false);
    await act(async () => button("Look it up")?.click());
    await until("3 Jalan Sultan · Kota Bharu · Kelantan · 15050 · Malaysia");
    expect(asked).toContainEqual(
      expect.objectContaining({
        path: "/api/places/lookup",
        body: { line: "No. 3, Jalan Sultan", country: "Malaysia" },
      }),
    );
    act(() => button("3 Jalan Sultan · Kota Bharu · Kelantan · 15050 · Malaysia")?.click());
    expect(document.body.textContent).toContain("On the mapExact6.1301, 102.2402");
    expect(field("Lives in: address").value).toBe("No. 3, Jalan Sultan"); // as typed
    // Where it went is shown, to check: here, what would let the small map be drawn.
    await until("The small map needs the world's map, downloaded once.");
  });

  it("says Malaysia goes too where no country is written, as it does (0.8.0)", async () => {
    answer();
    show(aina);
    type(field("Lives in: country"), "");
    type(field("Lives in: address"), "No. 3, Jalan Sultan");
    await until("Not found without the internet.");
    act(() => button("Look it up online once")?.click());
    await until("Look this address up online?");
    expect(document.body.textContent).toContain(
      "AncesTree will send “No. 3, Jalan Sultan, Malaysia” to Photon",
    );
    await act(async () => button("Look it up")?.click());
    expect(asked).toContainEqual(
      expect.objectContaining({
        path: "/api/places/lookup",
        body: { line: "No. 3, Jalan Sultan", country: "Malaysia" },
      }),
    );
  });

  it("goes without asking where chosen so", async () => {
    answer({ lookup: "always" });
    show(aina);
    type(field("Lives in: address"), "No. 3, Jalan Sultan");
    await until("Look it up online once");
    await choiceHeard(); // until then, it asks, to be safe
    await act(async () => button("Look it up online once")?.click());
    await until("3 Jalan Sultan · Kota Bharu");
    expect(document.body.textContent).not.toContain("Look this address up online?");
  });

  it("isn't offered where this computer looks nothing up online", async () => {
    answer({ lookup: "never" });
    show(aina);
    type(field("Lives in: address"), "No. 3, Jalan Sultan");
    await choiceHeard();
    await until("On the map"); // the form is there, and the suggestions asked for
    await act(async () => {
      await new Promise((done) => setTimeout(done, 400));
    });
    expect(asked.some((each) => each.path === "/api/places/suggest")).toBe(true);
    expect(document.body.textContent).not.toContain("Look it up online once");
  });
});

/** This computer's choice of looking up online, heard from the engine, and shown. */
async function choiceHeard() {
  for (let tries = 0; tries < 50; tries++) {
    if (asked.some((each) => each.path === "/api/map/packs")) break;
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
}

describe("many at once", () => {
  const located = (exact: Exactness | null, place: Record<string, string>) =>
    ({ place: { country: "Malaysia", ...place }, exact, country: "Malaysia" }) as Located;

  it("lists those with an address only about there, never by hand or at their parents'", () => {
    const people = [
      { id: "a", lives: located(null, { town: "Kajang", address: "No. 12" }) },
      { id: "b", lives: located("postcode", { town: "Kajang", postcode: "43000" }) },
      { id: "c", lives: located("hand", { town: "Kajang", address: "No. 12" }) },
      { id: "d", lives: located(null, { town: "Kajang" }) }, // only a town: nothing finer to find
      { id: "e", lives: located(null, { address: "No. 7" }), at_parents: "mother" as const },
      { id: "f", lives: null },
    ];
    expect(aboutThere(people).map((each) => each.id)).toEqual(["a", "b"]);
  });

  it("says where an import put people from their addresses", () => {
    expect(placedWords({ postcode: 2, town: 30, not_found: 3 })).toBe(
      "2 at their postcode's area, 30 at their town and 3 not found, for you to place",
    );
    expect(placedWords({ postcode: 0, town: 1, not_found: 0 })).toBe("1 at their town");
  });
});
