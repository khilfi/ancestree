// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { keys } from "@/api/queries";
import type { Graph, TreeSettings } from "@/api/types";
import { colourer } from "@/features/tree/toFlow";
import { DRAWING } from "@/styles/drawing";
import graphFile from "./example-graph.json";
import { Timeline } from "./Timeline";

/*
 * The timeline, on the example family as the engine answers it
 * (`GET /api/graph`, 19 Nov 2026): the wheel goes down the list, and Ctrl+wheel zooms (your
 * answer of 19 Nov 2026); bars coloured as the tree is, with its key; names as on the tree,
 * the nickname after.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const graph = graphFile as unknown as Graph;

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
// A window's worth of timeline: jsdom lays nothing out.
const sizes = { clientWidth: 1200, clientHeight: 3000 };
const kept = Object.fromEntries(
  Object.keys(sizes).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
  ]),
);
beforeAll(() => {
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  }
});
afterAll(() => {
  for (const [key, descriptor] of Object.entries(kept)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function show(colours: TreeSettings["colours"] = "branch"): HTMLElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(keys.treeSettings, { centre: null, colours, married_in: "fans" });
  client.setQueryData(keys.me, { person: null });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <Timeline graph={graph} selectedId={null} onSelect={() => {}} />
      </QueryClientProvider>,
    ),
  );
  return container;
}

const lane = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label^="${name}"]`);
const years = (container: HTMLElement) =>
  [...container.querySelectorAll(".tabular-nums")].map((tick) => tick.textContent).join(" ");
const scroller = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".overflow-y-auto") as HTMLElement;
function wheel(target: HTMLElement, options: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...options });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("the timeline's wheel", () => {
  it("goes down the list, the years as they were", () => {
    const container = show();
    const before = years(container);
    // Left to the page, which scrolls the list down, as anywhere else. Before, it zoomed.
    const event = wheel(scroller(container), { deltaY: 120 });
    expect(event.defaultPrevented).toBe(false);
    expect(years(container)).toBe(before);
  });

  it("zooms with Ctrl, as a touchpad's pinch does, never the page", () => {
    const container = show();
    const before = years(container);
    const event = wheel(scroller(container), { deltaY: -240, ctrlKey: true, clientX: 600 });
    expect(event.defaultPrevented).toBe(true);
    expect(years(container)).not.toBe(before);
  });

  it("moves along the years with Shift, or a sideways swipe", () => {
    const container = show();
    const before = years(container);
    expect(wheel(scroller(container), { deltaY: 200, shiftKey: true }).defaultPrevented).toBe(true);
    const along = years(container);
    expect(along).not.toBe(before);
    wheel(scroller(container), { deltaX: 200 });
    expect(years(container)).not.toBe(along);
  });
});

describe("the timeline's people", () => {
  it("names each as the tree does, the nickname after", () => {
    const container = show();
    // Before, by their nickname alone: "Acan, 1938–2011".
    expect(lane(container, "Hassan bin Ismail “Acan”, 1938–2011")).not.toBeNull();
    expect(lane(container, "Osman bin Latif, 1938–2022")).not.toBeNull();
    expect(lane(container, "Acan,")).toBeNull();
  });

  it.each(["branch", "generation"] as const)(
    "colours each bar as the tree does, by %s",
    (colours) => {
      const container = show(colours);
      const tree = colourer(graph, colours, null);
      const bars = graph.people.filter((person) => !person.placeholder && person.born?.year);
      let seen = 0;
      for (const person of bars) {
        const found = container.querySelector(`button[aria-label^="${person.full_name}"]`);
        const bar = found?.querySelector<HTMLElement>("span.rounded-full");
        if (!bar) continue;
        seen += 1;
        const colour = tree(person.id) ?? DRAWING.line;
        // jsdom writes a hex colour in a gradient as rgb().
        const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16));
        expect(bar.style.background, person.full_name).toContain(`rgb(${r}, ${g}, ${b})`);
      }
      expect(seen).toBeGreaterThan(40);
    },
  );
});

describe("the timeline's key", () => {
  it("says what each branch's colour is, and the grey", () => {
    const key = show("branch").textContent ?? "";
    for (const branch of ["Acan", "Pak Ngah", "Mak Lang", "Pak Su"]) {
      expect(key).toContain(`${branch}'s branch`);
    }
    expect(key).toContain("the oldest generations, and families married in");
  });

  it("says each generation's colour", () => {
    const key = show("generation").textContent ?? "";
    for (const generation of [1, 2, 3, 4, 5, 6]) expect(key).toContain(`Generation ${generation}`);
  });

  it("shows the tree's own key for closeness, and none with no colours", () => {
    expect(show("closeness").textContent).toContain("Choose who you are");
    act(() => root?.unmount());
    expect(show("off").textContent).not.toContain("branch");
  });
});
