/**
 * Finding people by name in a view-only copy: the app's own rule
 * (backend/src/ancestree/domain/search.py), tested on the same searches (search-cases.json), so
 * a copy finds what the app finds, in the same order.
 */

const WORD = /[\p{L}\p{N}]+/gu; // letters and digits, as the app's [^\W_]+

export function words(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

function flat(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type Findable = {
  id: string;
  full_name: string;
  nickname: string | null;
  placeholder?: boolean;
};

/** Everyone whose name or nickname has a word starting with each word typed; names that start
 *  with what was typed first, then A to Z. With nothing typed, everyone, A to Z. */
export function findPeople<T extends Findable>(people: T[], text: string, limit: number): T[] {
  const wanted = words(text);
  const typed = flat(text);
  const found: { rank: number; name: string; person: T }[] = [];
  for (const person of people) {
    if (person.placeholder) continue;
    const nickname = person.nickname ?? "";
    const names = [...words(person.full_name), ...words(nickname)];
    if (!wanted.every((part) => names.some((word) => word.startsWith(part)))) continue;
    const first =
      wanted.length > 0 &&
      (flat(person.full_name).startsWith(typed) ||
        (nickname !== "" && flat(nickname).startsWith(typed)));
    found.push({ rank: first ? 0 : 1, name: person.full_name.toLowerCase(), person });
  }
  found.sort(
    (a, b) => a.rank - b.rank || compare(a.name, b.name) || compare(a.person.id, b.person.id),
  );
  return found.slice(0, limit).map((item) => item.person);
}
