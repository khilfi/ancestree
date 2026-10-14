import { useSyncExternalStore } from "react";

/*
 * Same person as…, asked from wherever a duplicate shows: the warning when someone is
 * added who may be in the tree already, and What's missing's Possibly entered twice. The app
 * keeps one host for it (`SamePersonHost`); with none, in a view-only copy or where the family
 * can't be changed, nothing offers it.
 */

export type SamePersonAsked = { person: string; other: string } | null;

let asked: SamePersonAsked = null;
const listeners = new Set<() => void>();
let hosts = 0;

function tell(next: SamePersonAsked): void {
  asked = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask whether `person` is the same person as `other`: the dialog opens with both chosen. */
export function askSamePerson(person: string, other: string): void {
  tell({ person, other });
}

/** Whether Same person as… can be asked here: a host is there to open it. */
export function canAskSamePerson(): boolean {
  return hosts > 0;
}

/** What's asked now: the two to open the dialog with, or nothing. */
export function samePersonAsked(): SamePersonAsked {
  return asked;
}

/** For the host: what's asked now, its being there counted, and the asking done. */
export function useSamePersonAsked(): SamePersonAsked {
  return useSyncExternalStore(subscribe, samePersonAsked);
}

export function hostSamePerson(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
  };
}

export function answeredSamePerson(): void {
  tell(null);
}
