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

/** Waits for the words to show, by the clock: up to 10 seconds, so that a computer busy with
 * other work doesn't fail a test by counting tries that each took longer (0.8.7). */
export async function until(shown: string, within = 10_000) {
  const end = Date.now() + within;
  while (Date.now() < end) {
    if (document.body.textContent?.includes(shown)) return;
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
  if (document.body.textContent?.includes(shown)) return;
  throw new Error(`"${shown}" never showed`);
}
