import { describe, expect, it } from "vitest";
import { megabytes, packState } from "./mapPacks";
import type { MapPack } from "./types";

const world: MapPack = {
  key: "world",
  title: "The world",
  size: 45_058_792,
  minzoom: 0,
  maxzoom: 6,
  first: true,
  installed: false,
  fetching: false,
  done: 0,
  error: null,
};

describe("a pack, in words", () => {
  it("says sizes in megabytes, as the guide does", () => {
    expect(megabytes(45_058_792)).toBe("45 MB");
    expect(megabytes(337_704_723)).toBe("338 MB");
    expect(megabytes(0)).toBe("0 MB");
  });

  it("says how a pack stands on this computer", () => {
    expect(packState(world)).toBe("Not on this computer");
    expect(packState({ ...world, fetching: true, done: 12_000_000 })).toBe(
      "Fetching: 12 MB of 45 MB",
    );
    expect(packState({ ...world, installed: true })).toBe("On this computer");
    expect(packState({ ...world, error: "The world couldn't be fetched: no internet" })).toBe(
      "The world couldn't be fetched: no internet",
    );
  });
});
