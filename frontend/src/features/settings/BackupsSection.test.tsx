// @vitest-environment jsdom
/**
 * Settings → Backups: in the desktop app a backup is made each day. Those are
 * marked as such, and the section says every backup is kept for 3 months, older ones going to
 * the system's bin but the newest 3 staying, and what went there last, or couldn't.
 * Without the daily backups, it says AncesTree never deletes one.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backup, BackupList, BackupsBinned } from "@/api/types";
import { until } from "@/viewer/looking";
import { BackupsSection, binnedWords } from "./BackupsSection";

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

async function show(daily: boolean, binned: BackupsBinned | null = null) {
  const list: BackupList = {
    folder: FOLDER,
    reachable: true,
    backups: daily ? BACKUPS : BACKUPS.slice(1),
    automatic_backups: daily,
    family_id: "aaaaaaaaaaaaaaaa",
    family_name: "Keluarga Contoh",
    binned,
    bin: "Recycle Bin",
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

  it("are marked, and the section says backups are kept for 3 months", async () => {
    await show(true);
    const text = document.body.textContent ?? "";
    expect(text).toContain("AncesTree makes one each day while it runs");
    expect(text).toContain("Backups are kept for 3 months. To keep one longer, download it.");
    expect(text).toContain("Older ones go to the Recycle Bin, but the newest 3 always stay.");
    expect(text).not.toContain("never deletes");
    expect(text).not.toContain("last 30");
    expect(badges()).toEqual(["Automatic"]); // the one made by hand isn't marked
  });

  it("says what went to the bin last, and what couldn't go", async () => {
    await show(true, {
      at: "2026-10-17T09:00:00+08:00",
      backups: 4,
      copies: 0,
      bin: "Recycle Bin",
      stayed: 0,
      why: "",
    });
    await until("went to the Recycle Bin");
    expect(document.body.textContent).toContain(
      "On 17 Oct 2026, 4 backups older than 3 months went to the Recycle Bin.",
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("aren't mentioned where there are none", async () => {
    await show(false);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Make one whenever you like; AncesTree never deletes one.");
    expect(text).not.toContain("each day");
    expect(badges()).toEqual([]);
  });
});

describe("what went to the bin, in words", () => {
  const binned = (fields: Partial<BackupsBinned>): BackupsBinned => ({
    at: "2026-10-17T09:00:00+08:00",
    backups: 0,
    copies: 0,
    bin: "Recycle Bin",
    stayed: 0,
    why: "",
    ...fields,
  });

  it("names the backups and their copies, in the system's own bin", () => {
    expect(binnedWords(binned({ backups: 1 })).went).toBe(
      "On 17 Oct 2026, 1 backup older than 3 months went to the Recycle Bin.",
    );
    expect(binnedWords(binned({ backups: 4, copies: 4, bin: "Bin" })).went).toBe(
      "On 17 Oct 2026, 4 backups and 4 copies in the other place older than 3 months went to the Bin.",
    );
    expect(binnedWords(binned({ copies: 1, bin: "Trash" })).went).toBe(
      "On 17 Oct 2026, 1 copy in the other place older than 3 months went to the Trash.",
    );
    expect(binnedWords(binned({ at: null })).went).toBeNull();
  });

  it("says why some couldn't go, and that they stay", () => {
    const words = binnedWords(
      binned({
        at: null,
        stayed: 2,
        why: "E:\\ has no Recycle Bin, or it's set to delete at once",
      }),
    );
    expect(words.went).toBeNull();
    expect(words.stayed).toBe(
      "2 backups older than 3 months couldn't go to the Recycle Bin, so they stay: " +
        "E:\\ has no Recycle Bin, or it's set to delete at once.",
    );
    expect(binnedWords(binned({ stayed: 1 })).stayed).toBe(
      "1 backup older than 3 months couldn't go to the Recycle Bin, so it stays.",
    );
  });
});
