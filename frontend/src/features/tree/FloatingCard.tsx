import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Point } from "./rings";

/** A small card next to a spot on the canvas, kept inside it. `at` is relative to the canvas. */
export function FloatingCard({
  at,
  bounds,
  width = 300,
  className,
  children,
}: {
  at: Point;
  bounds: { width: number; height: number };
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  const left = Math.min(Math.max(at.x - width / 2, 12), Math.max(bounds.width - width - 12, 12));
  const top = Math.min(at.y + 18, Math.max(bounds.height - 260, 12));
  return (
    <div
      role="dialog"
      className={cn(
        "absolute z-20 space-y-3 rounded-xl border border-stone-200 bg-white p-3 text-sm shadow-lg",
        className,
      )}
      style={{ left, top, width }}
    >
      {children}
    </div>
  );
}
