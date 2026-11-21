import { createElement } from "react";
import { toast } from "sonner";
import { canTryAgain, inWords } from "@/api/errors";
import type { Notice, RestoreResult, Suggestion } from "@/api/types";
import { type NoteLine, NoteLines } from "./notes";
import { askSamePerson, canAskSamePerson } from "./samePerson";

/** Long enough to read the message and reach its button. */
export const ACTION_MS = 8000;
export const UNDO_MS = 15_000;
const NOTICE_MS = 8000;
const SUGGESTION_MS = 15_000;
const PLAIN_MS = 4000; // a note with nothing to click, as Sonner has it

/** What came of an action, besides its own words: what's worth a second look, what's
 *  asked, and its own button, such as Undo or Open. */
export type Done = {
  /** Worth a second look; the change itself was saved. */
  notices?: Notice[];
  /** "Are Hassan and Mariam married?", answered by `marry`. */
  suggestions?: Suggestion[];
  marry?: (suggestion: Suggestion) => void;
  /** Said under it as they are, each worth a second look. */
  warnings?: string[];
  action?: { label: string; onClick: () => void };
  duration?: number;
};

/** Someone who may be in the tree already comes with Same person as…, where the family can be
 *  changed: the one already there is kept, with their links and history, and the one
 *  just added made one with them. */
function noticeLine({ message, person, other }: Notice): NoteLine {
  const same = person && other && canAskSamePerson();
  return {
    words: message,
    warning: true,
    button: same
      ? { label: "Same person as…", onClick: () => askSamePerson(other, person) }
      : undefined,
  };
}

/**
 * One action, one note: what was done, and under it anything worth a second look
 * and anything asked, each with its button, its own button (Undo, Open) beside it. One action
 * once raised a note for each, three or more, which pushed its Undo out of sight. It stays for
 * as long as the longest of them would have.
 */
export function showDone(message: string, done: Done = {}): void {
  const { notices = [], suggestions = [], warnings = [], marry, action } = done;
  const lines: NoteLine[] = [
    ...notices.map(noticeLine),
    ...warnings.map((words) => ({ words, warning: true })),
    ...suggestions.map((suggestion) => ({
      words: suggestion.message,
      button: marry ? { label: "Yes, married", onClick: () => marry(suggestion) } : undefined,
    })),
  ];
  const duration = Math.max(
    done.duration ?? (action ? ACTION_MS : PLAIN_MS),
    notices.length || warnings.length ? NOTICE_MS : 0,
    suggestions.length ? SUGGESTION_MS : 0,
  );
  let id: string | number = "";
  const close = () => toast.dismiss(id);
  id = toast.success(message, {
    description: lines.length ? createElement(NoteLines, { lines, close }) : undefined,
    duration,
    action,
  });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "Hassan is back, with 3 links", with what couldn't come back said in the same note. */
export function showRestored(result: RestoreResult, open?: (id: string) => void): void {
  const { person, restored_links: restored, skipped_links: skipped } = result;
  const links = restored ? `, with ${plural(restored, "link")}` : "";
  const warnings = [
    ...(skipped
      ? [
          `${plural(skipped, "link")} couldn't come back: the other person, or the relationship kind, is gone.`,
        ]
      : []),
    // A link the rules refuse stays out, and is said: "Hassan's link to Ali can't come back: …"
    ...(result.left_out ?? []),
  ];
  showDone(`${person.full_name} is back${links}.`, {
    warnings,
    duration: warnings.length ? 15_000 : undefined,
    action: open ? { label: "Open", onClick: () => open(person.id) } : undefined,
  });
}

/** What went wrong, in words: never "Failed to fetch" or a code. */
export function showError(error: unknown): void {
  toast.error(inWords(error));
}

/** What went wrong, with **Try again** where the engine didn't answer, or failed on its side,
 *  for what can simply be done again: "AncesTree's engine isn't answering. Try again". */
export function offerTryAgain(error: unknown, again: () => void): void {
  toast.error(inWords(error), {
    duration: canTryAgain(error) ? ACTION_MS : undefined,
    action: canTryAgain(error) ? { label: "Try again", onClick: again } : undefined,
  });
}
