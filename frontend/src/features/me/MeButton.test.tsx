// @vitest-environment jsdom
/**
 * Me in one place: the Me menu, at the top right, chooses who you are, chooses again
 * and forgets, where Settings once did too; someone chosen who is in the Trash now is said
 * there. The engine's answers are made up here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { until } from "@/viewer/looking";
import { MeButton } from "./MeButton";

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

const HASSAN = {
  id: "hassan",
  full_name: "Hassan bin Ismail",
  nickname: "Acan",
  gender: "male",
  photo_version: null,
  birth_date: null,
  death_date: null,
};

let root: Root | undefined;
let sent: unknown[] = [];

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  sent = [];
});

/** Me chosen as Hassan, who is in the tree, or in the Trash. */
async function show(inTheTree: boolean) {
  let me: string | null = "hassan";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (path === "/api/family/me" && request.method === "PUT") {
      const body = await request.json();
      sent.push(body);
      me = body.person;
      return Response.json({ person: me });
    }
    if (path === "/api/family/me") return Response.json({ person: me });
    if (path === "/api/persons/hassan" && inTheTree) return Response.json(HASSAN);
    return Response.json({ detail: "not here" }, { status: 404 });
  });
  const router = createMemoryRouter([{ path: "/", element: <MeButton /> }]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
}

async function openMenu(name: string) {
  await vi.waitFor(() =>
    expect(document.querySelector(`button[aria-label="${name}"]`)).not.toBeNull(),
  );
  act(() => {
    document
      .querySelector(`button[aria-label="${name}"]`)
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
}

describe("Me in one place", () => {
  it("chooses again and forgets who you are, from its menu", async () => {
    await show(true);
    const items = await openMenu("Me: Hassan bin Ismail");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Open my panel",
      "How is someone related to me?",
      "Colour by closeness to me",
      "I'm someone else…",
      "Forget who I am",
    ]);
    await act(async () => items.at(-1)?.click());
    await vi.waitFor(() => expect(sent).toEqual([{ person: null }]));
    await until("Me");
  });

  it("says when the person chosen is in the Trash, and forgets them", async () => {
    await show(false);
    const items = await openMenu("Me: not in the tree any more");
    expect(document.body.textContent).toContain(
      "The person you chose isn't in the tree any more, perhaps in the Trash.",
    );
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "I'm someone else…",
      "Forget who I am",
    ]);
    await act(async () => items.at(-1)?.click());
    await vi.waitFor(() => expect(sent).toEqual([{ person: null }]));
  });
});
