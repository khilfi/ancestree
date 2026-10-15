// @vitest-environment jsdom
/**
 * A bundle that opens where it is, as both drawings of the
 * map, and a copy's, show it: a click opens three people 6 m apart, named by their eldest, each
 * a click from their panel, and Esc folds them back; a bundle spread over towns zooms in, with
 * Open here beside it; and forty open as a card, with Show them on the tree. Made-up people.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPerson } from "@/api/types";
import { onPlane } from "./geo";
import type { Group, Spot } from "./levels";
import { FamilyPlaces } from "./places";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const METRE = 1 / 111_320;
function spot(id: string, metresNorth: number, more: Partial<Spot> = {}): Spot {
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
    ...more,
  };
}
const someone = (id: string, full_name: string, birth_year: number | null = null) =>
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

let root: Root | undefined;
let zoomed: Group[] = [];
let selected: string[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  zoomed = [];
  selected = [];
});

function Tree() {
  return <p>tree{useLocation().search}</p>;
}

function show(people: GraphPerson[], spots: Spot[], deepest = false) {
  const byId = new Map(spots.map((each) => [each.id, each]));
  const group: Group = {
    key: "bundle",
    label: "Kajang",
    at: { x: 400, y: 300 },
    members: people.map((person) => person.id),
    rough: false,
    towns: people.length,
  };
  const element = (
    <FamilyPlaces
      groups={[group]}
      level="towns"
      size={{ width: 800, height: 600 }}
      withNames={false}
      spacing={38}
      people={new Map(people.map((person) => [person.id, person]))}
      colourOf={() => null}
      faded={null}
      selectedId={null}
      onSelect={(id) => selected.push(id)}
      onZoomInto={(g) => zoomed.push(g)}
      spotOf={(id) => byId.get(id)}
      screenOf={(id) => (byId.has(id) ? { x: 400, y: 300 } : null)}
      generationOf={() => undefined}
      deepest={deepest}
    />
  );
  const router = createMemoryRouter([
    { path: "/", element },
    { path: "/tree", element: <Tree /> },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<RouterProvider router={router} />));
}

const button = (label: RegExp | string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
    typeof label === "string"
      ? each.textContent?.trim() === label
      : label.test(each.getAttribute("aria-label") ?? each.textContent ?? ""),
  );
const key = (name: string, target: Element | Window = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });

const THREE = [
  someone("ali", "Aminah binti Hassan", 1962),
  someone("nora", "Zulkifli bin Hassan", 1965),
  someone("mak", "Fatimah binti Yusof", 1941),
];

describe("a bundle that opens where it is", () => {
  it("is named by its eldest, and opens with one click, each a click from their panel", () => {
    show(THREE, [spot("ali", 0), spot("nora", 6), spot("mak", 3)]);
    expect(document.body.textContent).toContain("Fatimah and 2 more");
    expect(document.body.textContent).not.toContain("Kajang and");
    const circle = button(/^Fatimah, Aminah, Zulkifli · Kajang, Hulu Langat\. Open$/);
    expect(circle?.title).toBe("Fatimah, Aminah, Zulkifli · Kajang, Hulu Langat");

    act(() => circle?.click());

    expect(zoomed).toEqual([]);
    const fan = document.querySelector('[role="dialog"]');
    expect(fan?.getAttribute("aria-label")).toBe("Fatimah and 2 more, Kajang, Hulu Langat");
    // The name under each photo, after the photo's own initials.
    const named = (element: Element | null | undefined) => element?.lastElementChild?.textContent;
    const names = [...(fan?.querySelectorAll("[data-someone]") ?? [])].map(named);
    expect(names).toEqual(["Fatimah", "Aminah", "Zulkifli"]);
    expect(fan?.querySelectorAll("line")).toHaveLength(3); // each to where they really are
    expect(named(document.activeElement)).toBe("Fatimah");
    key("ArrowRight", document.activeElement as Element);
    expect(named(document.activeElement)).toBe("Aminah");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(selected).toEqual(["ali"]);

    key("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("zooms in where that would part them, with Open here beside it", () => {
    show(THREE, [spot("ali", 0), spot("nora", 6), spot("mak", 5000, { place: "Klang" })]);
    const circle = button(/Zoom in$/);
    act(() => circle?.click());
    expect(zoomed).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    act(() => button("Open here")?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    // A click anywhere else folds it back.
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens at the map's deepest, wherever they are", () => {
    show(THREE, [spot("ali", 0), spot("nora", 6), spot("mak", 5000)], true);
    act(() => button(/Open$/)?.click());
    expect(zoomed).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("opens forty as a card, with their places, and shows them on the tree", async () => {
    const forty = Array.from({ length: 40 }, (_, index) =>
      someone(`p${index}`, `Orang ${index + 1} bin Ali`, 1940 + index),
    );
    show(
      forty,
      forty.map((person, index) => spot(person.id, index % 10)),
    );
    act(() => button(/Open$/)?.click());

    const card = document.querySelector('[role="dialog"]');
    expect(card?.querySelectorAll("[data-someone]")).toHaveLength(40);
    expect(card?.textContent).toContain("Orang 1 and 39 more");
    expect(card?.textContent).toContain("No. 8, Jalan Kenari 2 · Kajang, Hulu Langat");
    act(() => button("Show them on the tree")?.click());
    await vi.waitFor(() => expect(document.body.textContent).toContain("tree?who=p0,p1,p2"));
    expect(document.body.textContent?.split(",")).toHaveLength(40);
  });
});
