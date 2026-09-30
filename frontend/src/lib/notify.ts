import { toast } from "sonner";
import type { Notice, RestoreResult, Suggestion } from "@/api/types";

/** Long enough to read the message and reach its button. */
export const ACTION_MS = 8000;
export const UNDO_MS = 15_000;

/** Things worth a second look; the change itself was saved. */
export function showNotices(notices: Notice[]): void {
  for (const notice of notices) toast.warning(notice.message, { duration: 8000 });
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
