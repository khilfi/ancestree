// @vitest-environment jsdom
/**
 * Esc on the map closes what's on top, and only that, through `useEscape`: a dialog
 * over the map before a bundle opened on it, or before a place being put on the map by hand.
 * Before, the map's own Esc listened on the window for itself, and closed with the dialog.
 * Made-up people.
 */
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPerson } from "@/api/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { onPlane } from "./geo";
import type { Spot } from "./levels";
import { MapCanvas } from "./MapCanvas";
import { FamilyPlaces } from "./places";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

let root: Root | undefined;
let openDialog: () => void = () => {};

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});

/** The map, and a dialog that can open over it, as Export's does. */
function Over({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  openDialog = () => setOpen(true);
  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>A dialog over the map.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

function show(element: ReactNode) {
  const router = createMemoryRouter([{ path: "/", element: <Over>{element}</Over> }]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<RouterProvider router={router} />));
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

const METRE = 1 / 111_320;
function spot(id: string, metresNorth: number): Spot {
  const [x, y] = onPlane(2.99312 + metresNorth * METRE, 101.78791);
  return {
    id,
    x,
    y,
    place: "Kajang",
    district: "Hulu Langat",
    state: "Selangor",
    country: "Malaysia",
    rough: false,
    exact: "hand",
    address: "No. 8, Jalan Kenari 2",
  };
}
const someone = (id: string, full_name: string, birth_year: number) =>
  ({
    id,
    full_name,
    nickname: null,
    gender: "unknown",
    birth_year,
    death_year: null,
    birth_order: null,
    placeholder: false,
    photo_version: null,
    has_story: false,
  }) as GraphPerson;
const THREE = [
  someone("ali", "Aminah binti Hassan", 1962),
  someone("nora", "Zulkifli bin Hassan", 1965),
  someone("mak", "Fatimah binti Yusof", 1941),
];
const people = new Map(THREE.map((person) => [person.id, person]));

const dialog = () => document.querySelector('[role="dialog"][aria-labelledby]');
const bundle = () => document.querySelector('[role="dialog"][aria-label^="Fatimah and 2 more"]');

describe("Esc on the map", () => {
  it("closes a dialog over the map before a bundle opened on it", () => {
    const spots = [spot("ali", 0), spot("nora", 6), spot("mak", 3)];
    const byId = new Map(spots.map((each) => [each.id, each]));
    show(
      <FamilyPlaces
        groups={[
          {
            key: "bundle",
            label: "Kajang",
            at: { x: 400, y: 300 },
            members: ["ali", "nora", "mak"],
            rough: false,
            towns: 3,
          },
        ]}
        level="towns"
        size={{ width: 800, height: 600 }}
        withNames={false}
        spacing={38}
        people={people}
        colourOf={() => null}
        faded={null}
        selectedId={null}
        onZoomInto={() => {}}
        spotOf={(id) => byId.get(id)}
        screenOf={() => ({ x: 400, y: 300 })}
        generationOf={() => undefined}
        deepest={false}
      />,
    );
    const circle = [...document.querySelectorAll("button")].find((each) =>
      each.getAttribute("aria-label")?.endsWith(". Open"),
    );
    act(() => circle?.click());
    expect(bundle()).not.toBeNull();
    act(() => openDialog());
    expect(dialog()).not.toBeNull();

    pressEsc();
    expect(dialog()).toBeNull();
    expect(bundle()).not.toBeNull(); // before, it folded with the dialog
    pressEsc();
    expect(bundle()).toBeNull();
  });

  it("closes a dialog over the map before a place being put on it by hand", () => {
    const cancelled = vi.fn();
    show(
      <MapCanvas
        spots={[]}
        towns={[]}
        moves={null}
        people={people}
        colourOf={() => null}
        faded={null}
        selectedId={null}
        target={null}
        placing="Kampung Laut, Tumpat"
        onPlace={() => {}}
        onCancelPlace={cancelled}
        generationOf={() => undefined}
      />,
    );
    act(() => openDialog());
    pressEsc();
    expect(dialog()).toBeNull();
    expect(cancelled).not.toHaveBeenCalled(); // before, it was put away with the dialog
    pressEsc();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
