// @vitest-environment jsdom
/**
 * Downloads that say where they went: in the desktop app the engine saves each in
 * Downloads, and the note says so, "Saved to Downloads: …", with Show in folder asking the
 * engine to open it; where the engine answers that the browser saves them, as in a browser or
 * a copy, the browser's own download, as ever. The engine's answers are made up here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveDownload, saveDrawn } from "./downloads";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

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

type Asked = { path: string; body: unknown };
let asked: Asked[] = [];
let clicked: { href: string; download: string }[] = [];

/** The engine: saving as the desktop app's does, or saying the browser saves them. */
function engine(desktop: boolean) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    // The picture comes as a form, as uploads do; the rest through the API's client.
    const form = init?.body instanceof FormData ? init.body : null;
    const request = input instanceof Request ? input : null;
    const path = new URL(request?.url ?? String(input), window.location.href).pathname;
    const body = form ? Object.fromEntries(form.entries()) : await request?.json();
    asked.push({ path, body });
    if (!desktop) {
      return Response.json(
        { detail: { code: "browser_saves", message: "Here the browser saves downloads." } },
        { status: 409 },
      );
    }
    if (path === "/api/downloads/show") return new Response(null, { status: 204 });
    const name =
      path === "/api/downloads/picture"
        ? String((body as { name: string }).name)
        : "ancestree-import-template (2).csv";
    return Response.json({ name, folder: "Downloads" }, { status: 201 });
  });
}

beforeEach(() => {
  asked = [];
  clicked = [];
  toasts.success.mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.getAttribute("href") ?? "", download: this.download });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloads that say where they went", () => {
  it("saves through the engine, and says where, with Show in folder", async () => {
    engine(true);
    const noted = await saveDownload(
      { what: "template" },
      "/api/imports/template",
      "ancestree-import-template.csv",
    );
    expect(noted).toBe(true);
    expect(asked[0]).toEqual({ path: "/api/downloads", body: { what: "template" } });
    expect(clicked).toEqual([]); // no browser download beside it
    const [words, options] = toasts.success.mock.calls[0] ?? [];
    expect(words).toBe("Saved to Downloads: ancestree-import-template (2).csv");
    expect(options.action.label).toBe("Show in folder");

    options.action.onClick();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toEqual({
      path: "/api/downloads/show",
      body: { name: "ancestree-import-template (2).csv" },
    });
  });

  it("carries what more there is to know in the note", async () => {
    engine(true);
    await saveDownload(
      { what: "export", name: "ancestree-keluarga-contoh-2026-10-17.html" },
      "/api/exports/ancestree-keluarga-contoh-2026-10-17.html",
      "ancestree-keluarga-contoh-2026-10-17.html",
      "It opens in any browser: send it as a file.",
    );
    const [, options] = toasts.success.mock.calls[0] ?? [];
    expect(options.description).toBe("It opens in any browser: send it as a file.");
  });

  it("saves the tree's picture through the engine too", async () => {
    engine(true);
    const blob = new Blob(["<svg/>"], { type: "image/svg+xml" });
    expect(await saveDrawn(blob, "ancestree-tree-2026-10-17.svg")).toBe(true);
    expect(asked[0]?.path).toBe("/api/downloads/picture");
    expect((asked[0]?.body as { name?: string } | undefined)?.name).toBe(
      "ancestree-tree-2026-10-17.svg",
    );
    expect(toasts.success.mock.calls[0]?.[0]).toBe(
      "Saved to Downloads: ancestree-tree-2026-10-17.svg",
    );
  });

  it("lets the browser save it where the engine doesn't", async () => {
    engine(false);
    const noted = await saveDownload(
      { what: "example" },
      "/api/imports/template?example=true",
      "ancestree-import-example.csv",
    );
    expect(noted).toBe(false);
    expect(clicked).toEqual([
      { href: "/api/imports/template?example=true", download: "ancestree-import-example.csv" },
    ]);
    expect(toasts.success).not.toHaveBeenCalled();
  });
});
