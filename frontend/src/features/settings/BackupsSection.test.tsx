// @vitest-environment jsdom
/**
 * Settings → Backups: in the desktop app a backup is made each day. Those are
 * marked as such, and the section says only the last 30 of them are kept, never one made by
 * hand. Without the daily backups, it says AncesTree never deletes one.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backup, BackupList } from "@/api/types";
import { until } from "@/viewer/looking";
import { BackupsSection } from "./BackupsSection";

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

const FOLDER = "C:/Users/keluarga/AppData/Local/app.ancestree.desktop/backups";

const backup = (name: string, madeAt: string, automatic: boolean): Backup => ({
  name,
  folder: FOLDER,
  size: 1_234_567,
  made_at: madeAt,
  app_version: "0.1.0",
  people: 42,
  links: 61,
  files: 3,
  automatic,
  family_id: "aaaaaaaaaaaaaaaa",
  family_name: "Keluarga Contoh",
});

const BACKUPS = [
  backup("ancestree-backup-2026-10-02T09-00-00-automatic.zip", "2026-10-02T09:00:00+08:00", true),
  backup("ancestree-backup-2026-10-01T20-15-00.zip", "2026-10-01T20:15:00+08:00", false),
];

let root: Root | undefined;

async function show(daily: boolean) {
  const list: BackupList = {
    folder: FOLDER,
    reachable: true,
    backups: daily ? BACKUPS : BACKUPS.slice(1),
    automatic_backups: daily,
    family_id: "aaaaaaaaaaaaaaaa",
    family_name: "Keluarga Contoh",
  };
  vi.stubGlobal("fetch", async () =>
    Response.json(list, { headers: { "content-type": "application/json" } }),
  );
  const router = createMemoryRouter([{ path: "/", element: <BackupsSection /> }]);
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
  await until("1 Oct 2026");
}

function badges(): string[] {
  return [...document.querySelectorAll('[data-slot="badge"]')].map(
    (badge) => badge.textContent ?? "",
  );
}

describe("the daily backups", () => {
  afterEach(() => {
    act(() => root?.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("are marked, and the section says the last 30 are kept", async () => {
    await show(true);
    const text = document.body.textContent ?? "";
    expect(text).toContain("AncesTree makes one each day while it runs, and keeps the last 30");
    expect(text).toContain("AncesTree never deletes those.");
    expect(badges()).toEqual(["Automatic"]); // the one made by hand isn't marked
  });

  it("aren't mentioned where there are none", async () => {
    await show(false);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Make one whenever you like; AncesTree never deletes one.");
    expect(text).not.toContain("each day");
    expect(badges()).toEqual([]);
  });
});
