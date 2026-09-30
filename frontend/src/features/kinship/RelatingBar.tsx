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
    <div
      role="status"
      className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-sm text-amber-950 shadow-sm"
    >
      <span>
        {picking
          ? `${act} anyone to see how they're related to `
          : `${act} anyone else to compare with `}
        <span className="font-semibold">{name}</span>
        <span className="text-amber-800">
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
