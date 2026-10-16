// @vitest-environment jsdom
/**
 * A bundle that opens where it is, as both drawings of the
 * map, and a copy's, show it: a click opens three people 6 m apart, named by their eldest, each
 * a click from their panel, and Esc folds them back; a bundle spread over towns zooms in, with
 * Open here beside it; and forty open as a card, with Show them on the tree. People at one
 * spot are one pin, standing in columns above it on a click. Made-up people.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPerson } from "@/api/types";
import { onPlane } from "./geo";
import type { Group, Spot } from "./levels";
import { PIN } from "./levels";
import { FamilyPlaces, SpotPin } from "./places";

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

function show(people: GraphPerson[], spots: Spot[], deepest = false, pin = false) {
  const byId = new Map(spots.map((each) => [each.id, each]));
  // A bundle of towns; or, as `pin`, people at one spot, low enough for 8 to a column.
  const group: Group = pin
    ? {
        key: "spot:one",
        label: "No. 8, Jalan Kenari 2",
        at: { x: 400, y: 520 },
        members: people.map((person) => person.id),
        rough: false,
        towns: 1,
        about: false,
      }
    : {
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

describe("one spot, one pin, standing up in columns", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      someone(`p${index}`, `Orang ${index + 1} bin Ali`, 1940 + index),
    );
  const atOneSpot = (people: GraphPerson[]) => people.map((person) => spot(person.id, 0));
  const columns = () =>
    new Set(
      [...document.querySelectorAll<HTMLElement>('[role="dialog"] [data-someone]')].map(
        (node) => node.style.left,
      ),
    );

  it("shows three at one spot as one pin, and stands them in one column on a click", () => {
    show(THREE, atOneSpot(THREE), false, true);
    expect(document.body.textContent).toContain("Fatimah and 2 more");
    const pin = button(
      /^Fatimah, Aminah, Zulkifli · No\. 8, Jalan Kenari 2, Kajang, Hulu Langat\. Open$/,
    );
    expect(pin?.textContent).toContain("3"); // how many are there

    act(() => pin?.click());

    const stand = document.querySelector('[role="dialog"]');
    expect(stand?.textContent).toContain("No. 8, Jalan Kenari 2, Kajang, Hulu Langat");
    const nodes = [...(stand?.querySelectorAll<HTMLElement>("[data-someone]") ?? [])];
    expect(nodes.map((node) => node.lastElementChild?.textContent)).toEqual([
      "Fatimah",
      "Aminah",
      "Zulkifli",
    ]);
    expect(columns().size).toBe(1);
    const tops = nodes.map((node) => Number.parseFloat(node.style.top));
    expect(tops[0]).toBeLessThan(tops[1] ?? 0); // one above another, over the pin
    expect(Math.max(...tops)).toBeLessThan(520);
    key("ArrowDown", document.activeElement as Element);
    expect(document.activeElement?.lastElementChild?.textContent).toBe("Aminah");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(selected).toEqual(["ali"]);
    key("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("stands a house of twenty in three columns, and forty-one as a card", () => {
    show(many(20), atOneSpot(many(20)), false, true);
    act(() => button(/Open$/)?.click());
    expect(document.querySelectorAll('[role="dialog"] [data-someone]')).toHaveLength(20);
    expect(columns().size).toBe(3);
    act(() => root?.unmount());
    document.body.replaceChildren();

    show(many(41), atOneSpot(many(41)), false, true);
    act(() => button(/Open$/)?.click());
    expect(document.body.textContent).toContain("Show them on the tree");
    expect(document.querySelectorAll('[role="dialog"] [data-someone]')).toHaveLength(41);
  });

  it("opens someone alone at their spot with one click", () => {
    const one = [someone("mak", "Fatimah binti Yusof", 1941)];
    show(one, atOneSpot(one), false, true);
    act(() =>
      button(
        /Fatimah binti Yusof, No\. 8, Jalan Kenari 2, Kajang, Hulu Langat, exactly here/,
      )?.click(),
    );
    expect(selected).toEqual(["mak"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("a pin like Google Maps', only where confirmed", () => {
  const ONE = [someone("mak", "Fatimah binti Yusof", 1941)];
  const pinAt = (at: { x: number; y: number }, chosen = false) => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <SpotPin
          group={{
            key: "spot:mak",
            label: "No. 8, Jalan Kenari 2",
            at,
            members: ["mak"],
            rough: false,
            towns: 1,
            about: false,
          }}
          told={{ eldest: ["mak"], name: "Fatimah", few: "Fatimah" }}
          heading="No. 8, Jalan Kenari 2, Kajang, Hulu Langat"
          people={new Map(ONE.map((person) => [person.id, person]))}
          withNames
          colourOf={() => "#0f766e"}
          faded={null}
          selectedId={chosen ? "mak" : null}
          onOpen={() => {}}
        />,
      ),
    );
    return document.querySelector<HTMLElement>("[data-pin]")?.parentElement as HTMLElement;
  };

  it("stands its tip exactly on the spot, wherever the spot is on the screen", () => {
    for (const at of [
      { x: 400, y: 520 },
      { x: 12.25, y: 61.5 },
      { x: 1999.75, y: 1000 },
    ]) {
      const box = pinAt(at);
      // Its box placed so the tip of its outline, the round-joined stroke's edge, is on the
      // spot: the outline's point, plus half its stroke.
      const tip = box
        .querySelector("path")
        ?.getAttribute("d")
        ?.match(/^M([\d.]+) ([\d.]+)/);
      const outline = box.querySelector("path");
      expect(outline?.getAttribute("stroke-linejoin")).toBe("round");
      const edge = Number(tip?.[2]) + Number(outline?.getAttribute("stroke-width")) / 2;
      expect([Number(tip?.[1]), edge]).toEqual([PIN.tip.x, PIN.tip.y]);
      expect(Number.parseFloat(box.style.left) + PIN.tip.x).toBeCloseTo(at.x, 6);
      expect(Number.parseFloat(box.style.top) + PIN.tip.y).toBeCloseTo(at.y, 6);
      act(() => root?.unmount());
      document.body.replaceChildren();
    }
  });

  it("grows from its tip when chosen, so the tip stays on the spot", () => {
    const box = pinAt({ x: 400, y: 520 }, true);
    const pin = box.querySelector<HTMLElement>("[data-pin]");
    expect(pin?.className).toContain("origin-bottom"); // the tip is the box's bottom middle
    expect(PIN.tip).toEqual({ x: PIN.width / 2, y: PIN.height });
    expect(pin?.className).toContain("scale-115");
  });

  it("draws someone only about there as a round photo with its ring, never a pin", () => {
    const one = [someone("ali", "Aminah binti Hassan", 1962)];
    const byId = new Map([["ali", spot("ali", 0, { exact: "postcode" })]]);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <FamilyPlaces
          groups={[
            {
              key: "kajang",
              label: "Kajang",
              at: { x: 400, y: 300 },
              members: ["ali"],
              rough: false,
              towns: 1,
              about: true,
            },
          ]}
          level="towns"
          size={{ width: 800, height: 600 }}
          withNames={false}
          spacing={38}
          people={new Map(one.map((person) => [person.id, person]))}
          colourOf={() => null}
          faded={null}
          selectedId={null}
          onZoomInto={() => {}}
          spotOf={(id) => byId.get(id)}
          screenOf={() => null}
          generationOf={() => undefined}
          deepest={false}
        />,
      ),
    );
    expect(document.querySelector("[data-pin]")).toBeNull();
    expect(button(/about here$/)).toBeDefined();
  });
});
