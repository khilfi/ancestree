// @vitest-environment jsdom
/**
 * New versions of the desktop app, with the engine's answers made up here: the banner at
 * the top, and Settings → About. In a browser or a copy, where there's no desktop engine, the
 * address answers 404 and neither shows anything about updates.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdate } from "@/api/desktop";
import { AboutSection } from "@/features/settings/AboutSection";
import { until } from "@/viewer/looking";
import { UpdateBanner } from "./UpdateBanner";

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

const HEALTH = {
  status: "ok",
  version: "0.1.0",
  database: "up",
  schema_version: 3,
  database_version: "Neo4j/2026.08.1",
  data_folder: "C:/Users/keluarga/AppData/Local/app.ancestree.desktop/family",
  backup_folder: "C:/Users/keluarga/AppData/Local/app.ancestree.desktop/backups",
};

const NONE: DesktopUpdate = {
  current: "0.2.0",
  available: null,
  checking: false,
  checked_at: null,
  problem: null,
};

let root: Root | undefined;
let asked: string[] = [];

/** The engine's answers: `update` for its update address, or null for no desktop engine. */
function answer(update: DesktopUpdate | null, health: object = HEALTH) {
  asked = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), "http://localhost").pathname;
    const method = request?.method ?? init?.method ?? "GET";
    asked.push(`${method} ${url}`);
    if (url === "/api/health") return Response.json(health);
    if (!update) return new Response("{}", { status: 404 });
    if (url === "/api/desktop/update/check") return Response.json({ ...update, checking: true });
    return Response.json(update);
  });
}

async function show(page: ReactNode, text: string) {
  const router = createMemoryRouter([{ path: "/", element: page }]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
  await until(text);
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No "${name}" button`);
  return found;
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("the banner", () => {
  it("offers a new version, what's new in it, and a restart into it", async () => {
    answer({ ...NONE, available: { version: "0.2.1", notes: "The map shows towns." } });
    await show(<UpdateBanner />, "A new version of AncesTree is ready: 0.2.1");
    expect(document.body.textContent).toContain("What's new");
    expect(document.body.textContent).toContain("The map shows towns.");

    act(() => button("Restart to update").click());
    await until("Restarting…");
    expect(asked).toContain("POST /api/desktop/update/restart");
  });

  it("shows nothing when there's no new version, or no desktop app", async () => {
    answer(NONE);
    await show(
      <>
        <UpdateBanner />
        ready
      </>,
      "ready",
    );
    await new Promise((done) => setTimeout(done, 50));
    expect(document.body.textContent).toBe("ready");
  });
});

describe("Settings → About", () => {
  it("gives the app's version, and looks for a new one when asked", async () => {
    answer(NONE);
    await show(<AboutSection />, "Version 0.2.0");
    act(() => button("Check for updates").click());
    await until("Looking for a new version…");
    expect(asked).toContain("POST /api/desktop/update/check");
  });

  it("says what the last look found", async () => {
    answer({ ...NONE, checked_at: "2026-10-01T08:00:00+00:00" });
    await show(<AboutSection />, "This is the latest version.");
    act(() => root?.unmount());
    document.body.replaceChildren();

    answer({ ...NONE, available: { version: "0.2.1", notes: "" } });
    await show(<AboutSection />, "Version 0.2.1 is ready.");
    expect(button("Restart to update")).toBeTruthy();
    act(() => root?.unmount());
    document.body.replaceChildren();

    answer({ ...NONE, checked_at: "2026-10-01T08:00:00+00:00", problem: "no answer" });
    await show(<AboutSection />, "Couldn't check for a new version: no answer");
  });

  it("keeps the browser's own advice and version outside the desktop app", async () => {
    answer(null, { ...HEALTH, database: "down" });
    await show(<AboutSection />, "Version 0.1.0");
    expect(document.body.textContent).toContain("Is Docker Desktop running?");
    expect(document.body.textContent).not.toContain("Check for updates");
  });

  it("tells a relative to open the app again when its database has stopped", async () => {
    answer(NONE, { ...HEALTH, database: "down" });
    await show(<AboutSection />, "Quit AncesTree from its icon by the clock");
    expect(document.body.textContent).not.toContain("Docker");
  });
});
