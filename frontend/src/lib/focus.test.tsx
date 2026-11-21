// @vitest-environment jsdom
/**
 * Every dialog and card takes the focus, and gives it back where it was: to the
 * button that opened it, or a menu's own button when it was opened from the menu. Radix gave it
 * back only to a dialog's own trigger, which the app's dialogs mostly don't have, so the focus
 * was lost to the page. And the card after dragging a link on the tree, which had no name, focus
 * or close button. Names are made up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPerson } from "@/api/types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinkPicker } from "@/features/tree/LinkPicker";

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

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function show(element: ReactNode) {
  vi.stubGlobal("fetch", async () => new Response("[]"));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root?.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>));
}

function key(name: string, at: Element | null = document.activeElement) {
  act(() => {
    at?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

/** Radix gives the focus back a moment after a dialog has gone. */
async function settled() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role='menuitem']")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent?.trim()) === name,
  );

/** A dialog opened by a button of its own, as the photo's, Export's and Add a relative's are. */
function OwnButton({ alert = false }: { alert?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Change the photo
      </button>
      {alert ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Move Ali to the Trash?</AlertDialogTitle>
            <AlertDialogDescription>He can come back.</AlertDialogDescription>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Photo of Ali</DialogTitle>
            <DialogDescription>His photo.</DialogDescription>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A dialog drawn only while it's open, whose field takes the focus itself, as Add a kind's and
 *  Add a relative's are: Radix says nothing of opening then. */
function WithAField() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add kind
      </button>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent>
            <DialogTitle>Add a relationship kind</DialogTitle>
            <DialogDescription>A kind of parent and child link.</DialogDescription>
            <input aria-label="Name" autoFocus />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A dialog opened from a menu's choice, as Same person as… is from More. */
function FromAMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button">More</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}>Same person as…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Is Ali in the tree twice?</DialogTitle>
          <DialogDescription>Choose the other.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("a dialog gives the focus back where it was", () => {
  it("to the button that opened it", async () => {
    show(<OwnButton />);
    const opener = button("Change the photo");
    act(() => {
      opener?.focus();
      opener?.click();
    });
    await settled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.contains(document.activeElement)).toBe(true);

    key("Escape");
    await settled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("from an alert dialog too", async () => {
    show(<OwnButton alert />);
    const opener = button("Change the photo");
    act(() => {
      opener?.focus();
      opener?.click();
    });
    await settled();
    expect(document.activeElement?.textContent).toBe("Cancel");
    key("Escape");
    await settled();
    expect(document.activeElement).toBe(opener);
  });

  it("from a dialog whose own field took the focus as it opened", async () => {
    show(<WithAField />);
    const opener = button("Add kind");
    act(() => {
      opener?.focus();
      opener?.click();
    });
    await settled();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
    key("Escape");
    await settled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("to the menu's button, when it was opened from the menu", async () => {
    show(<FromAMenu />);
    const more = button("More");
    act(() => more?.focus());
    key("Enter", more);
    await settled();
    const choice = button("Same person as…");
    expect(choice).toBeDefined();
    act(() => choice?.focus());
    key("Enter", choice);
    await settled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Is Ali in the tree twice?",
    );

    key("Escape");
    await settled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});

const siti = { id: "siti", full_name: "Siti binti Ali", nickname: null, gender: "female" };
const ali = { id: "ali", full_name: "Ali bin Hassan", nickname: null, gender: "male" };

/** The card after dragging a link from Siti to Ali, as the tree opens it and closes it. */
function DraggedALink() {
  const [open, setOpen] = useState(true);
  return open ? (
    <LinkPicker
      source={siti as GraphPerson}
      target={ali as GraphPerson}
      at={{ x: 200, y: 100 }}
      bounds={{ width: 800, height: 600 }}
      onClose={() => setOpen(false)}
    />
  ) : (
    <p>Closed</p>
  );
}

describe("the card after dragging a link", () => {
  it("has a name and a close button, takes the focus, and gives it back as it closes", async () => {
    const before = document.createElement("button");
    before.textContent = "Search people";
    document.body.append(before);
    before.focus();

    show(<DraggedALink />);
    const card = document.querySelector('[role="dialog"]');
    expect(card?.getAttribute("aria-label")).toBe("Link Siti and Ali");
    expect(document.activeElement).toBe(card);

    act(() => button("Close")?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(before);
  });
});
