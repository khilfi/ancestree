// @vitest-environment jsdom
/**
 * The user guide inside the app: opened at the section its address names, with its own
 * links working as on GitHub and Back returning; found by search; pictures opening larger; lists
 * numbered as on GitHub; and every section of the real guide read without trouble.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { until } from "@/viewer/looking";
import { GuidePage } from "./GuidePage";
import { GuideText } from "./GuideText";
import { GUIDE, readGuide, type Section } from "./guide";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

async function show(at: string) {
  const router = createMemoryRouter(
    [
      { path: "/guide", element: <GuidePage /> },
      { path: "/tree", element: <p>The tree</p> },
    ],
    { initialEntries: ["/tree", at], initialIndex: 1 },
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<RouterProvider router={router} />));
  return router;
}

const article = () => document.querySelector("article")?.textContent ?? "";

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => (element as HTMLElement).click());
}

describe("the guide in the app", () => {
  afterEach(() => {
    act(() => root?.unmount());
    document.body.replaceChildren();
  });

  it("opens at the section its address names, its contents beside it", async () => {
    await show("/guide#13-the-map");
    await until("Click Map in the top bar");
    expect(article()).toContain("13. The map");
    const contents = document.querySelector('nav[aria-label="The guide\'s contents"]');
    expect(contents?.textContent).toContain("20. Backups");
    expect(contents?.querySelector('[aria-current="page"]')?.textContent).toBe("13. The map");
  });

  it("follows its own links between sections, and Back returns", async () => {
    const router = await show("/guide");
    await until("This guide is for everyone in the family");
    const link = [...document.querySelectorAll("article a")].find(
      (each) => each.getAttribute("href") === "#13-the-map",
    );
    await click(link);
    await until("Click Map in the top bar");
    expect(router.state.location.hash).toBe("#13-the-map");
    await click(
      [...document.querySelectorAll("button")].find((each) => each.textContent === "Back"),
    );
    await until("This guide is for everyone in the family");
    expect(router.state.location.hash).toBe("");
  });

  it("finds sections by their words", async () => {
    await show("/guide");
    await until("This guide is for everyone in the family");
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search the guide"]');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(search, "backups");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const found = document.querySelector('ul[aria-label="Found in the guide"]');
    expect(found?.querySelector("a")?.textContent).toContain("20. Backups");
    await click(found?.querySelector("a"));
    await until("A backup holds");
  });

  it("opens a picture larger", async () => {
    await show("/guide#13-the-map");
    await until("Click Map in the top bar");
    // jsdom loads no pictures, so MDXEditor shows its placeholder: one of the guide's, as a
    // browser shows it once loaded, stands in for it.
    const picture = document.createElement("img");
    picture.src = "/guide/app-map.png";
    picture.alt = "The map";
    document.querySelector("article .guide-text p")?.append(picture);
    await click(picture);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("img")?.getAttribute("alt")).toBe("The map");
  });

  it("numbers a list from its first number, as GitHub does", async () => {
    const render = async (section: Section | undefined) => {
      if (!section) throw new Error("no section");
      const host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () =>
        root?.render(
          <GuideText
            section={section}
            target={section.slug}
            onOpen={() => {}}
            onPicture={() => {}}
          />,
        ),
      );
      return host;
    };
    const numbers = (host: HTMLElement, words: string) =>
      [...host.querySelectorAll("ol > li")]
        .filter((item) => item.textContent?.startsWith(words))
        .map((item) => (item as HTMLLIElement).value);

    // The guide's contents: Part 2 goes on from 5.
    const contents = await render(GUIDE.sections[0]);
    await until("A tour of the window");
    expect(numbers(contents, "Words used in this guide")).toEqual([1]);
    expect(numbers(contents, "A tour of the window")).toEqual([5]);
    act(() => root?.unmount());

    // And a list inside a list.
    const nested = await render(
      readGuide("# Steps\n\n3. Three\n4. Four\n\n- Inside\n\n  7. Seven\n  8. Eight\n").sections[0],
    );
    await until("Eight");
    expect([...numbers(nested, "Three"), ...numbers(nested, "Four")]).toEqual([3, 4]);
    expect([...numbers(nested, "Seven"), ...numbers(nested, "Eight")]).toEqual([7, 8]);
  });

  it("reads every section of the guide", { timeout: 60_000 }, async () => {
    for (const section of GUIDE.sections) {
      const host = document.createElement("div");
      document.body.append(host);
      const one = createRoot(host);
      await act(async () =>
        one.render(
          <GuideText
            section={section}
            target={section.slug}
            onOpen={() => {}}
            onPicture={() => {}}
          />,
        ),
      );
      await until(section.title);
      expect(host.querySelector(".guide-unreadable"), section.title).toBeNull();
      act(() => one.unmount());
      host.remove();
    }
  });
});
