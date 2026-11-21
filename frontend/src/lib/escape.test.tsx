// @vitest-environment jsdom
/**
 * Esc closes what's on top, and only that: of the panels and cards the app draws
 * itself, the one opened last; and a dialog over them before any of them. Family facts once took
 * Esc from a dialog over it, closing behind it and leaving the dialog open. The facts are made up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FamilyFactsPanel } from "@/features/facts/FamilyFactsPanel";
import { useEscape } from "./escape";

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
let closed: string[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  closed = [];
});

function show(element: ReactNode) {
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

/** Esc, pressed where the focus is, as the keyboard does. */
function pressEsc() {
  const at = document.activeElement ?? document.body;
  act(() => {
    at.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

/** A panel the app draws itself, closed by Esc. */
function Panel({ name }: { name: string }) {
  const [open, setOpen] = useState(true);
  useEscape(() => {
    closed.push(name);
    setOpen(false);
  }, open);
  return open ? <p>{name}</p> : null;
}

/** Panels opened one after another, as a person opens them. */
function Opened({ names }: { names: string[] }) {
  return names.map((name) => <Panel key={name} name={name} />);
}

function Over({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>A dialog over the rest.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;

describe("Esc closes what's on top, and only that", () => {
  it("closes the one opened last first, one at each press", () => {
    show(<Opened names={["Family facts", "A card on the tree"]} />);
    pressEsc();
    expect(closed).toEqual(["A card on the tree"]);
    pressEsc();
    expect(closed).toEqual(["A card on the tree", "Family facts"]);
    pressEsc();
    expect(closed).toHaveLength(2);
  });

  it("closes nothing when something else took the key", () => {
    show(<Opened names={["Family facts"]} />);
    const taken = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", taken, true);
    pressEsc();
    document.removeEventListener("keydown", taken, true);
    expect(closed).toEqual([]);
  });

  it("closes a dialog over a panel first, and only the dialog", () => {
    show(
      <Over>
        <Panel name="Family facts" />
      </Over>,
    );
    expect(dialogOpen()).toBe(true);
    pressEsc();
    expect(dialogOpen()).toBe(false);
    expect(closed).toEqual([]);
    pressEsc();
    expect(closed).toEqual(["Family facts"]);
  });

  it("with Family facts open, closes the dialog over it, and leaves Family facts open", () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    const closeFacts = vi.fn();
    show(
      <Over>
        <FamilyFactsPanel tab="facts" onTab={() => {}} onClose={closeFacts} />
      </Over>,
    );
    pressEsc();
    expect(dialogOpen()).toBe(false);
    expect(closeFacts).not.toHaveBeenCalled();
    pressEsc();
    expect(closeFacts).toHaveBeenCalledTimes(1);
  });
});
