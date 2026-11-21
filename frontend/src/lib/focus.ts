import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/**
 * Where the focus goes back to as a dialog or a card closes: to what had it as it
 * opened, the control that opened it. Radix gives it back only to a dialog's own trigger, and
 * most of the app's dialogs are opened by a control of their own, so the focus was lost to the
 * page. A dialog opened from a menu goes back to the menu's button, the menu being gone by then.
 */

/** The button a menu belongs to: Radix names the menu by it. */
function buttonOf(menu: Element): HTMLElement | null {
  const id = menu.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

// The button of the menu that had the focus last, while nothing else has had it since: a menu
// that closes as its choice opens a dialog may be gone before the dialog asks.
let fromMenu: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      const menu = (event.target as Element | null)?.closest?.('[role="menu"]');
      fromMenu = menu ? (buttonOf(menu) ?? fromMenu) : null;
    },
    true,
  );
}

/** What has the focus now, to give it back to later: a menu's button for one of its choices. */
export function focusNow(): HTMLElement | null {
  const now = document.activeElement;
  if (!(now instanceof HTMLElement) || now === document.body) return fromMenu;
  const menu = now.closest('[role="menu"]');
  return menu ? buttonOf(menu) : now;
}

/** The focus given back, if what had it is still on the page; whether it took it. */
export function giveFocusBack(to: HTMLElement | null): boolean {
  if (!to?.isConnected) return false;
  to.focus({ preventScroll: true });
  return document.activeElement === to;
}

/**
 * For a panel or a card the app draws itself: it takes the focus as it opens, unless something
 * in it took it already, and gives it back as it closes to what had it before, if the focus is
 * still in it. What had it is read as the panel is first drawn, before anything in it can take
 * the focus.
 */
export function useTakeFocus(own: RefObject<HTMLElement | null>): void {
  const [back] = useState(focusNow);
  useLayoutEffect(() => {
    const element = own.current;
    if (element && !element.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
    // Run while it's still on the page, so the focus is seen where it is.
    return () => {
      const now = document.activeElement;
      if (!now || now === document.body || element?.contains(now)) giveFocusBack(back);
    };
  }, [own, back]);
}

/**
 * For a Radix dialog's content: what had the focus as it opened gets it back as it closes.
 * `FocusOpener`, drawn first inside the content, notes it as the dialog is first drawn: before
 * a field in it takes the focus by itself (`autoFocus`), when Radix says nothing of opening.
 */
export function useFocusBack(onCloseAutoFocus?: (event: Event) => void) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    opener,
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (!event.defaultPrevented && giveFocusBack(opener.current)) event.preventDefault();
      opener.current = null;
    },
  };
}

/** Notes what has the focus as a dialog's content is first drawn (above). Draws nothing. */
export function FocusOpener({ opener }: { opener: RefObject<HTMLElement | null> }): null {
  useState(() => {
    opener.current = focusNow();
  });
  return null;
}
