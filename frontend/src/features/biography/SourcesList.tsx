import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One source as edited: an id keeps each field steady while others come and go. */
export type Source = { id: number; text: string };

let nextId = 0;

export function toSources(texts: string[]): Source[] {
  return texts.map((text) => ({ id: nextId++, text }));
}

/**
 * Where the story's facts came from: a birth certificate, a talk with Nenek. Saved as the
 * list under "## Sources" at the end of biography.md. Enter adds the next one.
 */
export function SourcesList({
  sources,
  onChange,
}: {
  sources: Source[];
  onChange: (sources: Source[]) => void;
}) {
  const fields = useRef(new Map<number, HTMLInputElement>());
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    if (focus === null) return;
    fields.current.get(focus)?.focus();
    setFocus(null);
  }, [focus]);

  function addAt(index: number) {
    const [added] = toSources([""]) as [Source];
    onChange([...sources.slice(0, index), added, ...sources.slice(index)]);
    setFocus(added.id);
  }

  function remove(index: number) {
    onChange(sources.filter((_, i) => i !== index));
    const neighbour = sources[index - 1] ?? sources[index + 1];
    if (neighbour) setFocus(neighbour.id);
  }

  return (
    <section aria-labelledby="sources-heading" className="space-y-2 border-t border-stone-200 pt-4">
      <h3 id="sources-heading" className="text-sm font-semibold text-stone-800">
        Sources
      </h3>
      <p className="text-xs text-stone-500">
        Where this came from: a birth certificate, a talk with Nenek, an old letter.
      </p>
      {sources.length > 0 && (
        <ol className="space-y-1.5">
          {sources.map((source, index) => (
            <li key={source.id} className="flex items-center gap-1">
              <span className="w-5 shrink-0 text-right text-xs text-stone-400 tabular-nums">
                {index + 1}.
              </span>
              <Input
                ref={(element) => {
                  if (element) fields.current.set(source.id, element);
                  else fields.current.delete(source.id);
                }}
                value={source.text}
                maxLength={1000}
                aria-label={`Source ${index + 1}`}
                placeholder="e.g. Birth certificate, 1938"
                onChange={(event) =>
                  onChange(
                    sources.map((s) =>
                      s.id === source.id ? { ...s, text: event.target.value } : s,
                    ),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addAt(index + 1);
                  } else if (event.key === "Backspace" && source.text === "") {
                    event.preventDefault();
                    remove(index);
                  }
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove source ${index + 1}`}
                onClick={() => remove(index)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <Button variant="outline" size="sm" onClick={() => addAt(sources.length)}>
        <PlusIcon />
        Add a source
      </Button>
    </section>
  );
}
