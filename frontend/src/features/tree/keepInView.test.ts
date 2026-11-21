import { describe, expect, it } from "vitest";
import { anyoneInView, nudge } from "./keepInView";

/*
 * The person clicked stays in view: when their panel opens, the canvas narrows from
 * the right, and the view moves just enough to keep them clear of its edge, with room below
 * them for + Parent, + Child and + Spouse.
 */

const CANVAS = { width: 926, height: 700 }; // 1366 less a panel of 440

describe("nudge", () => {
  it("leaves someone in view where they are", () => {
    expect(nudge({ left: 300, top: 200, right: 428, bottom: 312 }, CANVAS)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("brings someone under the panel back, just inside the edge", () => {
    // At 1,000 px across, before the panel opened: now under it.
    expect(nudge({ left: 1000, top: 200, right: 1128, bottom: 312 }, CANVAS)).toEqual({
      x: 926 - 48 - 1128,
      y: 0,
    });
  });

  it("brings someone at an edge in, on every side, with room below for the buttons", () => {
    expect(nudge({ left: 10, top: 20, right: 138, bottom: 132 }, CANVAS)).toEqual({
      x: 38,
      y: 28,
    });
    expect(nudge({ left: 300, top: 600, right: 428, bottom: 690 }, CANVAS)).toEqual({
      x: 0,
      y: 700 - 48 - 40 - 690,
    });
  });

  it("keeps them above the overview map, where they'd be over it", () => {
    // At the canvas's bottom left, 160 pixels wide, with 8 round it.
    const overview = { left: 4, top: 552, right: 192 };
    // Above it already, or beside it to its right: left as they are.
    expect(nudge({ left: 100, top: 300, right: 300, bottom: 400 }, CANVAS, overview)).toEqual({
      x: 0,
      y: 0,
    });
    expect(nudge({ left: 300, top: 560, right: 500, bottom: 600 }, CANVAS, overview)).toEqual({
      x: 0,
      y: 0,
    });
    // Over it: moved up, clear of it, with the room below for the buttons.
    expect(nudge({ left: 100, top: 500, right: 300, bottom: 530 }, CANVAS, overview)).toEqual({
      x: 0,
      y: 552 - 48 - 40 - 530,
    });
    // Brought in from the left edge, and so over it: moved up too.
    expect(nudge({ left: 10, top: 500, right: 138, bottom: 530 }, CANVAS, overview)).toEqual({
      x: 38,
      y: 552 - 48 - 40 - 530,
    });
  });

  it("keeps them above a corner on the right too", () => {
    const corner = { left: 700, top: 500, right: 926 };
    expect(nudge({ left: 300, top: 550, right: 500, bottom: 600 }, CANVAS, corner)).toEqual({
      x: 0,
      y: 0,
    });
    expect(nudge({ left: 600, top: 450, right: 800, bottom: 480 }, CANVAS, corner)).toEqual({
      x: 0,
      y: 500 - 48 - 40 - 480,
    });
  });

  it("leaves someone bigger than the canvas as they are", () => {
    expect(nudge({ left: -500, top: 0, right: 1500, bottom: 100 }, CANVAS).x).toBe(0);
  });
});

/*
 * Undo of adding someone the view had followed to a corner of their own, "Not linked yet", left
 * an empty canvas once the first view was close enough to read, the journeys' `undone`:
 * whether anyone is in view decides whether the first view comes back.
 */
describe("anyoneInView", () => {
  const at = (x: number, y: number) => ({ position: { x, y } });
  const view = { x: -1000, y: 0, zoom: 1 }; // looking at x from 1,000 to 1,926

  it("sees someone wholly or partly in view", () => {
    expect(anyoneInView([at(5000, 0), at(1200, 300)], view, CANVAS)).toBe(true);
    expect(anyoneInView([at(1900, 300)], view, CANVAS)).toBe(true); // their left edge
    expect(anyoneInView([at(950, 300)], view, CANVAS)).toBe(true); // their right edge
  });

  it("sees no one where everyone is off the canvas, on any side", () => {
    const away = [at(0, 0), at(2000, 300), at(1200, -500), at(1200, 800)];
    expect(anyoneInView(away, view, CANVAS)).toBe(false);
  });

  it("counts by the zoom, and by each one's own size where it's known", () => {
    expect(anyoneInView([at(400, 300)], { x: 0, y: 0, zoom: 2 }, CANVAS)).toBe(true);
    expect(anyoneInView([at(500, 300)], { x: 0, y: 0, zoom: 2 }, CANVAS)).toBe(false);
    const wide = { ...at(-300, 300), measured: { width: 400, height: 100 } };
    expect(anyoneInView([wide], { x: 0, y: 0, zoom: 1 }, CANVAS)).toBe(true);
  });
});
