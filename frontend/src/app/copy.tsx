import { createContext, type ReactNode, useContext } from "react";
import { useKeptByTheKeeper } from "@/api/familyFolder";

/** What relatives may do in a copy to edit, each switched on or off for it. */
export type CopyPermissions = {
  add: boolean; // people and links
  change: boolean; // details, kinds of link, birth order
  remove: boolean; // people and links, through the Trash
  stories: boolean; // life stories and their pictures
  photos: boolean;
};
export type CopyPermission = keyof CopyPermissions;

/** A copy to edit's own: whose it is, what they may do, and where its changes go back to. */
export type CopyEditing = {
  id: string; // the app keeps what the copy started from under this (DATA_DIR/copies/<id>)
  for: string; // who it was made for: their changes come back under this name
  may: CopyPermissions;
  made_at: string;
  saved_at: string | null; // when this file was saved from the copy; null: as the app made it
  hidden: string[]; // people whose details the copy hides: they can't be changed in it
};

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
  editing?: CopyEditing | null; // a copy to edit; none in a view-only copy
};

/** What happened to "Save a new copy". */
export type Saved = { saved: true; name: string } | { saved: false };

/** A copy to edit's controls, for its bar: its changes, and saving them. */
export type CopyControls = {
  subscribe: (listener: () => void) => () => void;
  changes: () => number; // since the file was opened or last saved
  keeping: () => boolean; // whether the browser keeps them as they're made
  carriedOn: () => string | null; // when the changes carried on from were kept
  save: () => Promise<Saved>;
  startAgain: () => Promise<void>; // forget what the browser kept, and open the file as it is
};

const CopyContext = createContext<CopyAbout | null>(null);
const ControlsContext = createContext<CopyControls | null>(null);

/** Set only in a copy (src/viewer/main.tsx); the app itself has none. */
export const CopyProvider = CopyContext.Provider;
export const CopyControlsProvider = ControlsContext.Provider;

/** The copy this is, or null in the app itself. */
export function useCopy(): CopyAbout | null {
  return useContext(CopyContext);
}

/** A copy to edit's controls, or null anywhere else. */
export function useCopyControls(): CopyControls | null {
  return useContext(ControlsContext);
}

/**
 * Whether a change can be made here: always in the app, never in a view-only copy, and in a copy
 * to edit when it allows that kind of change. With no `what`, any change at all,
 * such as Undo or putting someone at the centre.
 */
export function useCanEdit(what?: CopyPermission): boolean {
  const copy = useContext(CopyContext);
  // A relative's computer keeps the family as its keeper sends it: nothing changes it.
  const keptByTheKeeper = useKeptByTheKeeper(copy === null);
  if (copy === null) return !keptByTheKeeper;
  if (!copy.editing) return false;
  return what === undefined || copy.editing.may[what];
}

/** Whether a copy to edit hides this person's details, so they can't be changed in it. */
export function useHiddenHere(id: string): boolean {
  return useContext(CopyContext)?.editing?.hidden.includes(id) ?? false;
}

/**
 * Anything that adds, changes or deletes sits inside this, so a view-only copy leaves it out
 *, and a copy to edit leaves out what it doesn't allow (`what`). A copy refuses such a
 * change anyway; this keeps its buttons from showing.
 */
export function CanEdit({ what, children }: { what?: CopyPermission; children: ReactNode }) {
  return useCanEdit(what) ? children : null;
}

/** Only in the app itself, never in a copy: Settings, making copies, pins on the map. */
export function InAppOnly({ children }: { children: ReactNode }) {
  return useCopy() === null ? children : null;
}
