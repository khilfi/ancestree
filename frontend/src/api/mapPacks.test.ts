import { describe, expect, it } from "vitest";
import { countryState, megabytes, packState, sizeOf } from "./mapPacks";
import type { MapCountry, MapPack } from "./types";

const world: MapPack = {
  key: "world",
  title: "The world",
  country: "",
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
  it("says sizes in megabytes, as the guide does, and past a thousand in gigabytes", () => {
    expect(megabytes(45_058_792)).toBe("45 MB");
    expect(megabytes(337_704_723)).toBe("338 MB");
    expect(megabytes(0)).toBe("0 MB");
    expect(sizeOf(337_704_723)).toBe("338 MB");
    expect(sizeOf(999_400_000)).toBe("999 MB");
    expect(sizeOf(1_300_000_000)).toBe("1.3 GB");
    expect(sizeOf(8_213_000_000)).toBe("8.2 GB");
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

describe("a country, from its packs", () => {
  const state = (key: string, more: Partial<MapPack> = {}): MapPack => ({
    ...world,
    key,
    title: key,
    country: "us",
    size: 500_000_000,
    first: false,
    ...more,
  });
  const usa: MapCountry = {
    key: "us",
    title: "United States",
    continent: "North America",
    packs: ["us-ca", "us-ny", "us-tx"],
  };
  const of = (...packs: MapPack[]) =>
    countryState(usa, new Map(packs.map((pack) => [pack.key, pack])));

  it("is all of it here, some of its states, or none", () => {
    const none = of(state("us-ca"), state("us-ny"), state("us-tx"));
    expect([none.words, none.size, none.some, none.installed]).toEqual([
      "Not on this computer",
      1_500_000_000,
      false,
      false,
    ]);
    const some = of(state("us-ca"), state("us-ny"), state("us-tx", { installed: true }));
    expect([some.words, some.some, some.installed]).toEqual([
      "1 of its 3 states on this computer",
      true,
      false,
    ]);
    const all = of(...usa.packs.map((key) => state(key, { installed: true })));
    expect([all.words, all.installed]).toEqual(["On this computer", true]);
  });

  it("counts what's here already in what's fetched so far, and says why one failed", () => {
    const going = of(
      state("us-ca", { fetching: true, done: 100_000_000 }),
      state("us-ny"),
      state("us-tx", { installed: true }),
    );
    expect([going.words, going.fetching, going.error]).toEqual([
      "Fetching: 600 MB of 1.5 GB",
      true,
      null,
    ]);
    const failed = of(state("us-ca", { error: "us-ca couldn't be fetched" }), state("us-ny"));
    expect(failed.words).toBe("us-ca couldn't be fetched");
  });
});
