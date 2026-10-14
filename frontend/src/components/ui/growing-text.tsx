import { cn } from "cn";
import type * as React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

/** A textarea as tall as its text: set by script, so it grows on every system's web view,
 *  where CSS's own `field-sizing` may not exist. */
export function fitHeight(element: HTMLTextAreaElement | null): void {
  if (!element) return;
  element.style.height = "auto";
  const borders = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + borders}px`;
}

/** Whether this web view sizes a textarea to its text by CSS alone: Chromium's does, as
 *  Windows' does; the Mac's and Linux's may not. */
export const CSS_GROWS =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("field-sizing", "content");

/** Keeps a textarea as tall as its text: when it's given another value, and when it's made
 *  wider or narrower, so its text wraps otherwise; as it's typed in, `fitHeight` from its
 *  onChange. Nothing while not `enabled`. */
export function useGrowing(ref: React.RefObject<HTMLTextAreaElement | null>, enabled = true): void {
  useLayoutEffect(() => {
    if (enabled) fitHeight(ref.current);
  });
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    const watcher = new ResizeObserver(() => {
      if (element.clientWidth === width) return; // its own growing: nothing to do
      width = element.clientWidth;
      fitHeight(element);
    });
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [ref, enabled]);
}

/**
 * A one-line text field that grows with its text: long text wraps onto more lines
 * instead of scrolling sideways. Every text field in the person's form, Add a person and the
 * quick fixes is one. Enter starts no new line: it saves, as it does in a one-line field.
 * It's never stretched to its row (`self-start`): beside another in a grid, each measured as
 * tall as the row would keep the other tall, as a panel opening narrow left them.
 */
function GrowingText({
  className,
  ref,
  onChange,
  onKeyDown,
  ...props
}: React.ComponentProps<"textarea">) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useGrowing(own);
  return (
    <textarea
      rows={1}
      data-slot="growing-text"
      ref={(element) => {
        own.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      onChange={(event) => {
        onChange?.(event);
        fitHeight(event.currentTarget);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey) return;
        if (event.nativeEvent.isComposing) return; // a word being made, as in Chinese
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }}
      className={cn(
        "block min-h-8 w-full min-w-0 self-start resize-none overflow-hidden rounded-lg border border-input bg-transparent px-2.5 py-1 text-base leading-snug break-words transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { GrowingText };
