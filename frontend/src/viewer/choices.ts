import type { KinshipLanguage, TreeSettings } from "@/api/types";

/**
 * What someone looking at a view-only copy chooses for themselves: the colours, the language
 * of kinship words, who they are, and which family is at the centre. Kept in their browser,
 * never in the file, and per family, so a newer copy of the same family keeps them.
 * The copy works just as well without it: a private window may keep nothing.
 */
export type Choices = {
  colours?: TreeSettings["colours"];
  language?: KinshipLanguage;
  me?: string | null; // "Me", each viewer's own
  centre?: string | null; // null: the oldest ancestor; missing: the copy's own centre
};

let key = "ancestree-copy";
let remembered: Choices = {};

export function chooseFamily(family: string): void {
  key = `ancestree-copy:${family || "family"}`;
  try {
    remembered = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Choices;
  } catch {
    remembered = {};
  }
}

export function choices(): Choices {
  return remembered;
}

export function choose(next: Choices): void {
  remembered = { ...remembered, ...next };
  try {
    window.localStorage.setItem(key, JSON.stringify(remembered));
  } catch {
    // Not kept past this visit; the choice still holds until the page closes.
  }
}
