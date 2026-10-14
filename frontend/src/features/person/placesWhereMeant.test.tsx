// @vitest-environment jsdom
/**
 * Each place where it's meant, with the engine's answers
 * made up here: where they live first, each place folded to a line, one open at a time; the
 * death part only when it's needed; a place filled in from another in one click; and an address
 * saved where it isn't meant asked about first, and moved home in one click. Names and addresses
 * are made up; the places are real.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPerson, PersonDetail } from "@/api/types";
import { WhereList } from "@/features/map/WhereList";
import { MissingSection } from "@/features/settings/MissingSection";
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

type Place = NonNullable<PersonDetail["residence"]>;
const klang: Place = { town: "Klang", state: "Selangor", country: "Malaysia" } as Place;
const house: Place = {
  ...klang,
  address: "No. 8, Jalan Kenari 2, Taman Sentosa",
  postcode: "41200",
  lat: 3.0312,
  lon: 101.4631,
  exact: "hand",
} as Place;
const kajang: Place = {
  town: "Kajang",
  state: "Selangor",
  country: "Malaysia",
  lat: 2.993,
  lon: 101.788,
  exact: "town",
} as Place;

const person = (more: Partial<PersonDetail>) =>
  ({
    id: "ali",
    full_name: "Ali bin Rosli",
    gender: "male",
    nickname: null,
    title: null,
    name_jawi: null,
    birth_date: null,
    death_date: null,
    residence: null,
    birth_place: null,
    death_place: null,
    burial_place: null,
    living: null,
    is_living: true,
    parents: [],
    residence_at_parents: null,
    parents_apart: false,
    lives_with: null,
    occupation: null,
    notes: null,
    ...more,
  }) as unknown as PersonDetail;
// Ali as the form once made easy: his house saved as where he was born and where he died, and
// where he lives his town alone.
const mixedUp = person({ residence: klang, birth_place: house, death_place: house });

let root: Root | undefined;
let asked: { method: string; path: string; body: unknown }[] = [];
let people: Record<string, PersonDetail> = {};

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  asked = [];
  people = {};
});

function answer() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    const body = ["POST", "PUT", "PATCH"].includes(request.method)
      ? await request
          .clone()
          .json()
          .catch(() => null)
      : null;
    asked.push({ method: request.method, path, body });
    const id = path.match(/^\/api\/persons\/([^/]+)$/)?.[1];
    const known = id ? people[id] : undefined;
    if (known && request.method === "PUT") return Response.json({ person: known, notices: [] });
    if (known) return Response.json(known);
    if (path === "/api/map/packs") return Response.json({ packs: [], countries: [], places: [] });
    return new Response("{}", { status: 404 });
  });
}

function render(element: React.ReactNode) {
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

function show(shown: PersonDetail, ...relatives: PersonDetail[]) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const each of [shown, ...relatives]) people[each.id] = each;
  answer();
  const element = <PersonForm person={shown} onSaved={() => {}} onCancel={() => {}} />;
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

/** Each place block's header, in the form's order: its title and its one line. */
const blocks = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button[aria-controls$="-place"]')].map(
    (button) => ({
      button,
      text: button.textContent ?? "",
      open: button.getAttribute("aria-expanded") === "true",
    }),
  );
const block = (title: string) => {
  const found = blocks().find((each) => each.text.startsWith(title));
  if (!found) throw new Error(`No place ${title}`);
  return found;
};
const button = (words: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent?.trim() === words,
  );
const field = (label: string) =>
  document.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`);

describe("each place where it's meant", () => {
  it("puts where they live first, each place folded to a line, and no death part for the living", () => {
    show(person({ residence: house, birth_place: kajang }));
    expect(blocks().map((each) => each.text)).toEqual([
      "Where they live nowNo. 8, Jalan Kenari 2, Taman … Klang, Selangor · pinned by hand",
      "Where they were bornKajang, Selangor · at its town",
    ]);
    expect(blocks().some((each) => each.open)).toBe(false);
    expect(document.body.textContent).not.toContain("Where they rest");
    expect(document.querySelector("#death_date")).toBeNull();
  });

  it("shows the death part for someone who has died, with where they died and where they rest", () => {
    show(person({ living: false, is_living: false }));
    expect(blocks().map((each) => each.text.split("Not")[0])).toEqual([
      "Where they live now",
      "Where they were born",
      "Where they died",
    ]);
    expect(document.body.textContent).toContain("Where they rest");
    expect(document.body.textContent).not.toContain("They're marked as living");
  });

  it("keeps a living person's place of death, with a word, never hidden", () => {
    show(mixedUp);
    expect(block("Where they died").text).toContain("Klang, Selangor · pinned by hand");
    expect(document.body.textContent).toContain("They're marked as living");
  });

  it("opens one place at a time", () => {
    show(person({}));
    act(() => block("Where they live now").button.click());
    expect(block("Where they live now").open).toBe(true);
    expect(field("Where they live now: address")).not.toBeNull();
    act(() => block("Where they were born").button.click());
    expect([block("Where they live now").open, block("Where they were born").open]).toEqual([
      false,
      true,
    ]);
    expect(field("Where they live now: address")).toBeNull();
  });

  it("fills a place in from another in one click", () => {
    show(person({ residence: kajang }));
    act(() => block("Where they were born").button.click());
    expect(button("Same as their parents'")).toBeUndefined(); // no parents here
    act(() => button("Same as where they live")?.click());
    expect(field("Where they were born: town")?.value).toBe("Kajang");
    expect(block("Where they were born").text).toContain("Kajang, Selangor · at its town");
  });

  it("offers their parents' place, one for each parent where they live apart", async () => {
    const mother = person({ id: "m", full_name: "Siti binti Ali", gender: "female" });
    const father = person({ id: "f", full_name: "Rosli bin Ahmad", gender: "male" });
    const parents = [mother, father] as unknown as PersonDetail["parents"];
    show(
      person({ parents }),
      { ...mother, residence: kajang } as PersonDetail,
      { ...father, residence: house } as PersonDetail,
    );
    act(() => block("Where they live now").button.click());
    await until("Same as their father's");
    expect(button("Same as their mother's")).toBeDefined();
    act(() => button("Same as their father's")?.click());
    expect(field("Where they live now: address")?.value).toBe(house.address);

    act(() => root?.unmount());
    document.body.replaceChildren();
    show(
      person({ parents }),
      { ...mother, residence: kajang } as PersonDetail,
      { ...father, residence: kajang } as PersonDetail,
    );
    act(() => block("Where they live now").button.click());
    await until("Same as their parents'");
    expect(button("Same as their mother's")).toBeUndefined();
  });
});

describe("a place saved where it isn't meant, asked about first", () => {
  const sent = () => asked.find((each) => each.method === "PUT")?.body as Record<string, Place>;

  it("moves the address home in one click: the birthplace keeps its town, the place of death goes", async () => {
    show(mixedUp);
    act(() => button("Save")?.click());
    await until("Is that where they live?");
    expect(document.body.textContent).toContain("They're living, yet have a place of death");
    expect(document.body.textContent).toContain("Where they were born has an address");
    act(() => button("Move it to Where they live")?.click());
    await vi.waitFor(() => expect(sent()).toBeDefined());
    const body = sent();
    expect(body.residence).toMatchObject({ address: house.address, lat: 3.0312, exact: "hand" });
    expect(body.birth_place).toMatchObject({ town: "Klang", address: "", lat: null });
    expect(body.death_place).toMatchObject({ town: "", address: "", lat: null });
  });

  it("saves as it is, when that's what's meant", async () => {
    show(mixedUp);
    act(() => button("Save")?.click());
    await until("Is that where they live?");
    act(() => button("Save as it is")?.click());
    await vi.waitFor(() => expect(sent()).toBeDefined());
    expect(sent().death_place).toMatchObject({ address: house.address });
  });

  it("asks nothing where each place is where it's meant", async () => {
    show(person({ residence: house, birth_place: kajang }));
    act(() => button("Save")?.click());
    await vi.waitFor(() => expect(sent()).toBeDefined());
    expect(document.body.textContent).not.toContain("Is that where they live?");
  });
});

describe("the map's Where they died", () => {
  it("lists those who have died with no place of death, each to add", () => {
    answer();
    const tok = { id: "tok", full_name: "Ahmad bin Musa", is_living: false } as GraphPerson;
    render(
      <WhereList
        field="death_place"
        spots={[]}
        people={new Map([[tok.id, tok]])}
        rough={[]}
        missing={[tok]}
        unfound={[]}
        atParents={new Map()}
        pins={[]}
        editable
        onShow={() => {}}
        onSelect={() => {}}
        onPlace={() => {}}
        onRemovePin={() => {}}
      />,
    );
    expect(document.body.textContent).toContain("Where they died");
    act(() => button("Add where they died")?.click());
    expect(field("Ahmad bin Musa: died in: town")).not.toBeNull();
  });
});

describe("What's missing: a place where it isn't meant", () => {
  it("lists someone living with a place of death, and moves it home in one click", async () => {
    const ali = { ...mixedUp, birth_year: 1980, placeholder: false } as unknown as GraphPerson;
    const graph = { people: [ali], links: [], layout: { unlinked: [] } };
    const located = (place: Place) => ({ place, country: "Malaysia", lat: place.lat ?? null });
    const map = {
      people: [{ id: "ali", lives: located(klang), born: located(house), died: located(house) }],
      pins: [],
      towns: [],
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input as Request;
      const path = new URL(request.url).pathname;
      const body = request.method === "PATCH" ? await request.clone().json() : null;
      asked.push({ method: request.method, path, body });
      if (path === "/api/graph") return Response.json(graph);
      if (path === "/api/map") return Response.json(map);
      if (path === "/api/family/facts")
        return Response.json({ to_fill_in: { no_birth_order: [] } });
      if (path === "/api/persons/ali") return Response.json({ person: mixedUp, notices: [] });
      return new Response("{}", { status: 404 });
    });
    render(<MissingSection />);
    await until("Living, with a place of death");
    expect(document.body.textContent).toContain(
      "place of death No. 8, Jalan Kenari 2, Taman … Klang, Selangor · pinned by hand",
    );
    act(() => button("Move it to Where they live")?.click());
    await vi.waitFor(() => expect(asked.some((each) => each.method === "PATCH")).toBe(true));
    const sent = asked.find((each) => each.method === "PATCH")?.body as Record<string, unknown>;
    expect(sent.residence).toMatchObject({ address: house.address, exact: "hand" });
    expect(sent.birth_place).toMatchObject({ town: "Klang", address: null, lat: null });
    expect(sent.death_place).toBeNull();
  });
});
