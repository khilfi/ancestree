// @vitest-environment jsdom
/**
 * Settings → Kinship → Malay birth-order titles, on a relative's computer (0.3.1): the titles
 * are the family's, set by the keeper, so they're shown, not changed. The language of the
 * kinship words is set where they're seen, no longer here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { until } from "@/viewer/looking";
import { KinshipSection } from "./KinshipSection";

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

let root: Root | undefined;

function answer(setup: "keeper" | "member" | null) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL((input as Request).url).pathname;
    if (path === "/api/kinship/settings") {
      return Response.json({ language: "ms", titles: ["long", "ngah", "lang"], youngest: "su" });
    }
    if (path === "/api/family-folder") return Response.json({ setup, role: null });
    return new Response("{}", { status: 404 });
  });
}

async function show() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <KinshipSection />
      </QueryClientProvider>,
    ),
  );
  await until("Malay birth-order titles");
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Settings → Kinship → Malay birth-order titles", () => {
  it("keeps the titles alone: the language is set where the words are seen", async () => {
    answer("keeper");
    await show();
    await vi.waitFor(() => expect(document.querySelector("#title-0")).not.toBeNull());
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Bahasa Melayu");
    expect(document.body.textContent).toContain("beside how two people are related");
  });

  it("shows a relative the family's titles, set by the keeper, and nothing to change them", async () => {
    answer("member");
    await show();
    await until("the family's keeper sets them");
    const first = document.querySelector<HTMLInputElement>("#title-0");
    await vi.waitFor(() => expect(first?.disabled).toBe(true));
    expect(first?.value).toBe("long");
    const save = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "Save titles",
    );
    expect(save?.closest(".hidden")).not.toBeNull();
  });

  it("lets the keeper set them", async () => {
    answer("keeper");
    await show();
    await until("so set your family's here");
    await vi.waitFor(() => expect(document.querySelector("#title-0")).not.toBeNull());
    expect(document.querySelector<HTMLInputElement>("#title-0")?.disabled).toBe(false);
  });
});
