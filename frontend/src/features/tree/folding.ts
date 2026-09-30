/*
 * Which married-in families are unfolded: all of them, or none,
 * with exceptions made one family at a time by their +15 / − badges. Kept in this browser.
 */

export type Folding = { mode: "open" | "folded"; except: ReadonlySet<string> };

/** A family this big still opens folded, to keep it quick (D10: yours is under 100). */
export const BIG_FAMILY = 1000;

const KEY = "ancestree:tree-folding";

export function isOpen(folding: Folding, unit: string): boolean {
  return (folding.mode === "open") !== folding.except.has(unit);
}

/** The families shown unfolded, from all of them. */
export function openUnits(folding: Folding, units: readonly string[]): Set<string> {
  return new Set(units.filter((unit) => isOpen(folding, unit)));
}

/** One family's badge: fold it if open, unfold it if folded. */
export function toggled(folding: Folding, unit: string): Folding {
  const except = new Set(folding.except);
  if (except.has(unit)) except.delete(unit);
  else except.add(unit);
  return { ...folding, except };
}

/** These families unfolded, whatever they were: for search, the finder and the panel. */
export function unfolded(folding: Folding, units: readonly string[]): Folding {
  const closed = units.filter((unit) => !isOpen(folding, unit));
  return closed.length ? closed.reduce(toggled, folding) : folding;
}

export function everything(mode: Folding["mode"]): Folding {
  return { mode, except: new Set() };
}

/** Unfolded unless this browser remembers otherwise, or the family is big. */
export function initialFolding(stored: Folding | null, people: number): Folding {
  if (stored) return stored;
  return everything(people > BIG_FAMILY ? "folded" : "open");
}

export function loadFolding(): Folding | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { mode?: unknown; except?: unknown };
    if (saved.mode !== "open" && saved.mode !== "folded") return null;
    const except = Array.isArray(saved.except)
      ? saved.except.filter((unit): unit is string => typeof unit === "string")
      : [];
    return { mode: saved.mode, except: new Set(except) };
  } catch {
    return null; // private windows and blocked storage: the default will do
  }
}

export function saveFolding(folding: Folding): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ mode: folding.mode, except: [...folding.except] }),
    );
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
