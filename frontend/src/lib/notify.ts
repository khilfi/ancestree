import { toast } from "sonner";
import type { Notice, RestoreResult, Suggestion } from "@/api/types";
import { askSamePerson, canAskSamePerson } from "./samePerson";

/** Long enough to read the message and reach its button. */
export const ACTION_MS = 8000;
export const UNDO_MS = 15_000;

/** Things worth a second look; the change itself was saved. Someone who may be in the tree
 *  already comes with Same person as…, where the family can be changed: the one already
 *  there is kept, with their links and history, and the one just added made one with them. */
export function showNotices(notices: Notice[]): void {
  for (const notice of notices) {
    const { person, other } = notice;
    const same = person && other && canAskSamePerson();
    toast.warning(notice.message, {
      duration: 8000,
      action: same
        ? { label: "Same person as…", onClick: () => askSamePerson(other, person) }
        : undefined,
    });
  }
}

/** "Are Hassan and Mariam married?" with a one-click answer. */
export function showSuggestions(suggestions: Suggestion[], marry: (s: Suggestion) => void): void {
  for (const suggestion of suggestions) {
    toast(suggestion.message, {
      duration: 15000,
      action: { label: "Yes, married", onClick: () => marry(suggestion) },
    });
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "Hassan is back, with 3 links", and a warning for links that couldn't come back. */
export function showRestored(result: RestoreResult, open?: (id: string) => void): void {
  const { person, restored_links: restored, skipped_links: skipped } = result;
  const links = restored ? `, with ${plural(restored, "link")}` : "";
  toast.success(`${person.full_name} is back${links}.`, {
    duration: open ? ACTION_MS : undefined,
    action: open ? { label: "Open", onClick: () => open(person.id) } : undefined,
  });
  if (skipped) {
    toast.warning(
      `${plural(skipped, "link")} couldn't come back: the other person, or the relationship kind, is gone.`,
      { duration: 10_000 },
    );
  }
}

export function showError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : "Something went wrong.");
}
