import { Button } from "@/components/ui/button";
import { useTouch } from "@/lib/media";

/** In place of the tree's toolbar while finding a relationship: what to do next. */
export function RelatingBar({
  name,
  picking,
  onDone,
}: {
  name: string;
  picking: boolean;
  onDone: () => void;
}) {
  const touch = useTouch(); // a finger: tap, and no keys to press
  const act = touch ? "Tap" : "Click";
  return (
    // Above the canvas, where the toolbar was, and as high.
    <div
      role="status"
      className="flex min-h-[41px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-kin-border bg-kin-soft px-3 py-1.5 text-sm text-kin-soft-foreground"
    >
      <span>
        {picking
          ? `${act} anyone to see how they're related to `
          : `${act} anyone else to compare with `}
        <span className="font-semibold">{name}</span>
        <span className="text-kin-soft-foreground">
          {touch
            ? " · or search"
            : ` · or search with Ctrl K · Esc to ${picking ? "cancel" : "finish"}`}
        </span>
      </span>
      <Button variant="outline" size="xs" onClick={onDone}>
        {picking ? "Cancel" : "Done"}
      </Button>
    </div>
  );
}
