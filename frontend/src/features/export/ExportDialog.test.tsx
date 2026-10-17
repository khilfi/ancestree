// @vitest-environment jsdom
/**
 * Export, with fewer choices: a view-only copy and the tree's picture, the
 * spreadsheet, GEDCOM, Include addresses and the full archive hidden unless MORE_EXPORTS, the
 * backend's switch, brings them back; then everything as before. A copy's Export offers the
 * picture and the import template; Make a copy… no longer offers the full archive. The
 * engine's answers are made up here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CopyAbout, CopyProvider } from "@/app/copy";
import { until } from "@/viewer/looking";
import { CopyDialog } from "./CopyDialog";
import { ExportButton } from "./ExportDialog";

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

const COPY: CopyAbout = {
  title: "Keluarga Contoh",
  made_at: "2026-10-17T09:00:00+08:00",
  people: 64,
  hidden_living: false,
  archive: false,
  family: "",
  version: "0.8.4",
  centres: [],
};

let root: Root | undefined;

/** The engine's health, saying whether Export offers more; no backups yet. */
function answer(more: boolean) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
      .pathname;
    if (path === "/api/health") {
      return Response.json({
        status: "ok",
        version: "0.8.4",
        database: "up",
        schema_version: 3,
        data_folder: "",
        backup_folder: "",
        death_places: false,
        more_exports: more,
      });
    }
    if (path === "/api/backups") {
      return Response.json({ folder: "", reachable: true, backups: [], bin: "Recycle Bin" });
    }
    return Response.json({ detail: "not here" }, { status: 404 });
  });
}

async function show(page: ReactNode, copy: CopyAbout | null = null) {
  const router = createMemoryRouter([
    { path: "/", element: <CopyProvider value={copy}>{page}</CopyProvider> },
  ]);
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
  // The health answer comes first: its absence would look like the switch off.
  for (let tries = 0; tries < 20; tries++) {
    await act(async () => new Promise((done) => setTimeout(done, 10)));
  }
}

async function choices(): Promise<string[]> {
  const opener = document.querySelector<HTMLButtonElement>('button[aria-label="Export"]');
  act(() => opener?.click());
  await until("Picture of the tree");
  return [...document.querySelectorAll('[role="dialog"] li p.font-medium')].map(
    (title) => title.firstChild?.textContent?.trim() ?? "",
  );
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Export, with fewer choices", () => {
  it("offers a view-only copy and the tree's picture", async () => {
    answer(false);
    await show(<ExportButton />);
    expect(document.querySelector('button[aria-label="Export"]')?.getAttribute("title")).toBe(
      "Export: a view-only copy or a picture of the tree",
    );
    expect(await choices()).toEqual(["View-only copy", "Picture of the tree"]);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Include addresses");
    expect(text).not.toContain("GEDCOM");
  });

  it("offers everything as before, with MORE_EXPORTS on", async () => {
    answer(true);
    await show(<ExportButton />);
    expect(await choices()).toEqual([
      "View-only copy",
      "Full archive",
      "GEDCOM",
      "Spreadsheet",
      "Picture of the tree",
    ]);
    expect(document.body.textContent).toContain("Include addresses");
  });

  it("offers the picture and the import template in a copy", async () => {
    answer(false);
    await show(<ExportButton />, COPY);
    expect(await choices()).toEqual(["Picture of the tree", "Import template"]);
  });

  it("makes a copy without the full archive", async () => {
    answer(false);
    await show(<CopyDialog open onOpenChange={() => {}} />);
    await until("Make a view-only copy");
    expect(document.body.textContent).not.toContain("Include the full archive");
    act(() => root?.unmount());
    document.body.replaceChildren();

    answer(true);
    await show(<CopyDialog open onOpenChange={() => {}} />);
    await until("Include the full archive in the copy's Export");
  });
});
