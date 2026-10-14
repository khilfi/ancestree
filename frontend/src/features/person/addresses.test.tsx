// @vitest-environment jsdom
/**
 * Addresses, with the engine's answers made up here: the address typed in one line,
 * its suggestions filling in the rest, and the country's download offered; where someone with
 * no place of their own lives, at their parents'; and the fields that grow with their text.
 * Names and addresses are made up; the places are real.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPerson, MapPacks, PersonDetail, PlaceSuggestions } from "@/api/types";
import { GrowingText } from "@/components/ui/growing-text";
import { WhereList } from "@/features/map/WhereList";
import { grownUp } from "@/features/settings/MissingSection";
import { until } from "@/viewer/looking";
import { PersonDetails } from "./PersonDetails";
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

const kajang = {
  town: "Kajang",
  district: "Hulu Langat",
  state: "Selangor",
  postcode: "43000",
  country: "Malaysia",
  lat: 2.993,
  lon: 101.788,
  exact: "postcode" as const,
};
const SUGGESTED: PlaceSuggestions = {
  country: "my",
  downloaded: false,
  suggestions: [{ ...kajang, address: "" }],
};
const PACKS: MapPacks = {
  build: "20261007",
  packs: [],
  countries: [{ key: "my", title: "Malaysia", continent: "Asia", packs: ["my"] }],
  places: [],
  online: false,
  lookup: "ask",
};
const place = (more: Partial<PersonDetail["residence"]> = {}) =>
  ({ town: "Kajang", state: "Selangor", country: "Malaysia", ...more }) as NonNullable<
    PersonDetail["residence"]
  >;
const mother = { id: "m", full_name: "Siti binti Ali", gender: "female" };
const aina = {
  id: "aina",
  full_name: "Aina binti Hassan",
  gender: "female",
  residence: null,
  birth_place: null,
  death_place: null,
  living: null,
  is_living: true,
  parents: [mother, { id: "f", full_name: "Hassan bin Ismail", gender: "male" }],
  residence_at_parents: { place: place(), whose: "mother", district: "Hulu Langat" },
  parents_apart: true,
  lives_with: null,
} as unknown as PersonDetail;

let root: Root | undefined;
let asked: { method: string; path: string; body: unknown }[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  asked = [];
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
    if (path === "/api/places/suggest") return Response.json(SUGGESTED);
    if (path === "/api/map/packs" || path === "/api/map/countries/my") return Response.json(PACKS);
    if (path === `/api/persons/${aina.id}`) return Response.json({ person: aina, notices: [] });
    return new Response("{}", { status: 404 });
  });
}

function show(element: React.ReactNode) {
  // Radix's radio buttons and checkbox measure themselves, as jsdom can't.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((each) => each.textContent?.trim() === name);

async function saved() {
  for (let tries = 0; tries < 100; tries++) {
    const sent = asked.find((each) => each.path === `/api/persons/${aina.id}` && each.body);
    if (sent) return sent.body as Record<string, unknown>;
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
  throw new Error("never saved");
}

describe("an address, filled in as it's typed", () => {
  it("suggests the rest from the postcode, fills it in, and saves it all", async () => {
    answer();
    show(
      <PersonForm
        person={{ ...aina, residence_at_parents: null }}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    );
    type(field("Lives in: address"), "No. 12, Jalan Melati 3, 43000 Kajang");
    await until("Kajang · Hulu Langat · Selangor · 43000 · Malaysia");
    act(() => button("Kajang · Hulu Langat · Selangor · 43000 · Malaysia")?.click());
    expect(field("Lives in: town").value).toBe("Kajang");
    expect(field("Lives in: district").value).toBe("Hulu Langat");
    expect(field("Lives in: postcode").value).toBe("43000");
    expect(field("Lives in: address").value).toBe("No. 12, Jalan Melati 3, 43000 Kajang");
    expect(document.body.textContent).toContain("On the mapPostcode area2.9930, 101.7880");
    act(() => button("Save")?.click());
    const residence = (await saved()).residence;
    expect(residence).toEqual({ address: "No. 12, Jalan Melati 3, 43000 Kajang", ...kajang });
  });

  it("brings its suggestions into view, below a field low in the panel", async () => {
    answer();
    const scrolled = vi.fn();
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    try {
      show(<PersonForm person={aina} onSaved={() => {}} onCancel={() => {}} />);
      type(field("Lives in: address"), "43000");
      await until("Kajang · Hulu Langat");
      expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = before;
    }
  });

  it("offers the country's map and places where they aren't on this computer", async () => {
    answer();
    show(<PersonForm person={aina} onSaved={() => {}} onCancel={() => {}} />);
    type(field("Lives in: address"), "43000");
    await until("Malaysia's towns, villages and postcodes aren't on this computer yet.");
    await act(async () => button("Download Malaysia's map and places")?.click());
    await until("Malaysia's map and places are on their way");
    expect(asked).toContainEqual({ method: "POST", path: "/api/map/countries/my", body: null });
  });

  it("forgets where a place is once its town is typed by hand", async () => {
    answer();
    show(<PersonForm person={aina} onSaved={() => {}} onCancel={() => {}} />);
    type(field("Lives in: address"), "43000");
    await until("Kajang · Hulu Langat");
    act(() => button("Kajang · Hulu Langat · Selangor · 43000 · Malaysia")?.click());
    type(field("Lives in: town"), "Semenyih");
    expect(document.body.textContent).not.toContain("2.9930, 101.7880");
    expect(document.body.textContent).toContain("On the mapat its town, as the map finds it");
  });
});

describe("living at their parents'", () => {
  it("says whose, and lets their father's or elsewhere be chosen when the parents live apart", async () => {
    answer();
    show(<PersonForm person={aina} onSaved={() => {}} onCancel={() => {}} />);
    expect(document.body.textContent).toContain(
      "With no place of their own, they're shown at their mother's: Kajang, Hulu Langat, Selangor.",
    );
    const father = document.querySelector<HTMLButtonElement>("#lives-with-father");
    act(() => father?.click());
    act(() => button("Save")?.click());
    expect((await saved()).lives_with).toBe("father");
  });

  it("offers Lives elsewhere alone when the parents live together, and nothing once there's a place", async () => {
    answer();
    show(
      <PersonForm
        person={{ ...aina, parents_apart: false }}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.querySelector("#lives-with-father")).toBeNull();
    const elsewhere = document.querySelector<HTMLButtonElement>("#lives-elsewhere");
    expect(elsewhere?.getAttribute("role")).toBe("checkbox");
    type(field("Lives in: town"), "Kajang");
    expect(document.querySelector("#lives-elsewhere")).toBeNull();
  });

  it("is shown in their details, whose place it is", () => {
    show(<PersonDetails person={aina} />);
    expect(document.body.textContent).toContain(
      "Lives inKajang, Hulu Langat, Selangor (at their mother's)",
    );
  });

  it("their own address is shown, with its postcode", () => {
    const home = place({ address: "No. 12, Jalan Melati 3", postcode: "43000" });
    show(<PersonDetails person={{ ...aina, residence: home, residence_at_parents: null }} />);
    expect(document.body.textContent).toContain("AddressNo. 12, Jalan Melati 3 43000");
    expect(document.body.textContent).not.toContain("(at their");
  });

  it("is said in the map's list of who lives where", () => {
    const spot = { x: 0, y: 0, place: "Kajang", district: null, state: "Selangor" };
    const at = { ...spot, id: "aina", country: "Malaysia", rough: false };
    show(
      <WhereList
        field="residence"
        spots={[{ ...at, id: "m" }, at]}
        people={new Map([mother, aina].map((p) => [p.id, p as unknown as GraphPerson]))}
        rough={[]}
        missing={[]}
        unfound={[]}
        atParents={new Map([["aina", "mother"]])}
        pins={[]}
        editable
        onShow={() => {}}
        onSelect={() => {}}
        onPlace={() => {}}
        onRemovePin={() => {}}
      />,
    );
    expect(document.body.textContent).toContain("Siti, Aina (at their mother's)");
  });

  it("lists grown-ups shown at their parents', of an age known", () => {
    const born = (year: number | null) => ({ born: year ? { year } : null, birth_year: year });
    expect(grownUp(born(2000) as never, 2026)).toBe(true);
    expect(grownUp(born(2010) as never, 2026)).toBe(false);
    expect(grownUp(born(null) as never, 2026)).toBe(false);
  });
});

describe("a field that grows with its text", () => {
  it("starts as one line, saves on Enter, and breaks no line", () => {
    const submitted: string[] = [];
    show(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted.push("saved");
        }}
      >
        <GrowingText aria-label="Town" />
      </form>,
    );
    const town = field("Town");
    expect(town.rows).toBe(1);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => town.dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(submitted).toEqual(["saved"]);
    const shifted = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => town.dispatchEvent(shifted));
    expect(submitted).toEqual(["saved"]);
    // Never stretched to its row: beside another in a grid, each would keep the other tall.
    expect(town.classList).toContain("self-start");
  });
});
