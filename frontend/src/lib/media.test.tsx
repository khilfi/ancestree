// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useNarrow, useTouch } from "./media";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A screen whose answers to media queries can change, as a tablet turned on its side. */
function screen(answers: Record<string, boolean>) {
  const heard = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return answers[query] ?? false;
    },
    addEventListener: (_: string, listener: () => void) => heard.add(listener),
    removeEventListener: (_: string, listener: () => void) => heard.delete(listener),
  }));
  return (next: Record<string, boolean>) => {
    Object.assign(answers, next);
    for (const listener of heard) listener();
  };
}

function Shown() {
  return (
    <p>
      {useNarrow() ? "narrow" : "wide"} {useTouch() ? "touch" : "mouse"}
    </p>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("follows the screen: narrow for a phone, touch for a finger", () => {
  const change = screen({ "(max-width: 767px)": false, "(pointer: coarse)": true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => root.render(<Shown />));
  expect(host.textContent).toBe("wide touch");

  act(() => change({ "(max-width: 767px)": true }));
  expect(host.textContent).toBe("narrow touch");
  act(() => root.unmount());
});
