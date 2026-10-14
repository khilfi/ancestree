import { useSyncExternalStore } from "react";

/*
 * A life story's window, opened from wherever someone is:
 * Life story in their panel, the book mark on their photo on the tree, timeline and map, or a
 * relative named on another's page. The app and a view-only copy keep one host for it
 * (`LifeStoryHost`), which opens over everything.
 */

export type StoryMode = "read" | "write";
export type LifeStoryAsked = { person: string; mode: StoryMode | null } | null;

let asked: LifeStoryAsked = null;
const listeners = new Set<() => void>();

function tell(next: LifeStoryAsked): void {
  asked = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Open someone's life story: to read or to write, or, unsaid, to read where there's a story
 *  and to write where there isn't. */
export function openLifeStory(person: string, mode: StoryMode | null = null): void {
  tell({ person, mode });
}

export function closeLifeStory(): void {
  tell(null);
}

/** For the host: whose life story is open now, if anyone's. */
export function useLifeStoryAsked(): LifeStoryAsked {
  return useSyncExternalStore(subscribe, () => asked);
}
