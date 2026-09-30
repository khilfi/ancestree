/**
 * Ordering as the Python engine orders things: answers depend on which
 * of two equally good ways comes first, so the twin sorts exactly as Python does.
 */

const SURROGATE = /[\uD800-\uDFFF]/;

/** Python's str.casefold, for sorting by name: lower case, with the letters it folds further. */
export function casefold(text: string): string {
  return text.toLowerCase().replaceAll("ß", "ss").replaceAll("ς", "σ");
}

/** Python's order for text: by code point. JavaScript's own order (UTF-16 units) differs only
 *  beyond U+FFFF. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  if (!SURROGATE.test(a) && !SURROGATE.test(b)) return a < b ? -1 : 1;
  const x = Array.from(a, (char) => char.codePointAt(0) ?? 0);
  const y = Array.from(b, (char) => char.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(x.length, y.length); index++) {
    const step = (x[index] ?? 0) - (y[index] ?? 0);
    if (step) return step;
  }
  return x.length - y.length;
}

/** A sort key as Python compares them: numbers, text, booleans (False first), and tuples or
 *  lists of those, element by element, a shorter one first when it's the start of the other. */
export type Key = number | string | boolean | null | readonly Key[];

export function compareKeys(a: Key, b: Key): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const x = a as readonly Key[];
    const y = b as readonly Key[];
    for (let index = 0; index < Math.min(x.length, y.length); index++) {
      const step = compareKeys(x[index] ?? null, y[index] ?? null);
      if (step) return step;
    }
    return x.length - y.length;
  }
  if (typeof a === "string" && typeof b === "string") return compareText(a, b);
  return Number(a) - Number(b);
}

/** Python's sorted(items, key=…): stable, each key worked out once. */
export function sortedBy<T>(items: Iterable<T>, key: (item: T) => Key): T[] {
  return Array.from(items, (item, index) => ({ item, index, key: key(item) }))
    .sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index)
    .map(({ item }) => item);
}

/** Python's min(items, key=…): the first of the smallest. */
export function minBy<T>(items: Iterable<T>, key: (item: T) => Key): T | undefined {
  let best: { item: T; key: Key } | undefined;
  for (const item of items) {
    const candidate = key(item);
    if (!best || compareKeys(candidate, best.key) < 0) best = { item, key: candidate };
  }
  return best?.item;
}
