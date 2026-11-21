import { type ReactNode, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEscape } from "@/lib/escape";

/**
 * Typed changes are never thrown away without a question, for a form that's part of
 * the page, as the person form is. **Cancel** and Esc ask "Discard your changes?" first when
 * something has changed, and so does leaving it for another address, or closing the window.
 * Esc in the question, or **Keep editing**, goes back to the form as it was; **Discard** leaves.
 * With nothing changed, they leave at once.
 *
 * `changed` is asked each time it's needed, so a form that has just saved has nothing to lose.
 */
export function useDiscardGuard(
  changed: () => boolean,
  leave: () => void,
): { cancel: () => void; question: ReactNode } {
  const now = useRef(changed);
  now.current = changed;
  const discarded = useRef(false); // left on purpose: what follows asks nothing more
  const unsaved = () => !discarded.current && now.current();
  const [asking, setAsking] = useState(false);

  // Leaving for another address asks first, inside the app.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsaved() &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  // And so does closing the window, in the browser's own words.
  useAskOnClosing(changed());

  const cancel = () => {
    if (unsaved()) setAsking(true);
    else leave();
  };
  // Esc is Cancel, when nothing opened after the form is still open.
  useEscape(cancel);

  const blocked = blocker.state === "blocked";
  const keep = () => {
    setAsking(false);
    if (blocked) blocker.reset?.();
  };
  const discard = () => {
    discarded.current = true;
    setAsking(false);
    if (blocked) blocker.proceed?.();
    else leave();
  };
  const question = <DiscardQuestion open={asking || blocked} onKeep={keep} onDiscard={discard} />;
  return { cancel, question };
}

/**
 * The same question for a dialog's form, by the user's answer of 19–20 Nov 2026: Add a
 * relative, and a relationship kind. Its **Cancel**, Esc and × ask "Discard your changes?" first
 * when something has been typed, and so does closing the window; with nothing typed, they close
 * it at once. Esc reaches the dialog itself first, so the dialog calls `cancel` for it, as for ×,
 * from its `onOpenChange`. A dialog covers the page, so nothing guards leaving it for another
 * address: React Router keeps one such guard at a time, the person form's, which may be open
 * behind it.
 */
export function useDialogDiscard(
  changed: () => boolean,
  leave: () => void,
): { cancel: () => void; question: ReactNode } {
  const now = useRef(changed);
  now.current = changed;
  const [asking, setAsking] = useState(false);
  useAskOnClosing(changed());
  const cancel = () => {
    if (now.current()) setAsking(true);
    else leave();
  };
  const question = (
    <DiscardQuestion
      open={asking}
      onKeep={() => setAsking(false)}
      onDiscard={() => {
        setAsking(false);
        leave();
      }}
    />
  );
  return { cancel, question };
}

/** Closing the window with something changed asks first, in the browser's own words. */
function useAskOnClosing(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/** "Discard your changes?": **Keep editing**, or Esc, goes back; **Discard** leaves. */
function DiscardQuestion({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You've changed this form but haven't saved it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault(); // closed by leaving, never as Keep editing
              onDiscard();
            }}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
