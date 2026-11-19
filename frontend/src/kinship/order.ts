/**
 * Birth order among brothers and sisters, as backend/src/ancestree/lineage/birth_order.py
 * decides it: dates where they can tell, a manual order for the rest. Since
 * 0.8.7, "about", "before", "after" and "between" decide only where they can't overlap,
 * and a manual order stays when a child is added.
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

/** "About 1950" could be any year from 1945 to 1955, as the backend has it (ABOUT_YEARS). */
const ABOUT_YEARS = 5;

type Day = [number, number, number];
const EARLIEST: Day = [0, 0, 0];
const LATEST: Day = [10_000, 13, 32];

function before(a: Day, b: Day): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
}

/** The first and last days a birth could have been on: a year alone is all of it; "about" is
 *  five years either side; "before" and "after" have no end on their side. */
function birthSpan(date: PartialDate | null): [Day, Day] | null {
  if (!date || date.year == null) return null;
  if (date.qualifier === "about") {
    return [
      [date.year - ABOUT_YEARS, 1, 1],
      [date.year + ABOUT_YEARS, 12, 31],
    ];
  }
  const lastYear = date.qualifier === "between" && date.year_to != null ? date.year_to : date.year;
  const first: Day = [date.year, date.month ?? 1, date.day ?? 1];
  const last: Day = [lastYear, date.month ?? 12, date.day ?? 31];
  if (date.qualifier === "before") return [EARLIEST, last];
  if (date.qualifier === "after") return [first, LATEST];
  return [first, last];
}

/** Negative if `a` was born first, positive if `b` was, null if the dates can't tell: they
 *  decide only where they can't overlap. */
export function compareBirths(a: PartialDate | null, b: PartialDate | null): number | null {
  const first = birthSpan(a);
  const second = birthSpan(b);
  if (!first || !second) return null;
  if (before(first[1], second[0])) return -1;
  if (before(second[1], first[0])) return 1;
  return null;
}

function byManualOrder(a: Sibling, b: Sibling): number | null {
  if (a.birthOrder == null || b.birthOrder == null || a.birthOrder === b.birthOrder) return null;
  return a.birthOrder - b.birthOrder;
}

const everyOrdered = (family: readonly Sibling[]) => family.every((s) => s.birthOrder != null);
const anyOrdered = (family: readonly Sibling[]) => family.some((s) => s.birthOrder != null);

/** Negative if `a` is the elder of two children of the same parents, null if unknown. A child
 *  without a manual place among those with one is the elder only where its date agrees with
 *  where it's placed. */
export function compareSiblings(a: Sibling, b: Sibling, family: readonly Sibling[]): number | null {
  const byDates = compareBirths(a.birth, b.birth);
  const byHand = byManualOrder(a, b);
  if (everyOrdered(family)) return byHand;
  if (a.birthOrder != null && b.birthOrder != null) return byHand;
  if (byDates == null || !anyOrdered(family)) return byDates || byHand;
  const places = new Map(orderSiblings(family)[0].map((s, index) => [s.id, index]));
  const placeA = places.get(a.id);
  const placeB = places.get(b.id);
  if (placeA == null || placeB == null) return byDates;
  return byDates < 0 === placeA < placeB ? byDates : null;
}

/** Whether `a` is known to come before `b`: by hand when both are placed so, else by dates. */
function known(a: Sibling, b: Sibling): boolean {
  if (a.birthOrder != null && b.birthOrder != null) return (byManualOrder(a, b) ?? 0) < 0;
  return (compareBirths(a.birth, b.birth) ?? 0) < 0;
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
  const byTheirNumbers = (list: readonly Sibling[]) =>
    [...list].sort(
      (a, b) => (a.birthOrder ?? 0) - (b.birthOrder ?? 0) || compareText(a.tiebreak, b.tiebreak),
    );
  if (siblings.length && everyOrdered(siblings)) {
    // A complete manual order wins: it is also how wrong-looking dates get overruled.
    const ordered = byTheirNumbers(siblings);
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
  if (anyOrdered(siblings)) {
    // A manual order, then a child added: those placed by hand keep their order, and each of
    // the others goes in after the last one not born after it, or last if it has no date.
    const ordered = byTheirNumbers(siblings.filter((s) => s.birthOrder != null));
    const rest = siblings.filter((s) => s.birthOrder == null);
    for (const sibling of insertionSorted(rest, compare)) {
      let index = ordered.length;
      while (
        index > 0 &&
        (compareBirths((ordered[index - 1] as Sibling).birth, sibling.birth) ?? 0) > 0
      ) {
        index--;
      }
      ordered.splice(index, 0, sibling);
    }
    const decided = ordered.every(
      (sibling, index) => index === 0 || known(ordered[index - 1] as Sibling, sibling),
    );
    return [ordered, decided];
  }
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
