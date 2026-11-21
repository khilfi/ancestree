import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A line of a note under what was done: something worth a second look, or a question,
 *  with its own button. */
export type NoteLine = {
  words: string;
  warning?: boolean;
  button?: { label: string; onClick: () => void };
};

/** The lines of one note, each with its button; a button used closes the note, as the note's
 *  own button does. */
export function NoteLines({ lines, close }: { lines: NoteLine[]; close: () => void }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a note's lines are written once, never moved
        <li key={index} className="flex flex-wrap items-start gap-x-2 gap-y-1">
          {line.warning && (
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          )}
          <span className="min-w-0 flex-1">{line.words}</span>
          {line.button && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                line.button?.onClick();
                close();
              }}
            >
              {line.button.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
