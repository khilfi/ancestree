/**
 * Birth order among brothers and sisters, as backend/src/ancestree/lineage/birth_order.py
 * decides it: dates where they can tell, a manual order for the rest.
 */
import type { Gender, PartialDate } from "@/api/types";
import { compareText } from "./compare";

export type Sibling = {
  id: string;
  gender: Gender;
  birth: PartialDate | null;
  birthOrder: number | null;
  tiebreak: string; // a stable order when nothing else decides
};

/** Negative if `a` was born first, positive if `b` was, null if the dates can't tell: they
 *  decide only at the precision both have. */
export function compareBirths(a: PartialDate | null, b: PartialDate | null): number | null {
  if (!a || !b || a.year == null || b.year == null) return null;
  if (a.year !== b.year) return a.year - b.year;
  if (a.month == null || b.month == null) return null;
  if (a.month !== b.month) return a.month - b.month;
  if (a.day == null || b.day == null || a.day === b.day) return null;
  return a.day - b.day;
}

function byManualOrder(a: Sibling, b: Sibling): number | null {
  if (a.birthOrder == null || b.birthOrder == null || a.birthOrder === b.birthOrder) return null;
  return a.birthOrder - b.birthOrder;
}

const everyOrdered = (family: readonly Sibling[]) => family.every((s) => s.birthOrder != null);

/** Negative if `a` is the elder of two children of the same parents, null if unknown. */
export function compareSiblings(a: Sibling, b: Sibling, family: readonly Sibling[]): number | null {
  const byDates = compareBirths(a.birth, b.birth);
  const byHand = byManualOrder(a, b);
  if (everyOrdered(family)) return byHand;
  return byDates || byHand;
}

/** Sorted and stable by one simple rule, as the Python engine sorts them: each in turn goes
 *  after the last one not greater than it. */
function insertionSorted(
  siblings: readonly Sibling[],
  compare: (a: Sibling, b: Sibling) => number,
) {
  const ordered: Sibling[] = [];
  for (const sibling of siblings) {
    let index = ordered.length;
    while (index > 0 && compare(ordered[index - 1] as Sibling, sibling) > 0) index--;
    ordered.splice(index, 0, sibling);
  }
  return ordered;
}

/** Eldest first, and whether every step of that order is actually known. */
export function orderSiblings(siblings: readonly Sibling[]): [Sibling[], boolean] {
  if (siblings.length && everyOrdered(siblings)) {
    // A complete manual order wins: it is also how wrong-looking dates get overruled.
    const ordered = [...siblings].sort(
      (a, b) => (a.birthOrder ?? 0) - (b.birthOrder ?? 0) || compareText(a.tiebreak, b.tiebreak),
    );
    const decided = ordered.every(
      (sibling, index) =>
        index === 0 || byManualOrder(ordered[index - 1] as Sibling, sibling) != null,
    );
    return [ordered, decided];
  }
  const compare = (a: Sibling, b: Sibling): number => {
    const decided = compareBirths(a.birth, b.birth) || byManualOrder(a, b);
    if (decided) return decided;
    const datedA = a.birth?.year != null;
    const datedB = b.birth?.year != null;
    if (datedA !== datedB) return datedA ? -1 : 1;
    return Math.sign(compareText(a.tiebreak, b.tiebreak));
  };
  const ordered = insertionSorted(siblings, compare);
  const decided = ordered.every(
    (sibling, index) =>
      index === 0 ||
      (compareBirths((ordered[index - 1] as Sibling).birth, sibling.birth) ||
        byManualOrder(ordered[index - 1] as Sibling, sibling) ||
        0) < 0,
  );
  return [ordered, decided];
}
