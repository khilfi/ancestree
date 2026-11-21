// @vitest-environment jsdom
/**
 * No typed change lost without a question, with the engine's answers made up here:
 * in the person form, Esc is Cancel; Cancel asks "Discard your changes?" before throwing typed
 * changes away, and Esc in that question, or in "Is that where they live?", keeps editing.
 * Names and addresses are made up; the places are real.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonDetail } from "@/api/types";
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
const ali = {
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
} as unknown as PersonDetail;
// An address where he was born, and none where he lives: asked about before saving.
const bornAtAHouse = {
  ...ali,
  birth_place: {
    address: "No. 8, Jalan Kenari 2",
    town: "Kajang",
    state: "Selangor",
    country: "Malaysia",
  } as Place,
} as PersonDetail;

let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let sent: string[] = [];
let left = 0;

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  sent = [];
  left = 0;
});

function show(person: PersonDetail) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (request.method !== "GET") sent.push(`${request.method} ${path}`);
    if (path === "/api/map/packs") return Response.json({ packs: [], countries: [], places: [] });
    if (path === "/api/health") return Response.json({ death_places: false });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const form = (
    <PersonForm
      person={person}
      onSaved={() => {}}
      onCancel={() => {
        left += 1;
      }}
    />
  );
  router = createMemoryRouter([
    { path: "/", element: form },
    { path: "/timeline", element: <p>The timeline</p> },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const shown = router;
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={shown} />
      </QueryClientProvider>,
    ),
  );
}

function field(id: string): HTMLTextAreaElement {
  const found = document.getElementById(id);
  if (!(found instanceof HTMLTextAreaElement)) throw new Error(`No field ${id}`);
  return found;
}

function type(element: HTMLTextAreaElement, text: string) {
  act(() => {
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      element,
      text,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Esc, pressed where the focus is, as the keyboard does. */
function pressEsc() {
  const at = document.activeElement ?? document.body;
  act(() => {
    at.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((each) => each.textContent?.trim() === name);
const asking = (title: string) =>
  [...document.querySelectorAll('[role="alertdialog"]')].some((dialog) =>
    dialog.textContent?.includes(title),
  );

describe("in the person form, Esc is Cancel", () => {
  it("leaves at once with nothing changed", () => {
    show(ali);
    act(() => field("nickname").focus());
    pressEsc();
    expect(left).toBe(1);
    expect(asking("Discard your changes?")).toBe(false);
  });

  it("asks first with something typed, and Esc in the question keeps editing", async () => {
    show(ali);
    type(field("occupation"), "Guru");
    pressEsc();
    await until("Discard your changes?");
    expect(left).toBe(0);

    pressEsc();
    await vi.waitFor(() => expect(asking("Discard your changes?")).toBe(false));
    expect(left).toBe(0);
    expect(field("occupation").value).toBe("Guru");
  });
});

describe("Cancel asks before throwing typed changes away", () => {
  it("asks, and Keep editing keeps what's typed", async () => {
    show(ali);
    type(field("occupation"), "Guru");
    act(() => button("Cancel")?.click());
    await until("Discard your changes?");
    expect(left).toBe(0);

    act(() => button("Keep editing")?.click());
    await vi.waitFor(() => expect(asking("Discard your changes?")).toBe(false));
    expect(left).toBe(0);
    expect(field("occupation").value).toBe("Guru");
  });

  it("leaves once Discard is chosen, and only then", async () => {
    show(ali);
    type(field("occupation"), "Guru");
    act(() => button("Cancel")?.click());
    await until("Discard your changes?");
    act(() => button("Discard")?.click());
    expect(left).toBe(1);
    expect(sent).toEqual([]);
  });

  it("asks nothing when what's typed is taken back to what was saved", () => {
    show(ali);
    type(field("occupation"), "Guru");
    type(field("occupation"), "");
    act(() => button("Cancel")?.click());
    expect(left).toBe(1);
  });
});

describe("leaving the form for another address", () => {
  it("asks, and Esc in the question stays", async () => {
    show(ali);
    type(field("occupation"), "Guru");
    await act(() => router?.navigate("/timeline"));
    await until("Discard your changes?");

    pressEsc();
    await vi.waitFor(() => expect(asking("Discard your changes?")).toBe(false));
    expect(router?.state.location.pathname).toBe("/");
    expect(field("occupation").value).toBe("Guru");
  });

  it("goes once Discard is chosen", async () => {
    show(ali);
    type(field("occupation"), "Guru");
    await act(() => router?.navigate("/timeline"));
    await until("Discard your changes?");
    act(() => button("Discard")?.click());
    await until("The timeline");
    expect(left).toBe(0); // left by the address, not by Cancel
  });
});

// The question when an address is set, and Esc in it.
describe("Is that where they live?", () => {
  it("keeps editing on Esc, saving nothing", async () => {
    show(bornAtAHouse);
    act(() => button("Save")?.click());
    await until("Is that where they live?");

    pressEsc();
    await vi.waitFor(() => expect(asking("Is that where they live?")).toBe(false));
    expect(sent).toEqual([]);
    expect(left).toBe(0);
    expect(button("Save")).toBeDefined();
  });
});
