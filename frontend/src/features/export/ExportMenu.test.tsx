// @vitest-environment jsdom
/**
 * Export, a short menu: **View-only copy…** and **Picture of the tree**,
 * its PNG and SVG; the spreadsheet, GEDCOM and the full archive no longer among its words, nor
 * Make a copy…'s full archive, whatever the backend's switch, MORE_EXPORTS, says. A copy's
 * Export offers the picture and the import template. The engine's answers are made up here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CopyAbout, CopyProvider } from "@/app/copy";
import type { TreeSnapshot } from "@/features/tree/picture";
import { until } from "@/viewer/looking";
import { CopyDialog } from "./CopyDialog";
import { ExportMenu } from "./ExportMenu";
import { TreePictureProvider, useOfferTreePicture } from "./treePicture";

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

/** The engine's health, with the backend's switch for more exports on: the menu offers the
 *  two all the same. No backups yet. */
function answer() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
      .pathname;
    if (path === "/api/health") {
      return Response.json({
        status: "ok",
        version: "0.9.0",
        database: "up",
        schema_version: 3,
        data_folder: "",
        backup_folder: "",
        death_places: true,
        more_exports: true,
      });
    }
    if (path === "/api/backups") {
      return Response.json({ folder: "", reachable: true, backups: [], bin: "Recycle Bin" });
    }
    return Response.json({ detail: "not here" }, { status: 404 });
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

/** A tree on screen, offering its picture, as the canvas does. */
const DRAWN = () => ({}) as TreeSnapshot;
function TreeOnScreen() {
  useOfferTreePicture(DRAWN);
  return null;
}

async function show(page: ReactNode, copy: CopyAbout | null = null) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <CopyProvider value={copy}>
          <TreePictureProvider>{page}</TreePictureProvider>
        </CopyProvider>
      ),
    },
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
  for (let tries = 0; tries < 20; tries++) {
    await act(async () => new Promise((done) => setTimeout(done, 10)));
  }
}

const said = (element: Element) => element.textContent?.trim() ?? "";

/** Opens the menu, then its Picture of the tree; what the menu itself lists. */
async function open(): Promise<string[]> {
  const trigger = [...document.querySelectorAll("button")].find(
    (button) => said(button) === "Export",
  );
  if (!trigger) throw new Error("no Export");
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  await until("Picture of the tree");
  const menu = document.querySelector('[role="menu"]');
  const listed = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map(said);
  const picture = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find(
    (item) => said(item) === "Picture of the tree",
  );
  act(() => {
    picture?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  return listed;
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Export, a short menu", () => {
  it("offers a view-only copy and the tree's picture, and nothing else", async () => {
    answer();
    await show(
      <>
        <TreeOnScreen />
        <ExportMenu onCopy={() => {}} />
      </>,
    );
    // Its hint, a tooltip, shown when the keyboard brings the focus to it.
    const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => said(button) === "Export",
    );
    act(() => trigger?.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Export: a view-only copy or a picture of the tree",
    );
    act(() => trigger?.blur());
    expect(await open()).toEqual(["View-only copy…", "Picture of the tree"]);
    await until("Stays sharp at any size");
    const text = document.body.textContent ?? "";
    for (const hidden of ["GEDCOM", "Spreadsheet", "Full archive", "Include addresses"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("opens the copy's dialog from View-only copy…", async () => {
    answer();
    const onCopy = vi.fn();
    await show(<ExportMenu onCopy={onCopy} />);
    await open();
    const copy = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => said(item) === "View-only copy…",
    );
    act(() => copy?.click());
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("leads to the tree for its picture, away from it", async () => {
    answer();
    await show(<ExportMenu onCopy={() => {}} />);
    await open();
    await until("To save a picture of it");
    expect(document.body.textContent).not.toContain("Stays sharp at any size");
  });

  it("offers the picture and the import template in a copy", async () => {
    answer();
    await show(<ExportMenu onCopy={() => {}} />, COPY);
    expect(await open()).toEqual([
      "Picture of the tree",
      "Import templateTo add people or correct details in Excel, and send it back",
    ]);
  });

  it("makes a copy without the full archive", async () => {
    answer();
    await show(<CopyDialog open onOpenChange={() => {}} />);
    await until("Make a view-only copy");
    expect(document.body.textContent).not.toContain("Include the full archive");
  });
});
