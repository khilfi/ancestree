import type { GraphPerson } from "@/api/types";

/*
 * People possibly entered twice, for What's missing: two relatives who each added the
 * same grandfather, or an import whose look-alike question was answered "Someone new".
 */

// Years apart that a slip or a guessed year explains; more than this, and they're two people.
const NEAR = 2;

/** "Ali bin Hassan" and "ali  bin hassan" are one name: capitals and spaces aside. */
function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function born(person: GraphPerson): number | null {
  return person.born?.year ?? person.birth_year ?? null;
}

/** Which of two to keep, so the other's details come across: one with a photo, then one
 *  with a birth year. */
function fuller(person: GraphPerson): number {
  return (person.photo_version != null ? 2 : 0) + (born(person) != null ? 1 : 0);
}

/**
 * Pairs that may be one person: the same name, and birth years no more than NEAR apart, or
 * not known for one or both. Unknown parents never count. Each pair once, the one to keep
 * first, in name order.
 */
export function enteredTwice(people: readonly GraphPerson[]): [GraphPerson, GraphPerson][] {
  const byName = new Map<string, GraphPerson[]>();
  for (const person of people) {
    if (person.placeholder) continue;
    const key = nameKey(person.full_name);
    byName.set(key, [...(byName.get(key) ?? []), person]);
  }
  const pairs: [GraphPerson, GraphPerson][] = [];
  for (const [, same] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    for (let i = 0; i < same.length; i++) {
      for (let j = i + 1; j < same.length; j++) {
        const a = same[i] as GraphPerson;
        const b = same[j] as GraphPerson;
        const [one, two] = [born(a), born(b)];
        if (one != null && two != null && Math.abs(one - two) > NEAR) continue;
        pairs.push(fuller(b) > fuller(a) ? [b, a] : [a, b]);
      }
    }
  }
  return pairs;
}
