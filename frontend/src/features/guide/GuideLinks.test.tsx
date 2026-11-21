// @vitest-environment jsdom
/**
 * Where the guide opens from: **? Guide** in the top bar, **How does this work?**
 * beside the harder places, and Settings' **Help**, a link to the guide since it repeated it
 *, its old address opening the guide too.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuideLink } from "@/app/AppLayout";
import { appRoutes } from "@/app/routes";
import { until } from "@/viewer/looking";
import { HowDoesThisWork } from "./HowDoesThisWork";

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
async function show(element: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element }]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<RouterProvider router={router} />));
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const links = () =>
  [...document.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);

/** Settings, as the app routes it, the engine answering nothing. */
function settings(address: string) {
  vi.stubGlobal("fetch", async () => Response.json({ detail: "not here" }, { status: 404 }));
  const page = appRoutes[0]?.children?.filter((route) =>
    ["settings", "guide"].includes(route.path ?? ""),
  );
  const router = createMemoryRouter([{ path: "/", children: page }], {
    initialEntries: [address],
  });
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

describe("where the guide opens from", () => {
  it("opens from the top bar's ? Guide", async () => {
    await show(<GuideLink />);
    const link = document.querySelector("a");
    expect(link?.getAttribute("aria-label")).toBe("Guide");
    expect(link?.getAttribute("href")).toBe("/guide");
  });

  it("opens at a place's own section, from its How does this work?", async () => {
    await show(<HowDoesThisWork at="changesWaiting" />);
    expect(links()).toEqual([["How does this work?", "/guide#changes-waiting"]]);
  });

  it("opens from Settings' Help, a link to the guide, and from its old address", async () => {
    settings("/settings/about");
    await until("About");
    const help = [...document.querySelectorAll('nav[aria-label="Settings"] a')].find(
      (link) => link.textContent?.trim() === "Help",
    );
    expect(help?.getAttribute("href")).toBe("/guide");
    act(() => root?.unmount());
    document.body.replaceChildren();

    const router = settings("/settings/help");
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/guide"));
  });
});
