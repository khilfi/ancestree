import { describe, expect, it } from "vitest";
import { ladderRows } from "./ladder";

describe("ladderRows", () => {
  it("draws both lines down from the shared ancestors, one row per generation", () => {
    // The plan's example: Ali and Nadia are second cousins; Iman is one generation below.
    const path = ["Ali", "Aminah", "Hassan", "Tok Ismail", "Rahman", "Siti", "Nadia", "Iman"];

    expect(ladderRows(path, 3, "once removed")).toEqual([
      { left: "Hassan", right: "Rahman", pair: false, note: null },
      { left: "Aminah", right: "Siti", pair: false, note: null },
      { left: "Ali", right: "Nadia", pair: true, note: null },
      { left: null, right: "Iman", pair: false, note: "one generation below: “once removed”" },
    ]);
  });

  it("puts the longer line on whichever side it is", () => {
    // Siti is Ali's mother's first cousin: Ali's line is the longer one.
    const path = ["Ali", "Aminah", "Hassan", "Tok Ismail", "Rahman", "Siti"];

    expect(ladderRows(path, 3, "once removed").map((row) => [row.left, row.right])).toEqual([
      ["Hassan", "Rahman"],
      ["Aminah", "Siti"],
      ["Ali", null],
    ]);
  });

  it("marks brothers and sisters as the pair, with the nephew below", () => {
    const rows = ladderRows(["Hassan", "Tok Ismail", "Rahman", "Siti"], 1, null);

    expect(rows).toEqual([
      { left: "Hassan", right: "Rahman", pair: true, note: null },
      { left: null, right: "Siti", pair: false, note: "one generation below" },
    ]);
  });
});
