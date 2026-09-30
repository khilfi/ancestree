import { useSyncExternalStore } from "react";

/** Whether a CSS media query holds now, following it as the window or device changes. */
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", changed);
      return () => list.removeEventListener("change", changed);
    },
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
    () => false,
  );
}

/** A phone, or a window as narrow (below Tailwind's md): panels take the whole screen. */
export function useNarrow(): boolean {
  return useMedia("(max-width: 767px)");
}

/** A finger rather than a mouse: say "tap", and leave out keyboard shortcuts. */
export function useTouch(): boolean {
  return useMedia("(pointer: coarse)");
}
