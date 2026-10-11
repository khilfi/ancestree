// @vitest-environment jsdom
/**
 * Where the guide opens from: **? Guide** in the top bar, **How does this work?**
 * beside the harder places, and Settings → Help, with the guide's contents and its search.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { GuideLink } from "@/app/AppLayout";
import { HelpSection } from "@/features/settings/HelpSection";
import { HowDoesThisWork } from "./HowDoesThisWork";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const links = () =>
  [...document.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);

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

  it("opens from Settings → Help, at any section, or the newest online", async () => {
    await show(<HelpSection />);
    const found = Object.fromEntries(links());
    expect(found["Open the guide"]).toBe("/guide");
    expect(found["20. Backups"]).toBe("/guide#20-backups");
    expect(found["The newest guide, online"]).toBe(
      "https://github.com/khilfi/ancestree/blob/main/GUIDE.md",
    );
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search the guide"]');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(search, "invitation");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const results = document.querySelector('ul[aria-label="Found in the guide"]');
    expect(results?.querySelectorAll("a").length).toBeGreaterThan(2);
  });
});
