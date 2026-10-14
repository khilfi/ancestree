/**
 * The life story's parts: their order, and their lists and sayings read from and
 * written back to Markdown as the backend keeps them. The words are made up.
 */
import { describe, expect, it } from "vitest";
import {
  filled,
  hasStory,
  listItems,
  listMarkdown,
  PARTS,
  sayingsMarkdown,
  sayingsOf,
} from "./parts";

describe("a life story's parts", () => {
  it("are eleven, in the plan's order, with the file's headings", () => {
    expect(PARTS.map((part) => part.title)).toEqual([
      "Notable accomplishments",
      "Early life",
      "Middle life",
      "Later life",
      "Character and mannerisms",
      "Sayings and quotes",
      "A message to the next generations",
      "Life values kept for life",
      "Hobbies",
      "Hidden talents",
      "Free notes",
    ]);
  });

  it("reads a list as written in Notepad or Obsidian, and writes it back plainly", () => {
    const written = "- Built the surau\n* Forty years   with the railway\n1. Hajj, 1985\n\nA line";
    const items = listItems(written);
    expect(items).toEqual([
      "Built the surau",
      "Forty years   with the railway",
      "Hajj, 1985",
      "A line",
    ]);
    expect(listMarkdown([...items, "  "])).toBe(
      "- Built the surau\n- Forty years with the railway\n- Hajj, 1985\n- A line",
    );
  });

  it("keeps when or to whom with each saying", () => {
    const sayings = sayingsOf(
      "- Sabar itu separuh daripada iman — to his children, often\n- Jangan lupa asal usul",
    );
    expect(sayings).toEqual([
      { text: "Sabar itu separuh daripada iman", note: "to his children, often" },
      { text: "Jangan lupa asal usul", note: "" },
    ]);
    expect(sayingsMarkdown([...sayings, { text: "", note: "nobody" }])).toBe(
      "- Sabar itu separuh daripada iman — to his children, often\n- Jangan lupa asal usul",
    );
  });

  it("says which parts are filled in, and whether there's a story at all", () => {
    const parts = { talents: "- Whistling", early: "  ", message: "Look after one another." };
    expect(filled(parts).map((part) => part.key)).toEqual(["message", "talents"]);
    expect(hasStory({ story: "", parts: {}, sources: [] })).toBe(false);
    expect(hasStory({ story: "", parts, sources: [] })).toBe(true);
    expect(hasStory({ story: "", parts: {}, sources: ["Birth certificate"] })).toBe(true);
  });
});
