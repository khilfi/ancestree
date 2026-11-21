import { useEffect, useRef } from "react";

/**
 * Esc closes what's on top, and only that.
 *
 * Radix's dialogs, menus, lists, popovers and hints take Esc first: they listen on the document
 * as the key starts down, and the one on top closes and marks the key as taken. What the app
 * opens itself, a panel or a card on the tree, takes Esc after them, here: each is put on top as
 * it opens and taken off as it closes, so the one opened last closes first. A key already taken,
 * by Radix or by a list in a field, closes nothing more.
 */
type Layer = { current: () => void };

const layers: Layer[] = [];

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
  const top = layers.at(-1);
  if (!top) return;
  event.preventDefault();
  top.current();
}

/** Close this on Esc while it's `open`, when nothing opened after it is still open. */
export function useEscape(close: () => void, open = true): void {
  const layer = useRef(close);
  layer.current = close;
  useEffect(() => {
    if (!open) return;
    if (layers.length === 0) window.addEventListener("keydown", onKey);
    layers.push(layer);
    return () => {
      const at = layers.lastIndexOf(layer);
      if (at >= 0) layers.splice(at, 1);
      if (layers.length === 0) window.removeEventListener("keydown", onKey);
    };
  }, [open]);
}
