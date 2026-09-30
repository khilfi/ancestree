import type { DictionaryRow, DictionaryWord, KinshipLanguage } from "@/api/types";

const LANGUAGES: readonly KinshipLanguage[] = ["en", "ms", "jv"];

/** Lower case, without accents, and Javanese dh and th as d and t, the way Indonesian
 *  spelling writes them: "Pakdhé", "pakdhe" and "Pakde" are the same to a search. */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/([dt])h/g, "$1")
    .trim();
}

/** Everything a row shows in a language, for searching. */
function wordsOf(word: DictionaryWord | undefined): string[] {
  if (!word) return [];
  return [
    word.word ?? "",
    ...(word.also ?? []),
    ...(word.address ?? []),
    word.krama ?? "",
    word.krama_inggil ?? "",
    word.note ?? "",
  ];
}

/** Whether a row matches a search, in its English description or any shown language's words:
 *  "pupu", "misanan" and "in-law" all find their rows. */
export function rowMatches(
  row: DictionaryRow,
  query: string,
  shown: readonly KinshipLanguage[],
): boolean {
  const wanted = normalise(query);
  if (!wanted) return true;
  const texts = [row.relation, ...shown.flatMap((code) => wordsOf(row.words[code]))];
  return texts.some((text) => normalise(text).includes(wanted));
}

/** The columns in order: the chosen kinship language first, then the others as usual. */
export function columnOrder(
  chosen: KinshipLanguage,
  shown: readonly KinshipLanguage[],
): KinshipLanguage[] {
  return [chosen, ...LANGUAGES.filter((code) => code !== chosen)].filter((code) =>
    shown.includes(code),
  );
}
