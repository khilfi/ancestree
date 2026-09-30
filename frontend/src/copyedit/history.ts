/**
 * Undo and Redo in a copy to edit, as services/history.py keeps them in the app: each
 * change is a step holding what it touched, as it was before and after; moving someone to the
 * Trash and back are steps done through the Trash. Only the latest step can be undone, and only
 * while what it touched is still as it left it. They last as long as the page is open, as the
 * app's last until it restarts.
 */
import type { HistoryStep, HistoryView } from "@/api/types";
import type { LinkRecord, PersonRecord } from "./family";
import { Refusal, refuse } from "./rules";
import { type Images, newId, stamp } from "./state";

export const LIMIT = 100;
const BOOKKEEPING = new Set(["updated_at"]); // stamped afresh by every change; never undone

export type Step = {
  id: string;
  label: string;
  at: string;
  people: Images<PersonRecord>;
  links: Images<LinkRecord>;
  trash?: { direction: "out" | "in"; person: string };
};

export function step(
  label: string,
  people: Images<PersonRecord>,
  links: Images<LinkRecord>,
  trash?: Step["trash"],
): Step {
  return { id: newId(), label, at: stamp(), people, links, trash };
}

/** What a step changed on someone: the properties that differ, bookkeeping aside. */
export function changedKeys(before: PersonRecord | null, after: PersonRecord | null): string[] {
  if (!before || !after)
    return Object.keys(before ?? after ?? {}).filter((key) => !BOOKKEEPING.has(key));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) =>
      !BOOKKEEPING.has(key) &&
      JSON.stringify(before[key as keyof PersonRecord]) !==
        JSON.stringify(after[key as keyof PersonRecord]),
  );
}

export class CantUndo extends Refusal {
  constructor(reason: string) {
    super(409, "cant_undo", `This can't be undone any more: ${reason}.`);
  }
}

export class History {
  private undone: Step[] = [];
  private done: Step[] = [];

  view(): HistoryView {
    const view = (step: Step | undefined): HistoryStep | null =>
      step ? { id: step.id, label: step.label, at: step.at } : null;
    return { undo: view(this.done.at(-1)), redo: view(this.undone.at(-1)) };
  }

  push(next: Step): void {
    if (!next.people.size && !next.links.size && !next.trash) return;
    this.done.push(next);
    this.done.splice(0, Math.max(0, this.done.length - LIMIT));
    this.undone = [];
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }

  /** The step to undo (or redo), checked against the one the button showed. */
  next(forward: boolean, expect: string | null): Step {
    const source = forward ? this.undone : this.done;
    const latest = source.at(-1);
    if (!latest) throw refuse("nothing", `There's nothing to ${forward ? "redo" : "undo"}.`);
    if (expect !== null && latest.id !== expect) {
      throw refuse("not_latest", "Something else has been changed since.");
    }
    return latest;
  }

  /** The step was undone (or redone): it moves to the other list. */
  moved(forward: boolean): Step {
    const [source, target] = forward ? [this.undone, this.done] : [this.done, this.undone];
    const moving = source.pop() as Step;
    target.push(moving);
    return moving;
  }
}
