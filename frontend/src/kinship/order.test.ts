import { describe, expect, it } from "vitest";
import type { PartialDate } from "@/api/types";
import { compareBirths, compareSiblings, orderSiblings, type Sibling } from "./order";

const year = (y: number, qualifier: PartialDate["qualifier"] = "exact", to?: number) =>
  ({ year: y, qualifier, year_to: to ?? null }) as PartialDate;

const sib = (id: string, birth: PartialDate | null = null, birthOrder: number | null = null) =>
  ({ id, gender: "male", birth, birthOrder, tiebreak: id }) as Sibling;

const ids = (siblings: Sibling[]) => siblings.map((s) => s.id);

// As backend/tests/unit/test_birth_order.py checks the Python engine (#6 and #7).
describe("birth order in a copy's kinship engine", () => {
  it("is uncertain where about, before or between overlap", () => {
    expect(compareBirths(year(1960, "before"), year(1955))).toBeNull();
    expect(compareBirths(year(1950, "between", 1960), year(1955))).toBeNull();
    expect(compareBirths(year(1950, "about"), year(1953))).toBeNull();
    expect(compareBirths(year(1950, "after"), year(1955))).toBeNull();
    expect(compareBirths(year(1950, "before"), year(1955))).toBeLessThan(0);
    expect(compareBirths(year(1950, "about"), year(1960))).toBeLessThan(0);
    expect(compareBirths(year(1960, "after"), year(1955))).toBeGreaterThan(0);
  });

  it("keeps a hand-set order when a child is added, placing it by its date", () => {
    const a = sib("a", year(1962), 2);
    const b = sib("b", year(1965), 1);
    expect(ids(orderSiblings([a, b, sib("undated")])[0])).toEqual(["b", "a", "undated"]);
    expect(ids(orderSiblings([a, b, sib("eldest", year(1955))])[0])).toEqual(["eldest", "b", "a"]);
    expect(compareSiblings(a, b, [a, b, sib("c", year(1968))])).toBeGreaterThan(0);

    const first = sib("first", year(1960), 1);
    const second = sib("second", year(1965), 2);
    const third = sib("third", year(1970), 3);
    const added = sib("new", year(1967));
    const [ordered, decided] = orderSiblings([third, added, first, second]);
    expect(ids(ordered)).toEqual(["first", "second", "new", "third"]);
    expect(decided).toBe(true);
    expect(compareSiblings(added, second, ordered)).toBeGreaterThan(0);
    expect(compareSiblings(added, third, ordered)).toBeLessThan(0);
  });
});
