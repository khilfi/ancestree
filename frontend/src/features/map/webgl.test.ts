import { describe, expect, it } from "vitest";
import { drawnFromPacks } from "./webgl";

describe("which drawing the map shows", () => {
  const able = { inCopy: false, worldHere: true, webgl2: true, failed: false };

  it("is MapLibre's from the packs, in the app with the world's pack and WebGL 2", () => {
    expect(drawnFromPacks(able)).toBe(true);
  });

  it("is today's map otherwise: a copy, no pack yet, no WebGL 2, or WebGL lost", () => {
    expect(drawnFromPacks({ ...able, inCopy: true })).toBe(false);
    expect(drawnFromPacks({ ...able, worldHere: false })).toBe(false);
    expect(drawnFromPacks({ ...able, webgl2: false })).toBe(false);
    expect(drawnFromPacks({ ...able, failed: true })).toBe(false);
  });
});
