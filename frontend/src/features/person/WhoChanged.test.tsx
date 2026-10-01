// @vitest-environment jsdom
/**
 * Who changed this: a person's last changes, from their journal. A change brought
 * in from a relative's computer says which computer, whose, and where it was brought in.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalEntry } from "@/api/types";
import { until } from "@/viewer/looking";
import { WhoChanged } from "./WhoChanged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// As in a browser, "/api/…" is read against the page. (Before the app's API client is made.)
vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {}; // jsdom's signals aren't Node's
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

const LINES: JournalEntry[] = [
  {
    at: "2026-10-02T09:00:00+08:00",
    what: "Changes from Mak Long's laptop",
    by: "Home PC",
    from_computer: "Mak Long's laptop",
    from_email: "r@example.com",
    sent_at: "2026-10-01T20:00:00+08:00",
  },
  { at: "2026-09-30T10:00:00+08:00", what: "Edit Hassan bin Ismail", by: "Home PC" },
];

let root: Root | undefined;

async function show(lines: JournalEntry[]) {
  vi.stubGlobal("fetch", async () => Response.json(lines));
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <WhoChanged personId="00000000-0000-4000-8000-000000000001" />
      </QueryClientProvider>,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Who changed this", () => {
  it("says the last change, whose it was, and all of them when asked", async () => {
    await show(LINES);
    await until("Who changed this");
    const text = () => document.body.textContent ?? "";
    expect(text()).toContain("Changes from Mak Long's laptop");
    expect(text()).toContain("sent from Mak Long's laptop (r@example.com), brought in on Home PC");
    expect(text()).not.toContain("Edit Hassan bin Ismail");
    const more = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("All 2 changes"),
    );
    act(() => more?.click());
    expect(text()).toContain("Edit Hassan bin Ismail · on Home PC");
  });

  it("shows nothing for someone no one has changed yet", async () => {
    await show([]);
    await new Promise((done) => setTimeout(done, 30));
    expect(document.body.textContent).toBe("");
  });
});
