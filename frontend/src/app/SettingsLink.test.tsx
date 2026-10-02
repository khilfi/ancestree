// @vitest-environment jsdom
/**
 * The top bar's Settings: how many things wait in Settings → Family folder, with the
 * folder's answers made up here, so the keeper sees relatives' changes from anywhere.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { until } from "@/viewer/looking";
import { SettingsLink } from "./AppLayout";

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

let root: Root | undefined;

async function show(status: object) {
  vi.stubGlobal("fetch", async () => Response.json(status));
  const router = createMemoryRouter([{ path: "/", element: <SettingsLink /> }]);
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
  await until("Settings");
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the top bar's Settings", () => {
  it("counts the computers asking to join and the changes waiting, for the keeper", async () => {
    await show({ setup: "keeper", asking: [{ device: "a1" }], changes: [{}, {}], answers: [] });
    await until("3");
    const link = document.querySelector("a");
    expect(link?.getAttribute("aria-label")).toBe("Settings: 3 waiting in Family folder");
  });

  it("shows no count when nothing waits", async () => {
    await show({ setup: "keeper", asking: [], changes: [], answers: [] });
    const link = document.querySelector("a");
    expect(link?.getAttribute("aria-label")).toBe("Settings");
    expect(link?.textContent).toBe("Settings");
  });
});
