import { type GroupProps, type PanelProps, usePanelRef } from "react-resizable-panels";

const KEY = "ancestree:person-panel-width";
export const PANEL_WIDTH = 440; // px, until it's made wider or narrower
const NARROWEST = 340;

/** The width last given the person panel, in pixels: this browser's own, as folds are. */
export function loadWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(saved) && saved >= NARROWEST ? Math.round(saved) : PANEL_WIDTH;
  } catch {
    return PANEL_WIDTH; // private windows and blocked storage: the default will do
  }
}

export function saveWidth(width: number): void {
  try {
    window.localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

/**
 * The person panel's width remembered: beside the tree, the timeline and the map,
 * it opens as wide as it was last made, by its handle or the keyboard. A change of the
 * window's size isn't a choice, and isn't kept. The group takes `group`, the panel `panel`.
 */
export function usePanelWidth(): {
  group: Pick<GroupProps, "onLayoutChanged">;
  panel: Pick<PanelProps, "panelRef" | "defaultSize" | "minSize" | "maxSize">;
} {
  const panelRef = usePanelRef();
  return {
    group: {
      onLayoutChanged: (_, { isUserInteraction }) => {
        const size = panelRef.current?.getSize();
        if (isUserInteraction && size) saveWidth(size.inPixels);
      },
    },
    // Read as it opens, so a width chosen on one view is the next view's too.
    panel: { panelRef, defaultSize: loadWidth(), minSize: NARROWEST, maxSize: "60" },
  };
}
