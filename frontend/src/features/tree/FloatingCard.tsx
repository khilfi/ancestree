import { XIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useTakeFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";
import type { Point } from "./rings";

/**
 * A small card next to a spot on the canvas, kept inside it: after dragging a link, or a click
 * on a line or an unknown parent. It's a dialog with a name and a close button of its own; it
 * takes the focus as it opens, unless something in it takes it first, and gives it back as it
 * closes. Esc closes it, from the tree. `at` is relative to the canvas.
 */
export function FloatingCard({
  at,
  bounds,
  width = 300,
  label,
  onClose,
  className,
  children,
}: {
  at: Point;
  bounds: { width: number; height: number };
  width?: number;
  /** Its name, as a screen reader says it: what it's about. */
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const own = useRef<HTMLDivElement>(null);
  useTakeFocus(own);
  const left = Math.min(Math.max(at.x - width / 2, 12), Math.max(bounds.width - width - 12, 12));
  const top = Math.min(at.y + 18, Math.max(bounds.height - 260, 12));
  return (
    <div
      ref={own}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cn(
        "absolute z-20 space-y-3 rounded-xl border border-border bg-card p-3 pr-9 text-sm shadow-lg outline-none",
        className,
      )}
      style={{ left, top, width }}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-2 right-2"
        onClick={onClose}
        aria-label="Close"
      >
        <XIcon />
      </Button>
      {children}
    </div>
  );
}
