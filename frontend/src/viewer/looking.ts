/**
 * Looking around a copy in a test page (jsdom): its buttons and links by name, and waiting for
 * something to show. For tests only.
 */
import { act } from "react";

/** Every button and link on the page, dialogs included, by name. */
export function controls(): string[] {
  return [...document.body.querySelectorAll("button, a[href]")].map(
    (element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
  );
}

export function named(name: string): HTMLElement {
  const found = [...document.body.querySelectorAll<HTMLElement>("button, a[href]")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === name,
  );
  if (!found) throw new Error(`No "${name}" among: ${controls().join(", ")}`);
  return found;
}

export async function until(shown: string) {
  for (let tries = 0; tries < 200; tries++) {
    if (document.body.textContent?.includes(shown)) return;
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
  throw new Error(`"${shown}" never showed`);
}
