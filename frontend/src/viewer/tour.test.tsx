// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root as Rendered } from "react-dom/client";
import { createMemoryRouter } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppLayout } from "@/app/AppLayout";
import { Root } from "@/app/Root";
import { PersonPanel } from "@/features/person/PersonPanel";
import { golden } from "@/kinship/golden";
import { installCopy } from "./answers";
import { controls, named, until } from "./looking";
import type { CopySnapshot } from "./snapshot";
import family from "./tour-family.json";

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

// The same made-up family's graph and word lists, as the backend writes them down: what
// the copy's relationship finder works from.
const seed = golden("seed");
const copy = {
  ...family,
  graph: { people: seed.people, links: seed.links },
  kinship: seed.kinship,
} as unknown as CopySnapshot;
const HASSAN = Object.keys(copy.persons ?? {})[0] ?? "";
const nothing = () => {};

// Anything that would add, change or delete, by the name it's shown or read out with.
const CHANGES = [
  /^Add person/,
  /^Undo/,
  /^Redo/,
  /^Settings$/,
  /^Edit$/,
  /^Move to Trash$/,
  /^Centre the tree here$/,
  /^(Add|Change) (a|the) photo$/,
  /^Add (parent|spouse|sibling|child)$/,
  /^Link with /,
  /^Move .+ in the birth order$/,
  /^Make a copy/,
  /^Fill them in/,
];

function changes(): string[] {
  return controls().filter((name) => CHANGES.some((change) => change.test(name)));
}

describe("a view-only copy, looked around", () => {
  let host: HTMLDivElement;
  let root: Rendered;

  beforeAll(async () => {
    installCopy(copy);
    const router = createMemoryRouter([
      {
        path: "/",
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: (
              <PersonPanel
                personId={HASSAN}
                onSelect={nothing}
                onClose={nothing}
                onDelete={nothing}
                onFindRelationship={nothing}
              />
            ),
          },
        ],
      },
    ]);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Root router={router} copy={copy.about} />));
    await until("Hassan bin Ismail");
  });

  afterAll(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("says which copy it is, and offers nothing to change", () => {
    expect(document.body.textContent).toContain("Keluarga Contoh · view-only");
    expect(controls()).toContain("Export");
    expect(changes()).toEqual([]);
  });

  it("shows relatives without ways to add or relink them", async () => {
    act(() => {
      named("Relatives (10)").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await until("Nenek Fatimah");
    expect(changes()).toEqual([]);
  });

  it("exports what the copy carries, but makes no copies of it", async () => {
    act(() => named("Export").click());
    await until("Import template");
    expect(changes()).toEqual([]);
    act(() => named("Close").click());
  });

  it("gives Family facts as they were when the copy was made", async () => {
    act(() => named("Family facts").click());
    await until("when this copy was made");
    expect(changes()).toEqual([]);
  });

  it("finds relationships, and lets each viewer say who they are", async () => {
    act(() => {
      named("Details").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await until("Full name");
    expect(controls()).toContain("Find relationship");

    act(() => named("Me").click());
    await until("Which person are you?");
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search for yourself"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(search, "zul");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await until("Zulkifli bin Hassan");
    const zul = [...document.querySelectorAll<HTMLElement>('[aria-label="People"] button')].find(
      (button) => button.textContent?.includes("Zulkifli bin Hassan"),
    );
    act(() => zul?.click());

    // Worked out by the copy's own finder: Hassan is Zul's father.
    await until("Your father");
    expect(changes()).toEqual([]);
  });
});
