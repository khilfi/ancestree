// @vitest-environment jsdom
/**
 * No typed change lost without the person form's question, in a dialog too, by the
 * user's answer of 19-20 Nov 2026: Add a relative and a relationship kind ask "Discard
 * your changes?" before Esc, Cancel or × throws away what's typed, and close at once with
 * nothing typed. After Add and add another, the emptied form counts as untouched. The engine's
 * answers are made up here, and so are the people.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonDetail } from "@/api/types";
import { KindDialog } from "@/features/settings/KindDialog";
import { until } from "@/viewer/looking";
import { AddRelativeDialog } from "./AddRelativeDialog";

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
  gender: "female",
  placeholder: false,
  parents: [],
  spouses: [],
  siblings: [],
  child_groups: [],
} as unknown as PersonDetail;

const hassan = {
  id: "hassan",
  full_name: "Hassan bin Ismail",
  nickname: null,
  gender: "male",
  birth_year: 1938,
  death_year: 2011,
  photo_version: null,
  placeholder: false,
};

let root: Root | undefined;
let closed = 0;
let added: string[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  closed = 0;
  added = [];
});

function show(element: ReactNode) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (path === "/api/persons/aina/relatives" && request.method === "POST") {
      const body = (await request.clone().json()) as { person: { full_name: string } };
      added.push(body.person.full_name);
      return Response.json({
        person: { ...aina, id: `new-${added.length}`, full_name: body.person.full_name },
        notices: [],
        suggestions: [],
      });
    }
    if (path === "/api/persons") return Response.json([hassan]);
    if (path === "/api/relationship-kinds") return Response.json([]);
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
}

const adding = (
  <AddRelativeDialog
    person={aina}
    relation="parent"
    onClose={() => {
      closed += 1;
    }}
    onOpenPerson={() => {}}
  />
);
const kind = (
  <KindDialog
    kind={null}
    onClose={() => {
      closed += 1;
    }}
  />
);

/** Typed into a box, as a keyboard would. */
function type(box: HTMLInputElement | HTMLTextAreaElement | null, text: string) {
  if (!box) throw new Error("No box");
  const prototype = box instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
  act(() => {
    box.focus();
    Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
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

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent?.trim()) === name,
  );
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}

const asking = () =>
  [...document.querySelectorAll('[role="alertdialog"]')].some((dialog) =>
    dialog.textContent?.includes("Discard your changes?"),
  );
const nameBox = () => document.querySelector<HTMLTextAreaElement>("#relative_name");

async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 50));
  });
}

/** Esc where the focus is, without `act`. */
function escNow() {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

/** Typed as `type` does, without `act`. */
function typeNow(box: HTMLTextAreaElement | null, text: string) {
  if (!box) throw new Error("No box");
  box.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Esc in the very next moment after `before`, as a quick hand or a busy computer can (GitHub's
 * machines did, 21 Nov 2026): what React does at once (its microtasks) is done, and nothing it
 * has put off for later. Outside `act`, which would do everything first. Whether the question
 * showed as Esc came.
 */
async function escNext(before: () => void): Promise<boolean> {
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  scope.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    before();
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
    const shown = asking();
    escNow();
    return shown;
  } finally {
    scope.IS_REACT_ACT_ENVIRONMENT = true;
  }
}

describe("Add a relative asks before throwing typed words away", () => {
  it("closes at once on Esc, Cancel or × with nothing typed", async () => {
    show(adding);
    await until("Add a parent of Aina binti Hassan");
    pressEsc();
    await settle();
    expect(asking()).toBe(false);
    expect(closed).toBe(1);
    act(() => button("Cancel").click());
    act(() => button("Close").click());
    expect(closed).toBe(3);
    expect(asking()).toBe(false);
  });

  it("asks on Esc with a name typed; Esc in the question keeps what's typed", async () => {
    show(adding);
    await until("Add a parent of Aina binti Hassan");
    type(nameBox(), "Johari bin Latif");
    pressEsc();
    await until("Discard your changes?");
    expect(closed).toBe(0);

    pressEsc();
    await vi.waitFor(() => expect(asking()).toBe(false));
    expect(closed).toBe(0);
    expect(nameBox()?.value).toBe("Johari bin Latif");
  });

  it("asks on Esc pressed the moment the name is typed", async () => {
    // The dialog heard of the typing a render after the form did: an Esc between threw the
    // name away without a question (the journey on GitHub's Mac).
    show(adding);
    await until("Add a parent of Aina binti Hassan");
    await escNext(() => typeNow(nameBox(), "Johari bin Latif"));
    await until("Discard your changes?");
    expect(closed).toBe(0);
    expect(nameBox()?.value).toBe("Johari bin Latif");
  });

  it("keeps editing on Esc pressed the moment the question shows", async () => {
    // The question takes Esc from the dialog under it once Radix has drawn both again, a
    // moment later: an Esc before then reached the dialog, which asked again, and the question
    // stayed (the journey on GitHub's Linux).
    show(adding);
    await until("Add a parent of Aina binti Hassan");
    type(nameBox(), "Johari bin Latif");
    expect(await escNext(escNow)).toBe(true);
    await settle();
    expect(asking()).toBe(false);
    expect(closed).toBe(0);
    expect(nameBox()?.value).toBe("Johari bin Latif");
  });

  it("asks on Cancel and ×, and Discard closes it", async () => {
    show(adding);
    await until("Add a parent of Aina binti Hassan");
    type(nameBox(), "Johari bin Latif");
    act(() => button("Close").click());
    await until("Discard your changes?");
    act(() => button("Keep editing").click());
    await vi.waitFor(() => expect(asking()).toBe(false));
    act(() => button("Cancel").click());
    await until("Discard your changes?");
    expect(closed).toBe(0);
    act(() => button("Discard").click());
    expect(closed).toBe(1);
    expect(added).toEqual([]);
  });

  it("counts the form emptied by Add and add another as untouched", async () => {
    show(adding);
    await until("Add a parent of Aina binti Hassan");
    type(nameBox(), "Johari bin Latif");
    act(() => button("Add and add another").click());
    await vi.waitFor(() => expect(added).toEqual(["Johari bin Latif"]));
    await vi.waitFor(() => expect(nameBox()?.value).toBe(""));
    pressEsc();
    await settle();
    expect(asking()).toBe(false);
    expect(closed).toBe(1);
  });

  it("asks once someone already in the tree is chosen", async () => {
    show(adding);
    await until("Add a parent of Aina binti Hassan");
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (each) => each.textContent === "Already in the tree",
    );
    act(() => {
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search by name or nickname…"]',
    );
    type(search, "Hassan");
    await until("Hassan bin Ismail");
    const found = document.querySelector<HTMLElement>('[role="option"]');
    act(() => found?.click());
    await until("Change");
    act(() => button("Cancel").click());
    await until("Discard your changes?");
    expect(closed).toBe(0);
  });
});

describe("Add a relationship kind asks before throwing typed words away", () => {
  it("closes at once with nothing typed", async () => {
    show(kind);
    await until("Add a relationship kind");
    act(() => button("Cancel").click());
    expect(closed).toBe(1);
    expect(asking()).toBe(false);
  });

  it("asks on Esc and Cancel with a name typed, and Discard closes it", async () => {
    show(kind);
    await until("Add a relationship kind");
    type(document.querySelector<HTMLInputElement>("#kind_label"), "Guardian");
    pressEsc();
    await until("Discard your changes?");
    expect(closed).toBe(0);
    pressEsc();
    await vi.waitFor(() => expect(asking()).toBe(false));
    expect(document.querySelector<HTMLInputElement>("#kind_label")?.value).toBe("Guardian");
    act(() => button("Cancel").click());
    await until("Discard your changes?");
    act(() => button("Discard").click());
    expect(closed).toBe(1);
  });

  it("keeps editing on Esc pressed the moment the question shows", async () => {
    show(kind);
    await until("Add a relationship kind");
    type(document.querySelector<HTMLInputElement>("#kind_label"), "Guardian");
    expect(await escNext(escNow)).toBe(true);
    await settle();
    expect(asking()).toBe(false);
    expect(closed).toBe(0);
    expect(document.querySelector<HTMLInputElement>("#kind_label")?.value).toBe("Guardian");
  });
});
