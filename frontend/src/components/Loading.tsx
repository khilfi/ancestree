import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * Loading shapes: while something is on its way, quiet shapes stand where it will
 * be, about its size, so nothing jumps when it comes. They say what's coming to a screen
 * reader, as "Loading…" did, and to no one else.
 */

/** Rows, as a list will have them: Settings' parts, the Dictionary. */
export function LoadingRows({
  label,
  rows = 3,
  className,
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" className={cn("space-y-2", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: shapes, the same each time
          key={row}
          className="h-12 w-full rounded-lg"
          style={{ opacity: 1 - row * 0.2 }}
        />
      ))}
    </div>
  );
}

/** The space a view draws in, with the shapes it'll draw: people on rings for the tree, rows of
 *  bars for the timeline, land for the map. */
export function LoadingView({ label, view }: { label: string; view: "tree" | "timeline" | "map" }) {
  return (
    <div role="status" className="relative size-full overflow-hidden" aria-busy="true">
      <span className="sr-only">{label}</span>
      {view === "tree" && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="relative size-72">
            {[0, 60, 120, 180, 240, 300].map((angle) => (
              <Skeleton
                key={angle}
                className="absolute size-14 rounded-full"
                style={{
                  left: `calc(50% - 1.75rem + ${Math.round(Math.cos((angle * Math.PI) / 180) * 110)}px)`,
                  top: `calc(50% - 1.75rem + ${Math.round(Math.sin((angle * Math.PI) / 180) * 110)}px)`,
                }}
              />
            ))}
            <Skeleton className="absolute top-[calc(50%-1.75rem)] left-[calc(50%-1.75rem)] size-14 rounded-full" />
          </div>
        </div>
      )}
      {view === "timeline" && (
        <div className="space-y-3 p-4 pt-12" aria-hidden="true">
          {[60, 45, 70, 35, 55, 40].map((width, row) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: shapes, the same each time
              key={row}
              className="h-6 rounded-full"
              style={{ width: `${width}%`, marginLeft: `${(row * 7) % 30}%` }}
            />
          ))}
        </div>
      )}
      {view === "map" && (
        <div className="absolute inset-0 p-6" aria-hidden="true">
          <Skeleton className="size-full rounded-2xl" />
        </div>
      )}
    </div>
  );
}
