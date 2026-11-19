// @vitest-environment jsdom
/**
 * Remove AncesTree from this computer… (D88), in Settings → About, with the engine's answers
 * made up here: what goes and what stays, the backups saved to a folder first, the keeper's three
 * ticks before the families can go, Save it again… for the client's file, Send now on a
 * relative's computer, and what each way out does on Windows, the Mac and Linux. An engine run
 * from the code removes nothing, and the dialog says so. Names and folders are made up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Removing } from "@/api/desktop";
import type { FamilyFolderStatus } from "@/api/types";
import { named, until } from "@/viewer/looking";
import { RemoveAncesTree, whatHappens } from "./RemoveAncesTree";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {};
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

const WINDOWS: Removing = {
  system: "windows",
  installed: true,
  app: "C:\\Users\\keluarga\\AppData\\Local\\AncesTree",
  folder: "C:\\Users\\keluarga\\AppData\\Local\\app.ancestree.desktop",
  documents: "C:\\Users\\keluarga\\Documents",
  kept: "AncesTree backups",
  bin: "Recycle Bin",
  families: [
    { id: "a1", name: "Keluarga Contoh", open: true, example: false, keeper: true, backups: 3 },
    { id: "b2", name: "Keluarga Ibu", open: false, example: false, keeper: false, backups: 1 },
  ],
};

const FOLDER = {
  available: true,
  email: "keeper@example.com",
  setup: "keeper",
  family: "Keluarga Contoh",
  role: "keeper",
  members: [],
  pending: 0,
  may_leave: true,
  project: "keluarga-contoh",
  project_invited: false,
} as unknown as FamilyFolderStatus;

let root: Root | undefined;
let asked: { method: string; path: string; body: unknown }[] = [];

function answer(removing: Removing, folder: Partial<FamilyFolderStatus> = FOLDER) {
  asked = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = typeof input === "string" ? new Request(input, init) : (input as Request);
    const path = new URL(request.url).pathname;
    const body =
      request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => null)
        : null;
    asked.push({ method: request.method, path, body });
    if (path === "/api/desktop/removing") return Response.json(removing);
    if (path === "/api/desktop/removing/save-backups") {
      return Response.json({
        folder: `${(body as { folder: string }).folder}\\AncesTree backups`,
        families: 2,
        backups: 4,
        copied: 4,
      });
    }
    if (path === "/api/desktop/removing/remove") {
      return Response.json({ removing: (body as { families: string }).families });
    }
    if (path === "/api/backups/places") {
      return Response.json([{ path: "E:\\", kind: "disk", name: "Drive E:" }]);
    }
    if (path === "/api/downloads") {
      return Response.json(
        { name: "client_secret_1-a.apps.googleusercontent.com.json", folder: "Downloads" },
        { status: 201 },
      );
    }
    if (path.startsWith("/api/family-folder")) return Response.json({ ...folder, pending: 0 });
    return new Response("{}", { status: 404 });
  });
}

async function askedFor(path: string) {
  for (let tries = 0; tries < 200; tries++) {
    if (asked.some((ask) => ask.path === path)) return;
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
  throw new Error(`never asked for ${path}`);
}

async function open(text: string) {
  // Radix's radio buttons measure themselves, which jsdom can't.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const router = createMemoryRouter([{ path: "/", element: <RemoveAncesTree /> }]);
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
  act(() => named("Remove AncesTree from this computer…").click());
  await until(text);
}

function box(label: string): HTMLElement {
  const found = [...document.querySelectorAll("label")].find(
    (element) => element.textContent?.trim() === label,
  );
  const id = found?.getAttribute("for");
  const element = id ? document.getElementById(id) : null;
  if (!element) throw new Error(`No "${label}" box`);
  return element;
}

const disabled = (name: string) => (named(name) as HTMLButtonElement).disabled;

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Remove AncesTree from this computer", () => {
  it("says what goes and stays, and has the keeper tick three things before the families go", async () => {
    answer(WINDOWS);
    await open("This computer keeps Keluarga Contoh.");
    const text = document.body.textContent ?? "";
    expect(text).toContain("this computer's families, Keluarga Contoh and Keluarga Ibu");
    expect(text).toContain("the family folder in Google Drive, and the family's other computers");
    expect(text).toContain("Documents\\AncesTree backups first");
    expect(text).toContain("its uninstaller opens with the families' box unticked");

    expect(disabled("Remove AncesTree and its families")).toBe(true);
    expect(disabled("Keep the families on this computer")).toBe(false); // nothing of it goes
    for (const thing of [
      "I have my recovery code",
      "I have my Google project's client file",
      "I can sign in to the keeper's Google account",
    ]) {
      act(() => box(thing).click());
    }
    expect(disabled("Remove AncesTree and its families")).toBe(false);
    expect(named("Hand the family to someone else…").getAttribute("href")).toBe(
      "/settings/family#family-folder",
    );

    act(() => named("Save it again…").click());
    await askedFor("/api/downloads");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/downloads",
      body: { what: "client" },
    });

    act(() => named("Remove AncesTree and its families").click());
    await until("AncesTree is closing, and its uninstaller opening.");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/desktop/removing/remove",
      body: { families: "delete" },
    });
  });

  it("saves every family's backups to a folder first: Documents, a disk, or one typed", async () => {
    // Keluarga Ibu is in AncesTree's bin: its backups are kept too (the user's answer of 19 Nov).
    answer({
      ...WINDOWS,
      families: WINDOWS.families.map((f) => ({ ...f, keeper: false, removed: f.id === "b2" })),
    });
    await open("4 backups");
    const text = document.body.textContent ?? "";
    expect(text).toContain("this computer's family, Keluarga Contoh: its people");
    expect(text).toContain("backups; and Keluarga Ibu, in AncesTree's bin.");
    expect(text).toContain(
      `those of a family in AncesTree's bin into one of its name and "(removed)"`,
    );
    act(() => named("Save the backups to a folder…").click());
    await until("Drive E:");
    act(() => named("Save them there").click()); // Documents, as it opens
    await until("Saved: 4 backups of 2 families");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/desktop/removing/save-backups",
      body: { folder: "C:\\Users\\keluarga\\Documents" },
    });
    expect(document.body.textContent).toContain(
      "C:\\Users\\keluarga\\Documents\\AncesTree backups",
    );
  });

  it("on a relative's Mac: Send now, leaving, and the folder to the Bin", async () => {
    const mac: Removing = {
      ...WINDOWS,
      system: "mac",
      app: "/Applications/AncesTree.app",
      bin: "Bin",
      families: [
        { id: "b2", name: "Keluarga Ibu", open: true, example: false, keeper: false, backups: 1 },
      ],
    };
    const relative = {
      ...FOLDER,
      setup: "member",
      role: "contributor",
      pending: 2,
    } as FamilyFolderStatus;
    answer(mac, relative);
    // The status first says 2 wait; after Send now the app answers with none.
    let sent = false;
    const fetching = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = typeof input === "string" ? new Request(input, init) : (input as Request);
      const path = new URL(request.url).pathname;
      if (path === "/api/family-folder" && !sent) return Response.json(relative);
      if (path === "/api/family-folder/sync") sent = true;
      return fetching(input, init);
    });
    await open("Send now");
    const text = document.body.textContent ?? "";
    expect(text).toContain("this computer's family, Keluarga Ibu: its people");
    expect(text).toContain("Your changes to 2 people and links wait for the keeper");
    expect(text).toContain("Ask your keeper to remove this computer from the family");
    expect(text).toContain("its folder goes to the Bin, where you can still take it out");
    expect(text).toContain("Then drag AncesTree from /Applications to the Bin.");
    expect(named("Leave the family folder…")).toBeDefined();
    expect(disabled("Remove AncesTree and its families")).toBe(false); // no keeper's ticks here

    act(() => named("Send now").click());
    await askedFor("/api/family-folder/sync");
    await until("Nothing of yours is waiting for the keeper.");

    act(() => named("Keep the families on this computer").click());
    await until("AncesTree is quitting.");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/desktop/removing/remove",
      body: { families: "keep" },
    });
  });

  it("from an engine run from the code, removes nothing, and says so", async () => {
    answer({ ...WINDOWS, installed: false });
    await open("removing it does nothing here");
    expect(disabled("Remove AncesTree and its families")).toBe(true);
    expect(disabled("Keep the families on this computer")).toBe(true);
  });
});

describe("what each way out does", () => {
  it("names Linux's AppImage and its Trash", () => {
    const linux = whatHappens({
      ...WINDOWS,
      system: "linux",
      app: "/home/keluarga/Applications/AncesTree.AppImage",
      bin: "Trash",
    });
    expect(linux.remove).toContain("its folder goes to the Trash");
    expect(linux.remove).toContain(
      "Then delete its AppImage, /home/keluarga/Applications/AncesTree.AppImage.",
    );
    expect(linux.keep).toContain("its families stay in its folder");
  });
});
