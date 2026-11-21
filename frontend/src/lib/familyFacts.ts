import { useSyncExternalStore } from "react";

/*
 * Family facts, opened from the ⓘ beside the family's name: its
 * facts, and What's missing beside them as its second tab, which left Settings.
 * One host for it (`AppLayout`), opened from anywhere: the ⓘ, an import's note, or one of
 * What's missing's old addresses, /settings/missing and /missing.
 */

export type FactsTab = "facts" | "missing";

let open: FactsTab | null = null;
const listeners = new Set<() => void>();

function tell(next: FactsTab | null): void {
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Open Family facts at a tab: its facts, or What's missing. */
export function openFamilyFacts(tab: FactsTab = "facts"): void {
  tell(tab);
}

export function closeFamilyFacts(): void {
  tell(null);
}

/** For the host: which tab is open, or null while it's closed. */
export function useFamilyFactsOpen(): FactsTab | null {
  return useSyncExternalStore(subscribe, () => open);
}
