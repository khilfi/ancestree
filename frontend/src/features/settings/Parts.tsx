import { type ReactNode, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

/** One part of a Settings page: its address after the #, its name, and what it shows. */
export type Part = { id: string; label: string; element: ReactNode };

/** How long the part asked for is kept in view while those above it fill in. */
const SETTLING_MS = 3000;

/**
 * A Settings page of several parts, each under its own heading, with a short list of
 * them at the top, each a click away. The address says which part: /settings/family#me, and the
 * old addresses, /settings/me and the like, lead there. The part asked for is brought into view,
 * and kept there while the parts above it are still filling in, until the page is scrolled.
 */
export function Parts({ parts }: { parts: Part[] }) {
  const location = useLocation();
  const asked = decodeURIComponent(location.hash.replace(/^#/, ""));
  const page = useRef<HTMLDivElement>(null);
  const shown = parts.map((part) => part.id).join(" ");

  // biome-ignore lint/correctness/useExhaustiveDependencies: again on each click, and once a part that was asked for appears
  useEffect(() => {
    const at = asked ? document.getElementById(asked) : null;
    if (!at || !page.current) return;
    const bring = () => at.scrollIntoView?.({ block: "start" });
    bring();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(bring);
    watch.observe(page.current);
    const stop = () => watch.disconnect();
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const event of events) window.addEventListener(event, stop, { passive: true });
    const settled = window.setTimeout(stop, SETTLING_MS);
    return () => {
      stop();
      window.clearTimeout(settled);
      for (const event of events) window.removeEventListener(event, stop);
    };
  }, [asked, location.key, shown]);

  return (
    <div ref={page} className="space-y-6">
      <nav aria-label="On this page" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone-500">On this page:</span>
        {parts.map((part) => (
          <Link
            key={part.id}
            to={{ hash: `#${part.id}` }}
            className="rounded-full border border-stone-200 bg-white px-3 py-1 text-stone-700 hover:border-stone-300 hover:text-stone-900"
          >
            {part.label}
          </Link>
        ))}
      </nav>
      {parts.map((part) => (
        <div key={part.id} id={part.id} className="scroll-mt-6">
          {part.element}
        </div>
      ))}
    </div>
  );
}
