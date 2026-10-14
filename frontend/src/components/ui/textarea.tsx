import { cn } from "cn";
import type * as React from "react";
import { useRef } from "react";
import { CSS_GROWS, fitHeight, useGrowing } from "./growing-text";

/** As tall as its text: by CSS where the web view has `field-sizing`, and by script
 *  where it hasn't, as the Mac's and Linux's may not. */
function Textarea({ className, ref, onChange, ...props }: React.ComponentProps<"textarea">) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useGrowing(own, !CSS_GROWS);
  return (
    <textarea
      data-slot="textarea"
      ref={(element) => {
        own.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      onChange={(event) => {
        onChange?.(event);
        if (!CSS_GROWS) fitHeight(event.currentTarget);
      }}
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
