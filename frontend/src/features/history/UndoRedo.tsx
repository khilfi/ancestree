import { Redo2Icon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useHistory, useHistoryMove } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { typing } from "@/lib/keyboard";
import { ACTION_MS, showError } from "@/lib/notify";

type Direction = "undo" | "redo";

/**
 * Undo and Redo in the top bar, and Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z. They take back
 * or redo the latest change to the tree, on any page. In a text field or the story editor
 * the keys stay the field's own.
 */
export function UndoRedo() {
  const history = useHistory();
  const { mutate: undo, isPending: undoing } = useHistoryMove("undo");
  const { mutate: redo, isPending: redoing } = useHistoryMove("redo");
  const busy = undoing || redoing;
  // Set at once, unlike `busy`: a second Ctrl+Z pressed straight after the first waits.
  const moving = useRef(false);

  const move = useCallback(
    (direction: Direction, step: string) => {
      if (moving.current) return;
      moving.current = true;
      const run = direction === "undo" ? undo : redo;
      run(step, {
        onSettled: () => {
          moving.current = false;
        },
        onSuccess: ({ done }) => {
          const back: Direction = direction === "undo" ? "redo" : "undo";
          toast(`${direction === "undo" ? "Undone" : "Redone"}: ${done.label}`, {
            duration: ACTION_MS,
            action: {
              label: back === "redo" ? "Redo" : "Undo",
              onClick: () => move(back, done.id),
            },
          });
        },
        onError: showError,
      });
    },
    [undo, redo],
  );

  const next = useCallback(
    (direction: Direction) => {
      const step = direction === "undo" ? history.data?.undo : history.data?.redo;
      if (step && !busy) move(direction, step.id);
    },
    [history.data, busy, move],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      // A dialog or a menu that's open has the keys, like a field being typed in.
      if (typing(event.target) || document.querySelector('[role="dialog"],[role="alertdialog"]')) {
        return;
      }
      event.preventDefault();
      next(key === "y" || event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);

  const undoStep = history.data?.undo;
  const redoStep = history.data?.redo;
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!undoStep || busy}
        onClick={() => next("undo")}
        aria-label={undoStep ? `Undo: ${undoStep.label}` : "Nothing to undo"}
        title={undoStep ? `Undo: ${undoStep.label} (Ctrl+Z)` : "Nothing to undo"}
      >
        <Undo2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!redoStep || busy}
        onClick={() => next("redo")}
        aria-label={redoStep ? `Redo: ${redoStep.label}` : "Nothing to redo"}
        title={redoStep ? `Redo: ${redoStep.label} (Ctrl+Y)` : "Nothing to redo"}
      >
        <Redo2Icon />
      </Button>
    </div>
  );
}
