// @vitest-environment jsdom
import { MDXEditor, type MDXEditorMethods } from "@mdxeditor/editor";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { needsPlainText, pictureUrl, STORY_MARKDOWN, storyPlugins } from "./story";

// act() outside a testing library needs this flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Opens a story in the editor exactly as the Biography tab does, has the editor read it in
 * again (as on reopening) and returns what it would save, plus any story it couldn't read.
 */
async function throughTheEditor(story: string): Promise<{ saved: string; errors: string[] }> {
  const editor = createRef<MDXEditorMethods>();
  const errors: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MDXEditor
        ref={editor}
        markdown={story}
        plugins={storyPlugins()}
        suppressHtmlProcessing
        toMarkdownOptions={STORY_MARKDOWN}
        onError={({ error }) => errors.push(error)}
      />,
    );
  });
  // Reading it in again makes the editor write it out: what a save would send.
  await act(async () => editor.current?.setMarkdown("-"));
  await act(async () => editor.current?.setMarkdown(story));
  const saved = editor.current?.getMarkdown() ?? "";
  await act(async () => root.unmount());
  host.remove();
  return { saved, errors };
}

// Five stories as the editor writes them.
const STORIES: Record<string, string> = {
  "headings, emphasis, a list and a quote": `## Early life

Hassan was born in Kota Bharu in 1938, the eldest of four children.

He went to school in the town, walking there with his brothers **every morning**.

## Work

He worked on the railway for thirty years, from *1958* until he retired.

- Station master at Kuala Krai
- Then at Gemas

> "The trains were never late when Acan was on duty," his friends used to say.

He died in 2011, surrounded by his family.`,

  "pictures and links": `![Hassan at Gemas station](media/2026-09-27-4f3a9c.webp)

The family moved to [Gemas](https://en.wikipedia.org/wiki/Gemas) in 1962, where *everyone* knew him.

![](media/2026-09-28-0b1c2d.webp)

### Later

They came back to Kelantan when he retired.`,

  "numbered and nested lists and a divider": `Their children, from the eldest:

1. Aminah
2. Yusof
   - married twice
   - lived in Johor Bahru
3. Nor

---

Written down by Nor in 2019.`,

  "Malay, Jawi and other scripts": `## Nama

Nama penuh beliau Hassan bin Ismail (حسن بن إسماعيل), dipanggil *Acan*.

Beliau suka bercerita tentang zaman Jepun — "masa susah", katanya. 🌾

Kampung: Pasir Mas, 1938–1956.`,

  // Lines broken with Shift+Enter are plain line ends, as typed in Notepad.
  "a pantun, line by line": `A pantun he liked to say:

> Pisang emas dibawa belayar,
> Masak sebiji di atas peti;
> Hutang emas boleh dibayar,
> Hutang budi dibawa mati.

He said it at every wedding.`,
};

describe("stories survive saving and reopening unchanged", () => {
  for (const [name, story] of Object.entries(STORIES)) {
    it(name, async () => {
      const { saved, errors } = await throughTheEditor(story);

      expect(errors).toEqual([]);
      expect(saved).toBe(story);
    });
  }
});

describe("stories written elsewhere", () => {
  it("keep their meaning in the editor's own style", async () => {
    const notepad =
      "Title\n=====\n\n* one\n* two\n\n__Bold__ and _italic_,  \nbroken.\\\nTwice.\n\n***\n";

    const { saved } = await throughTheEditor(notepad);

    expect(saved).toBe("# Title\n\n- one\n- two\n\n**Bold** and *italic*,\nbroken.\nTwice.\n\n---");
    expect((await throughTheEditor(saved)).saved).toBe(saved);
  });

  it("with HTML the editor can't show are reported, not dropped", async () => {
    for (const story of ["Before.\n\n<div>A box</div>\n\nAfter.", "<img src=x><b>two</b>"]) {
      expect((await throughTheEditor(story)).errors).not.toEqual([]);
    }
  });

  it("with an HTML picture keep the picture but nothing that could run", async () => {
    const story =
      'Before.\n\n<img src="media/2026-09-27-4f3a9c.webp" alt="At home" onerror="window.ran = 1">\n\nAfter.';

    const { saved, errors } = await throughTheEditor(story);

    expect(errors).toEqual([]);
    // The path stays as written: MDXEditor's own reader would have made it absolute.
    expect(saved).toBe("Before.\n\n![At home](media/2026-09-27-4f3a9c.webp)\n\nAfter.");
    expect((window as { ran?: number }).ran).toBeUndefined();
  });
});

describe("pictures", () => {
  const person = "0192a0e0-0000-7000-8000-000000000001";

  it("are shown from the person's media folder, or the web", () => {
    expect(pictureUrl(person, "media/2026-09-27-4f3a9c.webp")).toBe(
      `/api/persons/${person}/media/2026-09-27-4f3a9c.webp`,
    );
    expect(pictureUrl(person, "https://example.org/a.jpg")).toBe("https://example.org/a.jpg");
  });

  it("from anywhere else aren't shown", () => {
    for (const src of [
      "javascript:alert(1)",
      "file:///C:/x.png",
      "../person.json",
      "media/x.png",
    ]) {
      expect(pictureUrl(person, src)).toBe("");
    }
  });
});

it("stories with Obsidian's properties, links or footnotes open as plain text", () => {
  for (const story of [
    "---\ntags: family\n---\n\nStory.",
    "He lived with [[Aminah]] in Gemas.",
    "A fact.[^1]\n\n[^1]: From a letter.",
  ]) {
    expect(needsPlainText(story)).toBe(true);
  }
  for (const story of ["Story.\n\n---\n\nMore.", "[Gemas](https://example.org) [1938]"]) {
    expect(needsPlainText(story)).toBe(false);
  }
});

it("really would change what it opens as plain text", async () => {
  // If a later MDXEditor keeps these as written, they can open in the editor again.
  expect((await throughTheEditor("With [[Aminah]] in Gemas.")).saved).toBe(
    "With \\[\\[Aminah]] in Gemas.",
  );
});
