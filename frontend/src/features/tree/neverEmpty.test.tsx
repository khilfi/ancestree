// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useNeverEmpty } from "./keepInView";

/*
 * Never an empty canvas after someone has gone from the tree: the first view comes back
 * when no one is left in view. Where the view is still gliding, as it does after the person
 * chosen, it's where it lands that counts. React Flow's view is made up here: where it is, and
 * when it starts and stops moving.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flow = vi.hoisted(() => ({
  view: { x: 0, y: 0, zoom: 1 },
  moves: {} as { onStart?: () => void; onEnd?: () => void },
}));
vi.mock("@xyflow/react", async (original) => ({
  ...(await original<typeof import("@xyflow/react")>()),
  useReactFlow: () => ({ getViewport: () => flow.view }),
  useOnViewportChange: (moves: typeof flow.moves) => {
    flow.moves = moves;
  },
}));

// A canvas 800 × 500: jsdom lays nothing out.
const sizes = { clientWidth: 800, clientHeight: 500 };
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

const near = { position: { x: 100, y: 100 } }; // in view where the view starts
const away = { position: { x: 3000, y: 100 } }; // in a corner of their own, far to the right
const THERE = { x: -2900, y: 0, zoom: 1 }; // the view on that corner

let root: Root | null = null;
const showFirst = vi.fn();
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  showFirst.mockReset();
  flow.view = { x: 0, y: 0, zoom: 1 };
  flow.moves = {};
});

function Canvas({ drawn }: { drawn: { position: { x: number; y: number } }[] }) {
  const box = useRef<HTMLDivElement>(null);
  useNeverEmpty(box, drawn, showFirst, false);
  return <div ref={box} />;
}

function draw(drawn: { position: { x: number; y: number } }[]) {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => root?.render(<Canvas drawn={drawn} />));
}

describe("useNeverEmpty", () => {
  it("brings the first view back once no one is left in view", () => {
    draw([near, away]);
    flow.view = THERE;
    draw([near]);
    expect(showFirst).toHaveBeenCalledExactlyOnceWith(500);
  });

  it("looks where the view lands, when someone goes as it glides", () => {
    // Undo twice, quickly: the view had begun to glide after her into her corner when Undo
    // took her away. Someone was still in view at that moment, so it stayed as it was, and
    // landed on an empty canvas (the journey on GitHub's Linux, 21 Nov 2026).
    draw([near, away]);
    act(() => flow.moves.onStart?.());
    draw([near]);
    expect(showFirst).not.toHaveBeenCalled();
    flow.view = THERE;
    act(() => flow.moves.onEnd?.());
    expect(showFirst).toHaveBeenCalledExactlyOnceWith(500);
  });

  it("waits for the second of two glides, when it cuts the first short", () => {
    // React Flow says a glide cut short has ended only after the next has begun.
    draw([near, away]);
    act(() => flow.moves.onStart?.());
    act(() => flow.moves.onStart?.());
    act(() => flow.moves.onEnd?.());
    draw([near]);
    expect(showFirst).not.toHaveBeenCalled();
    flow.view = THERE;
    act(() => flow.moves.onEnd?.());
    expect(showFirst).toHaveBeenCalledExactlyOnceWith(500);
  });

  it("leaves a view that lands with someone in it", () => {
    draw([near, away]);
    act(() => flow.moves.onStart?.());
    draw([near]);
    act(() => flow.moves.onEnd?.());
    expect(showFirst).not.toHaveBeenCalled();
  });

  it("never moves for your own panning, which draws no one fewer", () => {
    draw([near, away]);
    act(() => flow.moves.onStart?.());
    flow.view = THERE;
    act(() => flow.moves.onEnd?.());
    draw([near, away]);
    expect(showFirst).not.toHaveBeenCalled();
  });
});
