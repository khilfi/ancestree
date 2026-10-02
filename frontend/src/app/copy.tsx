import { createContext, type ReactNode, useContext } from "react";
import { useKeptByTheKeeper } from "@/api/familyFolder";

/** What a copy says about itself: shown in its top bar and About. */
export type CopyAbout = {
  title: string;
  made_at: string;
  people: number;
  hidden_living: boolean;
  archive: boolean; // whether the full archive is among its exports
  family: string;
  version: string;
  centres: string[]; // whom a viewer can put at the centre: the copy carries their seats
};

const CopyContext = createContext<CopyAbout | null>(null);

/** Set only in a copy (src/viewer/main.tsx); the app itself has none. */
export const CopyProvider = CopyContext.Provider;

/** The copy this is, or null in the app itself. */
export function useCopy(): CopyAbout | null {
  return useContext(CopyContext);
}

/**
 * Whether a change can be made here: in the app, unless it's a relative's computer that only
 * receives the family; never in a copy.
 */
export function useCanEdit(): boolean {
  const copy = useContext(CopyContext);
  // A relative's computer keeps the family as its keeper sends it: nothing changes it.
  const keptByTheKeeper = useKeptByTheKeeper(copy === null);
  return copy === null && !keptByTheKeeper;
}

/**
 * Anything that adds, changes or deletes sits inside this, so a copy leaves it out, and
 * so does a computer that only receives the family. A copy refuses such a change anyway; this
 * keeps its buttons from showing.
 */
export function CanEdit({ children }: { children: ReactNode }) {
  return useCanEdit() ? children : null;
}

/** Only in the app itself, never in a copy: Settings, making copies, pins on the map. */
export function InAppOnly({ children }: { children: ReactNode }) {
  return useCopy() === null ? children : null;
}
