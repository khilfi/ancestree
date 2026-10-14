// @vitest-environment jsdom
/**
 * Several families on one computer (0.4.0), with the engine's answers made up here: the
 * family's name at the top, with its menu, and Settings → Families. In a browser or a copy,
 * where there's no desktop engine, the address answers 404 and neither shows anything.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopFamilies } from "@/api/desktop";
import { FamiliesSection } from "@/features/settings/FamiliesSection";
import { until } from "@/viewer/looking";
import { AddFamilyDialog, ExampleBar, FamilyMenu, familyPlace } from "./FamilyMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TWO: DesktopFamilies = {
  open: "aaaaaaaaaaaaaaaa",
  families: [
    {
      id: "aaaaaaaaaaaaaaaa",
      name: "Keluarga Contoh",
      open: true,
      role: "keeper",
      in_step: new Date().toISOString(),
      added: "2026-10-01T09:00:00+00:00",
    },
    {
      id: "bbbbbbbbbbbbbbbb",
      name: "Keluarga Ibu",
      open: false,
      role: "",
      in_step: null,
      added: "2026-10-03T09:00:00+00:00",
    },
  ],
  removed: [{ id: "cccccccccccccccc", name: "Practice", removed: "2026-10-03T10:00:00+00:00" }],
};

// The example family, added beside them.
const EXAMPLE = {
  id: "dddddddddddddddd",
  name: "Keluarga Contoh",
  open: false,
  role: "" as const,
  in_step: null,
  added: "2026-10-14T09:00:00+00:00",
  example: true,
};
const WITH_EXAMPLE: DesktopFamilies = { ...TWO, families: [...TWO.families, EXAMPLE] };

let root: Root | undefined;
let asked: string[] = [];

/** The engine's answers: `listed` for its families, or null for no desktop engine. */
function answer(listed: DesktopFamilies | null) {
  asked = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost").pathname;
    const method = init?.method ?? "GET";
    asked.push(`${method} ${url}`);
    if (!listed) return new Response("{}", { status: 404 });
    if (url.endsWith("/open")) return Response.json({ ...listed, opening: "Keluarga Ibu" });
    if (url.endsWith("/example")) return Response.json({ ...WITH_EXAMPLE, added: EXAMPLE.id });
    return Response.json(listed);
  });
}

async function show(page: ReactNode, text?: string) {
  const router = createMemoryRouter([{ path: "/", element: page }]);
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
  if (text) await until(text);
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No "${name}" button`);
  return found;
}

async function settle() {
  for (let tries = 0; tries < 20; tries++) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Several families on one computer", () => {
  it("shows the open family's name at the top, in the desktop app", async () => {
    answer(TWO);
    await show(<FamilyMenu />, "Keluarga Contoh");
  });

  it("shows nothing in a browser or a copy", async () => {
    answer(null);
    await show(<FamilyMenu />);
    await settle();
    expect(asked).toContain("GET /api/desktop/families");
    expect(document.body.textContent).toBe("");
  });

  it("lists each family in Settings, opens another, and puts one back", async () => {
    answer(TWO);
    await show(<FamiliesSection />, "Keluarga Ibu");
    expect(document.body.textContent).toContain("You keep its family folder · in step just now");
    expect(document.body.textContent).toContain("On this computer only");
    expect(document.body.textContent).toContain("Practice · deleted on 2 November");

    act(() => button("Open").click());
    await until("Opening Keluarga Ibu…");
    expect(asked).toContain("POST /api/desktop/families/bbbbbbbbbbbbbbbb/open");

    act(() => button("Put back").click());
    await settle();
    expect(asked).toContain("POST /api/desktop/families/removed/cccccccccccccccc/put-back");
  });

  it("removes a family to AncesTree's bin, once sure", async () => {
    answer(TWO);
    await show(<FamiliesSection />, "Keluarga Ibu");
    act(() => button("Remove…").click());
    await until("Remove Keluarga Ibu from this computer?");
    expect(document.body.textContent).toContain("for 30 days");
    act(() => button("Remove").click());
    await settle();
    expect(asked).toContain("DELETE /api/desktop/families/bbbbbbbbbbbbbbbb");
  });

  it("adds the example family as a family of its own, and opens it", async () => {
    answer(TWO);
    await show(<AddFamilyDialog open onClose={() => {}} />, "the example family");
    act(() => button("The example family").click());
    await until("Opening Keluarga Contoh…");
    expect(asked).toContain("POST /api/desktop/families/example");
    expect(asked).toContain(`POST /api/desktop/families/${EXAMPLE.id}/open`);
    expect(familyPlace(EXAMPLE)).toBe("The example family: made up, to look around in");
  });

  it("offers to open the example family when it's here already", async () => {
    answer(WITH_EXAMPLE);
    await show(<AddFamilyDialog open onClose={() => {}} />, "Open the example family");
  });

  it("says while the example family is open that it's made up, and the way back", async () => {
    const open: DesktopFamilies = {
      ...WITH_EXAMPLE,
      open: EXAMPLE.id,
      families: [
        { ...TWO.families[0], open: false } as DesktopFamilies["families"][number],
        { ...EXAMPLE, open: true },
      ],
    };
    answer(open);
    await show(<ExampleBar />, "its people are made up");
    act(() => button("Back to Keluarga Contoh").click());
    await settle();
    expect(asked).toContain("POST /api/desktop/families/aaaaaaaaaaaaaaaa/open");
  });

  it("says nothing of the example when another family is open", async () => {
    answer(WITH_EXAMPLE);
    await show(<ExampleBar />);
    await settle();
    expect(document.body.textContent).toBe("");
  });
});
