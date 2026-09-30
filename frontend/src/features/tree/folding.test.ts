import { describe, expect, it } from "vitest";
import {
  BIG_FAMILY,
  everything,
  initialFolding,
  isOpen,
  openUnits,
  toggled,
  unfolded,
} from "./folding";

const UNITS = ["cluster:wife", "cluster:husband", "cluster:inlaw"];

describe("folding", () => {
  it("opens every family by default, and folds them all only for a big family", () => {
    expect(openUnits(initialFolding(null, 89), UNITS)).toEqual(new Set(UNITS));
    expect(openUnits(initialFolding(null, BIG_FAMILY + 1), UNITS)).toEqual(new Set());
  });

  it("keeps what this browser remembers", () => {
    const remembered = toggled(everything("open"), "cluster:wife");
    expect(initialFolding(remembered, 89)).toBe(remembered);
  });

  it("lets one family's badge fold or unfold it, whatever the rest do", () => {
    const one = toggled(everything("open"), "cluster:wife");
    expect(isOpen(one, "cluster:wife")).toBe(false);
    expect(isOpen(one, "cluster:husband")).toBe(true);
    expect(isOpen(toggled(one, "cluster:wife"), "cluster:wife")).toBe(true);

    const other = toggled(everything("folded"), "cluster:inlaw");
    expect(openUnits(other, UNITS)).toEqual(new Set(["cluster:inlaw"]));
  });

  it("unfolds the families someone needs, and leaves the rest as they were", () => {
    const folded = everything("folded");
    const shown = unfolded(folded, ["cluster:wife", "cluster:inlaw"]);
    expect(openUnits(shown, UNITS)).toEqual(new Set(["cluster:wife", "cluster:inlaw"]));
    expect(unfolded(shown, ["cluster:wife"])).toBe(shown);

    const open = toggled(everything("open"), "cluster:wife");
    expect(openUnits(unfolded(open, ["cluster:wife"]), UNITS)).toEqual(new Set(UNITS));
  });
});
