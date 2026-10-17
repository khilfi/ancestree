// @vitest-environment jsdom
/**
 * Settings in fewer places: Kinship, and You and your family, each with its parts
 * headed and listed at the top, each a click away; the old addresses opening the new page at
 * their part; and every Settings link in the app landing on its page, and its part. The
 * engine's answers are made up here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, matchRoutes, type RouteObject, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRoutes } from "@/app/routes";
import { until } from "@/viewer/looking";

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

const SETTINGS = appRoutes[0]?.children?.find((route) => route.path === "settings");
if (!SETTINGS) throw new Error("no Settings");
const ROUTES: RouteObject[] = [{ path: "/", children: [SETTINGS] }];

const FAMILIES = {
  open: "aaaaaaaaaaaaaaaa",
  families: [
    {
      id: "aaaaaaaaaaaaaaaa",
      name: "Keluarga Contoh",
      open: true,
      role: "",
      in_step: null,
      added: "2026-10-01T09:00:00+00:00",
    },
  ],
  removed: [],
};

/** The engine's answers: a family on its own, with no family folder; `desktop` for the
 *  desktop app's families, which a browser doesn't have. */
function answer(desktop: boolean) {
  const answers: Record<string, unknown> = {
    "/api/me": { person: null },
    "/api/kinds": [],
    "/api/kinship/settings": { language: "en", titles: ["long"], youngest: "su" },
    "/api/trash": [],
    "/api/family-folder": {
      available: false,
      email: null,
      setup: null,
      asking: [],
      changes: [],
      answers: [],
      members: [],
    },
    ...(desktop ? { "/api/desktop/families": FAMILIES } : {}),
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
      .pathname;
    return path in answers
      ? Response.json(answers[path])
      : Response.json({ detail: "not here" }, { status: 404 });
  });
}

let root: Root | undefined;
let brought: string[] = [];

beforeEach(() => {
  brought = [];
  // jsdom lays nothing out: note which part was brought into view.
  Element.prototype.scrollIntoView = function (this: Element) {
    brought.push(this.id);
  };
});

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function open(address: string) {
  const router = createMemoryRouter(ROUTES, { initialEntries: [address] });
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
  return router;
}

function heading(part: string): string | undefined {
  return document.getElementById(part)?.querySelector("h2")?.textContent ?? undefined;
}

const listed = (label: string) =>
  [...document.querySelectorAll(`nav[aria-label="${label}"] a`)].map((link) =>
    link.textContent?.trim(),
  );

describe("Settings in fewer places", () => {
  it("reads Kinship, You and your family, then the rest", async () => {
    answer(true);
    open("/settings");
    await until("Relationship kinds");
    expect(listed("Settings")).toEqual([
      "Kinship",
      "You and your family",
      "What's missing",
      "Import",
      "Map",
      "Backups",
      "Trash",
      "Help",
      "About",
    ]);
  });

  it("shows Kinship's two parts, headed, and lists them at the top", async () => {
    answer(true);
    const router = open("/settings/kinship");
    await until("Relationship kinds");
    expect(listed("On this page")).toEqual(["Kinship words", "Relationship kinds"]);
    expect([heading("words"), heading("kinds")]).toEqual(["Kinship words", "Relationship kinds"]);
    expect(router.state.location.hash).toBe("");
    expect(brought).toEqual([]); // opened at its top
  });

  it("shows You and your family's three parts in the desktop app, and two in a browser", async () => {
    answer(true);
    open("/settings/family");
    await until("Add a family…");
    expect(listed("On this page")).toEqual(["Me", "Families", "Family folder"]);
    expect([heading("me"), heading("families"), heading("family-folder")]).toEqual([
      "Me",
      "Families",
      "Family folder",
    ]);
    act(() => root?.unmount());
    document.body.replaceChildren();

    answer(false);
    open("/settings/family");
    await until("Family folder");
    expect(listed("On this page")).toEqual(["Me", "Family folder"]);
    expect(document.getElementById("families")).toBeNull();
  });

  it("brings a part into view when its name at the top is clicked", async () => {
    answer(true);
    const router = open("/settings/family");
    await until("Add a family…");
    const link = [...document.querySelectorAll('nav[aria-label="On this page"] a')].find(
      (each) => each.textContent === "Family folder",
    );
    await act(async () =>
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
    expect(router.state.location.hash).toBe("#family-folder");
    expect(brought.at(-1)).toBe("family-folder");
  });

  it.each([
    ["/settings/me", "/settings/family", "me", "Me"],
    ["/settings/families", "/settings/family", "families", "Families"],
    ["/settings/family-folder", "/settings/family", "family-folder", "Family folder"],
    ["/settings/kinds", "/settings/kinship", "kinds", "Relationship kinds"],
  ])("opens %s, an old address, at its part", async (old, page, part, title) => {
    answer(true);
    const router = open(old);
    await until(title);
    await until("On this page");
    expect(router.state.location.pathname).toBe(page);
    expect(router.state.location.hash).toBe(`#${part}`);
    for (let tries = 0; tries < 100 && !document.getElementById(part); tries++) {
      await act(async () => new Promise((done) => setTimeout(done, 10)));
    }
    expect(heading(part)).toBe(title);
    expect(brought).toContain(part);
  });

  it("leads every Settings link in the app to its page, and its part", async () => {
    const src = join(process.cwd(), "src"); // the tests run in frontend/
    const found = new Set<string>();
    for (const name of readdirSync(src, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) continue;
      const text = readFileSync(join(src, name), "utf-8");
      for (const [, address] of text.matchAll(/["'`](\/settings(?:\/[\w-]+)?(?:#[\w-]+)?)["'`]/g)) {
        if (address) found.add(address);
      }
    }
    expect(found).toContain("/settings/family#family-folder");
    expect(found).toContain("/settings/family#families");
    for (const address of found) {
      const [path = "", part] = address.split("#");
      expect(matchRoutes(ROUTES, path), address).not.toBeNull();
      if (!part) continue;
      answer(true);
      open(address);
      for (let tries = 0; tries < 200 && !document.getElementById(part); tries++) {
        await act(async () => new Promise((done) => setTimeout(done, 10)));
      }
      expect(heading(part), address).toBeTruthy();
      act(() => root?.unmount());
      document.body.replaceChildren();
    }
  });
});
