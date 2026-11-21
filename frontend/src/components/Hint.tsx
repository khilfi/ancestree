import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** How long the pointer rests on a control before its hint shows: long enough not to flicker
 *  as it passes, short enough to be there when it's wanted. */
const RESTING = 400; // ms

/** Whether the element matches a selector the browser may not know (jsdom, in tests). */
function matches(element: Element | null, selector: string): boolean {
  try {
    return element?.matches(selector) ?? false;
  } catch {
    return false;
  }
}

/**
 * A hint: a few words beside a control, shown while it's pointed at and while the
 * keyboard has brought the focus to it, in place of a `title`, which the keyboard never shows
 * and which shows late and small. The control keeps its own name: one that's an icon alone
 * has an `aria-label` as well. Focus put back on it by the app, as a dialog closes, shows
 * nothing: only the keyboard's, or the pointer.
 *
 * Each brings its own provider, so a hint works wherever it's drawn, in a test too. Its trigger
 * joins the child's classes as words: a `NavLink` under a hint takes its `className` as a string,
 * marking the page open with `aria-[current=page]:`, never as a function.
 */
export function Hint({
  label,
  children,
  side = "bottom",
}: {
  label: ReactNode;
  /** One element that takes a ref: a button, a link, or a component that passes it on. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  // Whatever the trigger is, a button by its type; only its matches() is asked.
  const trigger = useRef<HTMLButtonElement>(null);
  if (label === null || label === undefined || label === "") return children;
  return (
    <TooltipProvider delayDuration={RESTING}>
      <Tooltip
        open={open}
        onOpenChange={(next) => {
          const at = trigger.current;
          setOpen(next && (matches(at, ":hover") || matches(at, ":focus-visible")));
        }}
      >
        <TooltipTrigger asChild ref={trigger}>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
