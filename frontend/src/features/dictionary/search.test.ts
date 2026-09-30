import { describe, expect, it } from "vitest";
import type { DictionaryRow } from "@/api/types";
import { columnOrder, normalise, rowMatches } from "./search";

const uncle: DictionaryRow = {
  id: "uncle-elder",
  relation: "A parent's older brother",
  words: {
    en: {
      word: "uncle",
      descr: false,
      also: [],
      address: [],
      krama: null,
      krama_inggil: null,
      note: null,
    },
    ms: {
      word: "pak cik",
      descr: false,
      also: ["pak long, pak ngah … by his place", "bapa saudara (formal)"],
      address: ["Pak Long"],
      krama: null,
      krama_inggil: null,
      note: null,
    },
    jv: {
      word: "pakdhé",
      descr: false,
      also: ["siwa, uwa (older words)"],
      address: ["Pakdhé", "Wa"],
      krama: null,
      krama_inggil: null,
      note: null,
    },
  },
};

describe("searching the dictionary", () => {
  it("ignores case, accents, and the h of Javanese dh and th", () => {
    expect(normalise("  Pakdhé ")).toBe("pakde");
    expect(rowMatches(uncle, "pakde", ["jv"])).toBe(true); // as Indonesian spells it
    expect(rowMatches(uncle, "pakdhe", ["jv"])).toBe(true);
    expect(rowMatches(uncle, "PAK LONG", ["ms"])).toBe(true);
  });

  it("finds a row by its English description or any shown language's words", () => {
    expect(rowMatches(uncle, "older brother", [])).toBe(true);
    expect(rowMatches(uncle, "saudara", ["ms"])).toBe(true);
    expect(rowMatches(uncle, "uwa", ["jv"])).toBe(true);
  });

  it("only looks in the languages shown", () => {
    expect(rowMatches(uncle, "pakde", ["en", "ms"])).toBe(false);
    expect(rowMatches(uncle, "", [])).toBe(true); // nothing typed: every row
  });
});

describe("the columns", () => {
  it("put the chosen kinship language first", () => {
    expect(columnOrder("jv", ["en", "ms", "jv"])).toEqual(["jv", "en", "ms"]);
    expect(columnOrder("en", ["en", "ms", "jv"])).toEqual(["en", "ms", "jv"]);
  });

  it("leave out the hidden ones", () => {
    expect(columnOrder("ms", ["en", "jv"])).toEqual(["en", "jv"]);
  });
});
