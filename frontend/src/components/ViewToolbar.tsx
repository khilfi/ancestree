import { createContext, type ReactNode, useContext } from "react";
import { cn } from "@/lib/utils";

/*
 * One toolbar for the tree, the timeline and the map: the same frame, a bar along the
 * top of the view, above it rather than over it, the tree's too, and the same sizes for
 * what's in it, in each view. Buttons are `size="sm"` (28 pixels high), a button that's an
 * icon alone `size="icon-sm"`, and a list's trigger `TOOL_SELECT`, as high; its words, and the
 * toolbar's own, at 0.8rem, as a small button's. A hint beside them, such as "Scroll to zoom",
 * is `text-xs text-faint`.
 */

/** A Select's trigger in a toolbar: as high as its buttons, its words as theirs. */
export const TOOL_SELECT = "h-7 text-[0.8rem]";

export function ViewToolbar({
  label,
  className,
  children,
}: {
  /** What it's the toolbar of, for a screen reader: "Tree", "Timeline", "Map". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // A group of controls, as the app's other groups are: a fieldset, free to wrap (min-w-0).
    <fieldset
      aria-label={label}
      className={cn(
        "flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-1.5 text-[0.8rem] text-muted-foreground",
        className,
      )}
    >
      {children}
    </fieldset>
  );
}

/** Told of the open view's head as it's drawn, and of none as it goes. */
export const ViewHeadKeeper = createContext<(head: HTMLElement | null) => void>(() => {});

/**
 * A view's head: its toolbar and the bars under it (the colours' key, the filter's
 * chips), or what stands in the toolbar's place, as finding a relationship's bar does. The app
 * keeps where it is, so what's laid over the view, Family facts, starts below it and covers none
 * of its controls, at any width.
 */
export function ViewHead({ children }: { children: ReactNode }) {
  return (
    <div ref={useContext(ViewHeadKeeper)} className="shrink-0">
      {children}
    </div>
  );
}
