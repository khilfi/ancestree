import type { ImportChange } from "@/api/types";

/** Your ticks by change id; a change you haven't touched keeps the tick it came with. */
export type Ticks = Record<string, boolean>;

export function isTicked(change: ImportChange, ticks: Ticks): boolean {
  return ticks[change.id] ?? change.ticked;
}

export function tickedIds(changes: ImportChange[], ticks: Ticks): Set<string> {
  return new Set(changes.filter((change) => isTicked(change, ticks)).map((change) => change.id));
}

/** Why a ticked change can't happen, if it can't: a link needs the new people it joins, and
 *  goes when someone it joins is removed. As the app works it out (SheetPlan.carried_out). */
export function heldBack(
  change: ImportChange,
  ticked: Set<string>,
  names: Map<string, string>,
): string | null {
  const named = (ids: string[]) => ids.map((id) => names.get(id) ?? "someone").join(" and ");
  const missing = (change.needs ?? []).filter((id) => !ticked.has(id));
  if (missing.length > 0) return `needs ${named(missing)}, who isn't ticked`;
  const removing = (change.blocked_by ?? []).filter((id) => ticked.has(id));
  if (removing.length > 0) {
    return `${named(removing)} ${removing.length === 1 ? "is" : "are"} ticked to be removed`;
  }
  return null;
}

/** The changes an import carries out with these ticks. */
export function carriedOut(changes: ImportChange[], ticks: Ticks): Set<string> {
  const ticked = tickedIds(changes, ticks);
  const none = new Map<string, string>();
  return new Set(
    changes
      .filter((change) => ticked.has(change.id) && heldBack(change, ticked, none) === null)
      .map((change) => change.id),
  );
}

/** Everything that's yours to tick at once: all but what takes something out and the clashes,
 *  which only ever happen by their own tick. Or nothing at all. */
export function tickAll(changes: ImportChange[], on: boolean): Ticks {
  return Object.fromEntries(
    changes.map((change) => [change.id, on ? !change.removes && !change.clash : false]),
  );
}

/** The names a change is known by in "needs Siti" and "Latif is to be removed". */
export function changeNames(changes: ImportChange[]): Map<string, string> {
  return new Map(
    changes
      .filter((change) => change.kind === "add_person" || change.kind === "remove_person")
      .map((change) => [change.id, change.name]),
  );
}
