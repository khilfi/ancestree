// @vitest-environment jsdom
/**
 * The person panel, and adding people faster, with the engine's answers made up
 * here: Edit, Life story and More under the name; the panel closing when the person has gone,
 * as after Undo of adding them; a date typed as it's said, what it understood beside it, and
 * the lists as a second way; Ctrl+Enter to save; and Add and add another. People are made up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "@/api/queries";
import type { PersonDetail } from "@/api/types";
import { until } from "@/viewer/looking";
import { AddRelativeDialog } from "./AddRelativeDialog";
import { type DateParts, DatePicker, dateInput, NO_DATE } from "./DatePicker";
import { PersonPanel } from "./PersonPanel";

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

const aina = {
  id: "aina",
  full_name: "Aina binti Hassan",
  nickname: null,
  title: null,
  name_jawi: null,
  gender: "female",
  birth_date: { value: { year: 1965, qualifier: "exact" }, description: "1965", text: "1965" },
  birth_place: null,
  death_date: null,
  death_place: null,
  burial_place: null,
  residence: null,
  parents_apart: false,
  living: null,
  is_living: true,
  occupation: null,
  notes: null,
  placeholder: false,
  photo_version: null,
  sibling_position: null,
  parents: [],
  spouses: [],
  siblings: [],
  child_groups: [],
  link_count: 0,
  created_at: null,
  updated_at: null,
} as unknown as PersonDetail;

let root: Root | undefined;
let asked: { method: string; path: string; body: unknown }[] = [];
let here = true; // whether Aina is in the tree
let shown: PersonDetail = aina; // as the engine answers her

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  asked = [];
  here = true;
  shown = aina;
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
    if (path === "/api/persons/aina" && request.method === "GET") {
      if (!here) {
        return Response.json(
          { detail: { message: "That person isn't in the tree.", code: "not_found" } },
          { status: 404 },
        );
      }
      return Response.json(shown);
    }
    if (path === "/api/persons/aina" && request.method === "PUT") {
      return Response.json({ person: { ...aina, ...body }, notices: [] });
    }
    if (path === "/api/persons/aina/relatives") {
      const added = body as { person: { full_name: string } };
      return Response.json({
        person: { ...aina, id: `new-${asked.length}`, full_name: added.person.full_name },
        notices: [],
        suggestions: [],
      });
    }
    if (path === "/api/relationship-kinds") return Response.json([]);
    return new Response("{}", { status: 404 });
  });
}

function show(element: ReactNode): QueryClient {
  // Radix's menus and lists measure where they go, and scroll to what's chosen, as jsdom can't.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView ??= () => {};
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
  return client;
}

const nothing = () => {};

function panel(onClose: () => void = nothing) {
  return (
    <PersonPanel
      personId="aina"
      onSelect={nothing}
      onClose={onClose}
      onDelete={nothing}
      onFindRelationship={nothing}
    />
  );
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent?.trim()) === name,
  );
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}

const items = () =>
  [...document.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent?.trim());

async function wait(until: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !until(); tries++) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
}

/** Typed into a box, as a keyboard would. */
function type(box: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype = box instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
  const setValue = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function box(label: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`No box "${label}"`);
  return found;
}

describe("the panel's top", () => {
  it("has Edit, Life story and More under the name, and nothing at the foot", async () => {
    answer();
    show(panel());
    await until("Aina binti Hassan");
    const header = document.querySelector("aside header");
    const inHeader = [...(header?.querySelectorAll("button") ?? [])].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent?.trim(),
    );
    expect(inHeader).toEqual([
      "Add a photo",
      "Close the panel",
      "Edit",
      "Life story",
      "More for Aina",
    ]);
    // Under Details, only their details: no row of buttons after them.
    expect(document.body.textContent).not.toContain("Move to Trash");
    expect(document.body.textContent).not.toContain("Find relationship");

    act(() => {
      button("More for Aina").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await wait(() => items().length > 0);
    expect(items()).toEqual([
      "Find relationship",
      "Centre the tree here",
      "Same person as…",
      "Move to Trash",
    ]);
  });

  it("hides them while editing, the form's own Save and Cancel at its foot", async () => {
    answer();
    show(panel());
    await until("Aina binti Hassan");
    act(() => button("Edit").click());
    await until("Full name");
    expect(() => button("Edit")).toThrow();
    expect(() => button("More for Aina")).toThrow();
    const foot = button("Save").closest("div");
    expect(foot?.className).toContain("sticky");
    expect(foot?.contains(button("Cancel"))).toBe(true);
  });

  // Found by the journeys: after Undo of adding someone, the panel stayed open on them,
  // saying "That person isn't in the tree."
  it("closes when the person has gone from the tree", async () => {
    answer();
    const onClose = vi.fn();
    const client = show(panel(onClose));
    await until("Aina binti Hassan");
    here = false; // Undo of adding her
    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.person("aina") });
    });
    await wait(() => onClose.mock.calls.length > 0);
    expect(onClose).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("That person isn't in the tree.");
  });
});

// Short years keep a date's qualifier, by the user's answer of 19–20 Nov 2026: a
// relative born "about 1920" showed as "b. 1920", as if certain.
describe("a relative's years, as sure as their dates", () => {
  it("says about, before and between in the relatives list", async () => {
    const relative = (id: string, name: string, label: string, born: object) => ({
      id,
      full_name: name,
      nickname: null,
      gender: "male",
      birth_year: (born as { year: number }).year,
      death_year: null,
      born,
      died: null,
      photo_version: null,
      placeholder: false,
      label,
      link_id: `link-${id}`,
      kind: "biological",
    });
    shown = {
      ...aina,
      parents: [
        relative("johari", "Johari bin Latif", "Father", { year: 1920, qualifier: "about" }),
      ],
      spouses: [
        {
          ...relative("hafiz", "Hafiz bin Kassim", "Husband", { year: 1950, qualifier: "before" }),
          status: "married",
        },
      ],
      child_groups: [
        {
          kind: null,
          other_parents: [],
          order_decided: true,
          children: [
            relative("iman", "Iman binti Hafiz", "Daughter", {
              year: 1976,
              qualifier: "between",
              year_to: 1978,
            }),
          ],
        },
      ],
    } as unknown as PersonDetail;
    answer();
    show(panel());
    await until("Aina binti Hassan");
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((each) =>
      each.textContent?.startsWith("Relatives"),
    );
    act(() => {
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    await until("Johari bin Latif");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Father · b. c. 1920");
    expect(text).toContain("Husband · b. before 1950");
    expect(text).toContain("Daughter · b. 1976–1978");
  });
});

/** Esc, pressed where the focus is, as the keyboard does. */
function pressEsc() {
  const at = document.activeElement ?? document.body;
  act(() => {
    at.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

// Esc closes the person's panel when nothing else is open over it, by the user's answer of
// 19–20 Nov 2026, through the Esc stack: once, it closed nothing, and only × did.
describe("Esc and the panel", () => {
  it("closes it when nothing is open over it", async () => {
    answer();
    const onClose = vi.fn();
    show(panel(onClose));
    await until("Aina binti Hassan");
    act(() => button("Edit").focus());
    pressEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes More first, then the panel", async () => {
    answer();
    const onClose = vi.fn();
    show(panel(onClose));
    await until("Aina binti Hassan");
    act(() => {
      button("More for Aina").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await wait(() => items().length > 0);
    pressEsc();
    await wait(() => items().length === 0);
    expect(items()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    pressEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is the form's Cancel first, while it's open, asking with something typed", async () => {
    answer();
    const onClose = vi.fn();
    show(
      <PersonPanel
        personId={null}
        onSelect={nothing}
        onClose={onClose}
        onDelete={nothing}
        onEscape={() => onClose("Esc")}
      />,
    );
    await until("Add a person");
    const name = document.querySelector<HTMLTextAreaElement>("#full_name");
    if (!name) throw new Error("No name");
    type(name, "Siti binti Ali");
    pressEsc();
    await until("Discard your changes?");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does what the page asks of it, where the page has its own", async () => {
    answer();
    const onClose = vi.fn();
    const onEscape = vi.fn();
    show(
      <PersonPanel
        personId="aina"
        onSelect={nothing}
        onClose={onClose}
        onDelete={nothing}
        onEscape={onEscape}
      />,
    );
    await until("Aina binti Hassan");
    pressEsc();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Ctrl+Enter", () => {
  it("saves the form from any of its boxes", async () => {
    answer();
    show(panel());
    await until("Aina binti Hassan");
    act(() => button("Edit").click());
    await until("Occupation");
    const occupation = document.querySelector<HTMLTextAreaElement>("#occupation");
    if (!occupation) throw new Error("No occupation");
    type(occupation, "Guru");
    act(() => {
      occupation.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    await wait(() => asked.some((each) => each.method === "PUT"));
    const saved = asked.find((each) => each.method === "PUT")?.body as { occupation: string };
    expect(saved.occupation).toBe("Guru");
  });
});

describe("a date typed as it's said", () => {
  function Holder({ start = NO_DATE }: { start?: DateParts }) {
    // A small form's worth: the date as the form holds it, and what it would send.
    const [value, setValue] = useState(start);
    return (
      <>
        <DatePicker id="born" label="Date of birth" value={value} onChange={setValue} />
        <output>{JSON.stringify(dateInput(value))}</output>
      </>
    );
  }

  const sent = () => JSON.parse(document.querySelector("output")?.textContent || "null");
  const said = () => document.querySelector("#born-said")?.textContent;

  it("reads each of the plan's forms, and says beside it what it understood", () => {
    show(<Holder />);
    const date = box("Date of birth");
    const forms: [string, string][] = [
      ["12/3/1950", "12 March 1950"],
      ["March 1950", "March 1950"],
      ["about 1950", "about 1950"],
      ["before 1960", "before 1960"],
      ["1950–1955", "between 1950 and 1955"],
      ["kira-kira 1950", "about 1950"],
    ];
    for (const [typed, reading] of forms) {
      type(date, typed);
      expect(date.value).toBe(typed);
      expect(said()).toBe(reading);
    }
    expect(sent()).toEqual({
      qualifier: "about",
      year: 1950,
      month: null,
      day: null,
      year_to: null,
      original_text: null,
    });
    type(date, "");
    expect(sent()).toBeNull();
  });

  it("says what can't be read once the box is left, and sends nothing for it", () => {
    show(<Holder />);
    const date = box("Date of birth");
    act(() => date.focus());
    type(date, "12/3/50");
    expect(said()).toBeUndefined(); // still being typed
    act(() => date.blur());
    expect(said()).toBe("Use a 4-digit year in '12/3/50', e.g. 12/3/1950.");
  });

  it("keeps the lists as a second way, and says what's picked in the box", async () => {
    show(<Holder start={{ ...NO_DATE, year: 1950, month: 3, day: 12 }} />);
    const date = box("Date of birth");
    expect(date.value).toBe("12/3/1950");
    expect(document.querySelector('[aria-label="Date of birth: year"]')).toBeNull();
    act(() => button("Date of birth: pick from lists").click());
    expect(document.querySelector('[aria-label="Date of birth: year"]')?.textContent).toBe("1950");
    expect(document.querySelector('[aria-label="Date of birth: how sure"]')?.textContent).toBe(
      "Exact",
    );
  });

  it("keeps an old import's words until a date is typed", () => {
    show(<Holder start={{ ...NO_DATE, original_text: "zaman Jepun" }} />);
    expect(box("Date of birth").value).toBe("");
    expect(said()).toBe("Recorded as “zaman Jepun”. Typing a date replaces it.");
    type(box("Date of birth"), "c. 1943");
    expect(sent()).toMatchObject({ qualifier: "about", year: 1943, original_text: null });
  });
});

describe("Add and add another", () => {
  it("adds, then empties the form for the next, the other parent's gender chosen", async () => {
    answer();
    const onClose = vi.fn();
    show(
      <AddRelativeDialog
        person={aina}
        relation="parent"
        onClose={onClose}
        onOpenPerson={nothing}
      />,
    );
    await until("Add a parent of Aina binti Hassan");
    const name = document.querySelector<HTMLTextAreaElement>("#relative_name");
    if (!name) throw new Error("No name");
    type(name, "Hassan bin Ismail");
    // The father: Male, from the list.
    const gender = document.querySelector<HTMLButtonElement>("#relative_gender");
    act(() => {
      gender?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await wait(() => document.querySelector('[role="option"]') !== null);
    const male = [...document.querySelectorAll('[role="option"]')].find(
      (each) => each.textContent === "Male",
    );
    act(() => {
      male?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await wait(() => gender?.textContent === "Male");
    type(box("Date of birth"), "about 1938");
    act(() => button("Add and add another").click());
    await wait(() => asked.some((each) => each.path === "/api/persons/aina/relatives"));
    await wait(() => name.value === "");
    const first = asked.find((each) => each.path === "/api/persons/aina/relatives")?.body;
    expect(first).toMatchObject({
      relation: "parent",
      person: { full_name: "Hassan bin Ismail", birth_date: { qualifier: "about", year: 1938 } },
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(box("Date of birth").value).toBe("");
    expect(gender?.textContent).toBe("Female"); // the other parent, likely
    await wait(() => document.activeElement === name); // ready for the next name
    expect(document.activeElement).toBe(name);

    type(name, "Siti binti Ali");
    act(() => button("Add").click());
    await wait(() => onClose.mock.calls.length > 0);
    const posted = asked.filter((each) => each.path === "/api/persons/aina/relatives");
    expect(
      posted.map((each) => (each.body as { person: { full_name: string } }).person.full_name),
    ).toEqual(["Hassan bin Ismail", "Siti binti Ali"]);
  });
});
