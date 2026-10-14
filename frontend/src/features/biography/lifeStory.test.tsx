// @vitest-environment jsdom
/**
 * The life story at the heart of AncesTree, with the engine's answers made up here:
 * its window opening on Read where there's a story and on Write where there isn't; the page
 * laid out, its parts as cards, sayings as quotes, the message framed, the line of their life,
 * and their family a click away; writing a part, saved into the one file; the panel's preview;
 * the book mark on a photo; Print; and a view-only copy reading only. People and words are made
 * up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "@/api/queries";
import type { Biography, Graph, PersonDetail } from "@/api/types";
import { type CopyAbout, CopyProvider } from "@/app/copy";
import { closeLifeStory, openLifeStory } from "@/lib/lifeStory";
import { until } from "@/viewer/looking";
import { BiographyTab, opening } from "./BiographyTab";
import { LifeStoryHost, lifeLine } from "./LifeStory";
import { StoryMark } from "./StoryMark";

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

const summary = (id: string, full_name: string, label: string, birth_year: number | null) => ({
  id,
  full_name,
  nickname: null,
  gender: "female",
  birth_year,
  death_year: null,
  photo_version: null,
  placeholder: false,
  label,
  link_id: null,
});
const hassan = {
  id: "hassan",
  full_name: "Hassan bin Ismail",
  nickname: "Acan",
  title: "Haji",
  name_jawi: null,
  gender: "male",
  birth_date: { value: { year: 1938 }, description: "14 March 1938", text: "14/3/1938" },
  birth_place: { town: "Kota Bharu", state: "Kelantan", country: "Malaysia" },
  death_date: { value: { year: 2011 }, description: "2011", text: "2011" },
  death_place: null,
  residence: null,
  placeholder: false,
  photo_version: null,
  is_living: false,
  parents: [summary("ismail", "Ismail bin Ahmad", "Father", 1901)],
  spouses: [summary("mariam", "Mariam binti Daud", "Wife", 1942)],
  siblings: [],
  child_groups: [
    {
      children: [
        summary("karim", "Karim bin Hassan", "Son", 1965),
        summary("aminah", "Aminah binti Hassan", "Daughter", 1962),
      ],
      other_parents: [],
      order_decided: true,
    },
  ],
} as unknown as PersonDetail;
const aminah = { ...hassan, id: "aminah", full_name: "Aminah binti Hassan" } as PersonDetail;

const TOLD: Biography = {
  story: "Hassan was born in Kota Bharu, the eldest of four.",
  parts: {
    talents: "- Whistling like a bulbul",
    sayings: "- Sabar itu separuh daripada iman — to his children, often",
    message: "Look after one another.",
  },
  sources: ["Birth certificate, 1938"],
  version: "v1",
};
const NONE: Biography = { story: "", parts: {}, sources: [], version: "none" };
// Words written here, as the engine keeps them.
const WORDS_BY_ME = {
  id: "0b9816fc",
  text: "",
  writer: "Zulkifli bin Hassan",
  device: null,
  written: "2026-10-14",
  changed: null,
  yours: true,
};

let root: Root | undefined;
let saved: unknown[] = [];

afterEach(() => {
  act(() => closeLifeStory());
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  saved = [];
});

function answer(stories: Record<string, Biography>, folder: object | null = null) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (path === "/api/family-folder" && folder) return Response.json(folder);
    // Words about someone: written, changed, or taken away, answered with the story.
    const said = /^\/api\/persons\/([^/]+)\/said(?:\/([^/]+))?$/.exec(path);
    // Each answers with the story as it's kept then, and keeps it so, as the engine does.
    if (said) {
      const id = said[1] ?? "";
      const body = request.method === "DELETE" ? null : await request.json();
      saved.push({ method: request.method, said: said[2] ?? null, body });
      const now = stories[id] ?? NONE;
      const words = (now.said ?? []).filter((each) => each.id !== said[2]);
      if (request.method === "POST") {
        words.push({ ...WORDS_BY_ME, text: body.text });
      }
      stories[id] = { ...now, said: words };
      return Response.json(stories[id]);
    }
    const story = /^\/api\/persons\/([^/]+)\/biography$/.exec(path);
    if (story && request.method === "PUT") {
      const body = await request.json();
      saved.push(body);
      const id = story[1] ?? "";
      const { base_version: _, ...kept } = body;
      stories[id] = { ...kept, said: stories[id]?.said ?? [], version: `v${saved.length + 1}` };
      return Response.json(stories[id]);
    }
    if (story) return Response.json(stories[story[1] ?? ""] ?? NONE);
    const person = /^\/api\/persons\/([^/]+)$/.exec(path);
    if (person) return Response.json(person[1] === "aminah" ? aminah : hassan);
    return new Response("{}", { status: 404 });
  });
}

function show(element: ReactNode, copy: CopyAbout | null = null) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <CopyProvider value={copy}>
          {element}
          <LifeStoryHost />
        </CopyProvider>
      ),
    },
  ]);
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
  return client;
}

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((each) => each.textContent?.trim() === name);

/** The window's own Read or Write, and whether it's the one shown. */
const windowButton = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button[aria-pressed]")].find(
    (each) => each.textContent?.trim() === name,
  );
const pressed = (name: string) => windowButton(name)?.getAttribute("aria-pressed");

describe("the life story's window", () => {
  it("opens on Read where there's a story, laid out as a page", async () => {
    answer({ hassan: TOLD });
    show(null);
    act(() => openLifeStory("hassan"));
    await until("Hassan bin Ismail: life story");
    await until("Hidden talents");
    expect(pressed("Read")).toBe("true");
    const page = document.querySelector(".life-story-page")?.textContent ?? "";
    expect(page).toContain("Haji Hassan bin Ismail");
    expect(page).toContain("Born, 14 March 1938, Kota Bharu, Kelantan");
    // The parts in their order, whatever order they were given in: sayings, message, talents.
    const cards = [...document.querySelectorAll("section[aria-label]")].map((s) =>
      s.getAttribute("aria-label"),
    );
    expect(cards).toEqual([
      "Their story",
      "Sayings and quotes",
      "A message to the next generations",
      "Hidden talents",
    ]);
    expect(document.querySelector("blockquote")?.textContent).toBe(
      "“Sabar itu separuh daripada iman”",
    );
    expect(document.querySelector("figcaption")?.textContent).toBe("to his children, often");
    expect(page).toContain("Birth certificate, 1938");
  });

  it("opens on Write where there's none yet, and saves a part into the one file", async () => {
    answer({});
    const client = show(null);
    // The tree as the app holds it: Hassan with no story, so no book mark yet.
    const tree = { people: [{ id: "hassan", has_story: false }], links: [] } as unknown as Graph;
    client.setQueryData(keys.graph, tree);
    act(() => openLifeStory("hassan"));
    await until("The parts of their life");
    expect(pressed("Write")).toBe("true");
    act(() => button("Hidden talents")?.click());
    const talent = document.querySelector<HTMLTextAreaElement>('[aria-label="Hidden talents: 1"]');
    expect(talent).toBeNull(); // empty: just the button to add one
    act(() => button("Add one")?.click());
    const first = document.querySelector<HTMLTextAreaElement>('[aria-label="Hidden talents: 1"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        first,
        "Whistling like a bulbul",
      );
      first?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 2300)); // a pause in typing saves
    });
    expect(saved).toEqual([
      {
        story: "",
        parts: { talents: "- Whistling like a bulbul" },
        sources: [],
        base_version: "none",
      },
    ]);
    // Written, they have their book mark at once, with no reading of the tree again.
    expect(client.getQueryData<Graph>(keys.graph)?.people[0]?.has_story).toBe(true);
  });

  it("reads what was just written, and writes on from what's saved, words added between", async () => {
    answer({});
    show(null);
    act(() => openLifeStory("hassan"));
    await until("The parts of their life");
    act(() => button("Hidden talents")?.click());
    act(() => button("Add one")?.click());
    type(
      document.querySelector<HTMLTextAreaElement>('[aria-label="Hidden talents: 1"]'),
      "Whistling like a bulbul",
    );
    act(() => windowButton("Read")?.click()); // before the pause in typing: saved on leaving
    await until("Whistling like a bulbul");
    expect(document.querySelector('section[aria-label="Hidden talents"]')).not.toBeNull();
    act(() => button("Add your words")?.click());
    type(
      document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Your words about Hassan bin Ismail"]',
      ),
      "He taught me to fish.",
    );
    await act(async () => button("Save")?.click());
    await until("— Zulkifli bin Hassan, 14 October 2026");
    act(() => windowButton("Write")?.click());
    await until("The parts of their life");
    // Filled in, the part opens by itself, with what was written in it.
    expect(
      document.querySelector<HTMLTextAreaElement>('[aria-label="Hidden talents: 1"]')?.value,
    ).toBe("Whistling like a bulbul");
    expect(document.body.textContent).not.toContain("changed outside AncesTree");
  });

  it("goes to a relative's life story from the family strip", async () => {
    answer({ hassan: TOLD });
    show(null);
    act(() => openLifeStory("hassan"));
    await until("Their family");
    const chip = [...document.querySelectorAll("button")].find((each) =>
      each.textContent?.endsWith("Aminah binti HassanDaughter"),
    );
    act(() => chip?.click());
    await until("Aminah binti Hassan: life story");
  });

  it("prints the page alone", async () => {
    answer({ hassan: TOLD });
    const print = vi.fn();
    vi.stubGlobal("print", print);
    show(null);
    act(() => openLifeStory("hassan"));
    await until("Print");
    act(() => button("Print")?.click());
    expect(print).toHaveBeenCalled();
    expect(document.querySelector(".life-story-print")).not.toBeNull();
  });

  it("only reads, in a view-only copy", async () => {
    answer({ hassan: TOLD });
    const copy = { title: "Keluarga", hidden_living: false } as CopyAbout;
    show(null, copy);
    act(() => openLifeStory("hassan", "write")); // asked to write, it still reads
    await until("Hidden talents");
    expect(button("Write")).toBeUndefined();
    expect(document.body.textContent).not.toContain("The parts of their life");
  });
});

describe("the line of their life", () => {
  it("is born, married, their children born by year, and died, from what's known", () => {
    expect(lifeLine(hassan).map((moment) => [moment.label, moment.when])).toEqual([
      ["Born", "14 March 1938"],
      ["Wife: Mariam binti Daud", ""],
      ["Daughter Aminah binti Hassan born", "1962"],
      ["Son Karim bin Hassan born", "1965"],
      ["Died", "2011"],
    ]);
  });
});

describe("where the life story opens from", () => {
  it("is previewed in the panel's Biography tab, with Read and Write", async () => {
    answer({ hassan: TOLD });
    show(<BiographyTab person={hassan} />);
    await until("Hassan was born in Kota Bharu");
    expect(document.body.textContent).toContain(
      "Also writtenSayings and quotesA message to the next generationsHidden talents",
    );
    act(() => button("Write")?.click());
    await until("Hassan bin Ismail: life story");
    expect(pressed("Write")).toBe("true");
  });

  it("previews the story's opening as plain sentences, its headings left out", () => {
    const story =
      "Known as *Acan*, he was born in [Kota Bharu](https://example.org).\n\n" +
      "## The railway years\n\nHe joined the railway at twenty.\n\n![At Gemas](media/a.webp)";
    expect(opening(story)).toBe(
      "Known as Acan, he was born in Kota Bharu. He joined the railway at twenty.",
    );
    expect(opening(`${"word ".repeat(100)}end`)).toMatch(/^(word ){83}word…$/);
  });

  it("is the book mark on the photo of anyone with a story", async () => {
    answer({ hassan: TOLD });
    show(
      <>
        <StoryMark person={{ id: "hassan", full_name: "Hassan bin Ismail", has_story: true }} />
        <StoryMark person={{ id: "aminah", full_name: "Aminah binti Hassan", has_story: false }} />
      </>,
    );
    expect(document.querySelectorAll('[title="Life story"]')).toHaveLength(1);
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Hassan bin Ismail\'s life story"]')
        ?.click(),
    );
    await until("Hassan bin Ismail: life story");
  });
});

const WORDS: Biography = {
  ...TOLD,
  said: [
    {
      id: "1a2b3c4d",
      text: "He taught me to fish.",
      writer: "Zulkifli bin Hassan",
      device: null,
      written: "2026-10-14",
      changed: null,
      yours: true,
    },
    {
      id: "7a8b9c0d",
      text: "The kindest man at Gemas.",
      writer: "Nor binti Hassan",
      device: "fedcba9876543210",
      written: "2026-10-12",
      changed: "2026-10-13",
      yours: false,
      computer: "Nor's laptop", // written on another computer: its name beside hers (0.8.0)
    },
  ],
};

/** Types into the box as a person would. */
function type(box: HTMLTextAreaElement | null, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
    box?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const captions = () =>
  [...document.querySelectorAll("#what-people-say ~ ul figcaption > span:first-child")].map(
    (each) => each.textContent,
  );

describe("what people say about them", () => {
  it("shows each one's words, signed and dated, after their family and before the sources", async () => {
    answer({ hassan: WORDS });
    show(null);
    act(() => openLifeStory("hassan"));
    await until("What people say about Hassan bin Ismail");
    expect(captions()).toEqual([
      "— Zulkifli bin Hassan, 14 October 2026",
      "— Nor binti Hassan (Nor's laptop), 12 October 2026 (changed 13 October 2026)",
    ]);
    const order = [...document.querySelectorAll("h2")].map((each) => each.textContent);
    expect(order.slice(-3)).toEqual([
      "Their family",
      "What people say about Hassan bin Ismail",
      "Sources",
    ]);
  });

  it("writes your words, changes and takes back your own, and the keeper takes out another's", async () => {
    answer({ hassan: WORDS });
    show(null);
    act(() => openLifeStory("hassan"));
    await until("What people say about Hassan bin Ismail");
    act(() => button("Add your words")?.click());
    type(
      document.querySelector('[aria-label="Your words about Hassan bin Ismail"]'),
      "He sang at every wedding.",
    );
    await act(async () => button("Save")?.click());
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    // Only your own may be changed; with no family folder, this computer keeps the family.
    expect(button("Change")).not.toBeUndefined();
    expect(button("Take back")).not.toBeUndefined();
    act(() => button("Take out")?.click());
    await until("Take out Nor binti Hassan's words?");
    await act(async () =>
      [...document.querySelectorAll("button")]
        .filter((each) => each.textContent?.trim() === "Take out")
        .at(-1)
        ?.click(),
    );
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(saved).toEqual([
      { method: "POST", said: null, body: { text: "He sang at every wedding." } },
      { method: "DELETE", said: "7a8b9c0d", body: null },
    ]);
  });

  it("on a viewer's computer, adds their words, writes no story, and takes out no one else's", async () => {
    answer({ hassan: WORDS }, { setup: "member", role: "viewer", family: "Keluarga Contoh" });
    show(null);
    act(() => openLifeStory("hassan"));
    await until("What people say about Hassan bin Ismail");
    await until("Add your words");
    expect(pressed("Write")).toBeUndefined();
    expect(button("Take out")).toBeUndefined();
  });

  it("in a view-only copy, are only read", async () => {
    answer({ hassan: WORDS });
    show(null, { title: "Keluarga", hidden_living: false } as CopyAbout);
    act(() => openLifeStory("hassan"));
    await until("What people say about Hassan bin Ismail");
    expect(captions()).toHaveLength(2);
    for (const name of ["Add your words", "Change", "Take back", "Take out"]) {
      expect(button(name)).toBeUndefined();
    }
  });
});
