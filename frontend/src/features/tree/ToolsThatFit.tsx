import { EllipsisIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** One of the tree's tools: a control or a few that go together. */
export type Tool = { key: string; tool: ReactNode };

const GAP = 12; // between tools, as the toolbar's gap-x-3
const MORE = 28; // the ⋯ button, an icon alone: icon-sm

/**
 * The tree's tools in one line: as many as fit, in their order, and the rest in
 * **⋯** (More tools), the same controls in a small panel under it. Each tool is measured where it
 * stands in the line, before it's drawn, and its width remembered while it's in ⋯; one not yet
 * measured is put in the line to be, and moved out again before anything is drawn.
 */
export function ToolsThatFit({ tools }: { tools: Tool[] }) {
  const line = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [shown, setShown] = useState(tools.length);
  // The line grown or shrunk (the window, the panel beside the tree): fitted again.
  const [, resized] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const element = line.current;
    if (!element) return;
    const watch = new ResizeObserver(resized);
    watch.observe(element);
    return () => watch.disconnect();
  }, []);

  // After every change, before it's drawn: measure what's in the line, and fit the rest.
  useLayoutEffect(() => {
    const element = line.current;
    if (!element) return;
    for (const each of element.querySelectorAll<HTMLElement>(":scope > [data-tool]")) {
      widths.current.set(each.dataset.tool ?? "", each.offsetWidth);
    }
    const room = element.clientWidth;
    if (tools.some(({ key }) => !widths.current.has(key))) {
      if (shown !== tools.length) setShown(tools.length);
      return;
    }
    let fit = 0;
    let used = 0;
    for (const [index, { key }] of tools.entries()) {
      const next = used + (index ? GAP : 0) + (widths.current.get(key) ?? 0);
      const rest = index + 1 < tools.length ? GAP + MORE : 0;
      if (next + rest > room) break;
      used = next;
      fit = index + 1;
    }
    if (fit !== shown) setShown(fit);
  });

  const inLine = tools.slice(0, shown);
  const rest = tools.slice(shown);
  return (
    <div ref={line} className="flex min-w-0 flex-1 items-center gap-x-3">
      {inLine.map(({ key, tool }) => (
        <div key={key} data-tool={key} className="flex shrink-0 items-center">
          {tool}
        </div>
      ))}
      {rest.length > 0 && (
        <Popover>
          <Hint label="More of the tree's tools">
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="More tools">
                <EllipsisIcon />
              </Button>
            </PopoverTrigger>
          </Hint>
          <PopoverContent
            align="start"
            aria-label="More tools"
            className="flex w-auto max-w-[calc(100vw-1.5rem)] flex-col items-start gap-2 p-2 text-[0.8rem] text-muted-foreground"
          >
            {rest.map(({ key, tool }) => (
              <div key={key} className="flex items-center">
                {tool}
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
