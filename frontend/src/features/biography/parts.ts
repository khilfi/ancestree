/*
 * The parts of a life story beyond the story itself, in
 * their order: each kept in biography.md under its own heading, as Markdown. A list part is a
 * list, one item a line; a saying is one item, with when or to whom after a dash.
 */
import type { Biography } from "@/api/types";

export type PartKey =
  | "accomplishments"
  | "early"
  | "middle"
  | "later"
  | "character"
  | "sayings"
  | "message"
  | "values"
  | "hobbies"
  | "talents"
  | "notes";
export type PartKind = "text" | "list" | "sayings";

export type PartInfo = {
  key: PartKey;
  title: string; // as the file's heading, and the window's
  kind: PartKind;
  hint: string; // what goes in it, for the one writing
};

export const PARTS: PartInfo[] = [
  {
    key: "accomplishments",
    title: "Notable accomplishments",
    kind: "list",
    hint: "What they did that the family remembers: one a line.",
  },
  {
    key: "early",
    title: "Early life",
    kind: "text",
    hint: "Childhood, school, where they grew up. A picture, if there is one.",
  },
  {
    key: "middle",
    title: "Middle life",
    kind: "text",
    hint: "Work, marriage, the family they raised.",
  },
  {
    key: "later",
    title: "Later life",
    kind: "text",
    hint: "Their later years, and how they spent them.",
  },
  {
    key: "character",
    title: "Character and mannerisms",
    kind: "text",
    hint: "What they were like: their ways, their habits, how they laughed.",
  },
  {
    key: "sayings",
    title: "Sayings and quotes",
    kind: "sayings",
    hint: "Things they used to say, one a line, with when or to whom if known.",
  },
  {
    key: "message",
    title: "A message to the next generations",
    kind: "text",
    hint: "What they'd want their grandchildren to know.",
  },
  {
    key: "values",
    title: "Life values kept for life",
    kind: "list",
    hint: "What they held to, all their life: one a line.",
  },
  { key: "hobbies", title: "Hobbies", kind: "list", hint: "What they loved doing: one a line." },
  {
    key: "talents",
    title: "Hidden talents",
    kind: "list",
    hint: "The surprising and the delightfully useless: whistling, folding, mimicry.",
  },
  {
    key: "notes",
    title: "Free notes",
    kind: "text",
    hint: "Anything else worth keeping.",
  },
];

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;
const DASH = " — ";

/** A list part's items, one a line; a line that isn't an item is kept as one too. */
export function listItems(markdown: string | undefined): string[] {
  return (markdown ?? "")
    .split("\n")
    .map((line) => ITEM.exec(line)?.[1] ?? line.trim())
    .filter(Boolean);
}

/** A list part as the file keeps it: "- " before each item, empty ones left out. */
export function listMarkdown(items: string[]): string {
  return items
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

export type Saying = { text: string; note: string };

/** Sayings, each with when or to whom, if known: "Sabar itu… — to his children, often". */
export function sayingsOf(markdown: string | undefined): Saying[] {
  return listItems(markdown).map((item) => {
    const at = item.lastIndexOf(DASH);
    return at > 0
      ? { text: item.slice(0, at).trim(), note: item.slice(at + DASH.length).trim() }
      : { text: item, note: "" };
  });
}

export function sayingsMarkdown(sayings: Saying[]): string {
  return listMarkdown(
    sayings
      .filter((saying) => saying.text.trim())
      .map((saying) =>
        saying.note.trim() ? `${saying.text.trim()}${DASH}${saying.note.trim()}` : saying.text,
      ),
  );
}

/** The parts filled in, in their order: those the reading page shows. */
export function filled(parts: Biography["parts"]): PartInfo[] {
  return PARTS.filter((part) => (parts?.[part.key] ?? "").trim());
}

/** Whether there's anything of a life story yet: the story, a part, what people say, or
 *  a source. */
export function hasStory(
  story: Pick<Biography, "story" | "parts" | "sources"> & Partial<Pick<Biography, "said">>,
): boolean {
  return (
    Boolean(story.story.trim()) ||
    filled(story.parts).length > 0 ||
    (story.said?.length ?? 0) > 0 ||
    story.sources.some((source) => source.trim())
  );
}
