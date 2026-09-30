/**
 * A life story's text as the app writes and reads it (services/biography.py): the story,
 * then its Sources as a list under a last "Sources" heading; and its version, which changes
 * whenever the text does. A copy to edit writes a story exactly as the app would, so a
 * story reads back the same in both, with the same version.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Biography } from "@/api/types";

export const SOURCES_HEADING = "## Sources";
const SOURCES = /^#{1,6}\s+sources\s*$/i;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/;

export const NO_STORY: Biography = { story: "", sources: [], version: "none" };

/** Changes whenever the text does; "none" while there's no story. SHA-256 by hand, as some
 *  browsers keep WebCrypto from a page opened from a file. */
export function versionOf(text: string | null): string {
  if (text === null) return "none";
  return bytesToHex(sha256(new TextEncoder().encode(text))).slice(0, 16);
}

/** The story, and the list under a last "Sources" heading if nothing but a list follows it.
 *  Anything else stays part of the story, so nothing written is lost. */
export function splitSources(markdown: string): { story: string; sources: string[] } {
  const lines = markdown.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!SOURCES.test((lines[index] ?? "").trim())) continue;
    const sources: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (!line.trim()) continue;
      const item = ITEM.exec(line);
      if (!item) return { story: markdown.trim(), sources: [] };
      sources.push(item[1] ?? "");
    }
    return { story: lines.slice(0, index).join("\n").trim(), sources };
  }
  return { story: markdown.trim(), sources: [] };
}

/** The text: the story, then the Sources as a list, each on one line. "" for nothing at all. */
export function joinSources(story: string, sources: readonly string[]): string {
  const parts = story.trim() ? [story.trim()] : [];
  const items = sources
    .filter((source) => source.trim())
    .map((source) => source.trim().split(/\s+/).join(" "));
  if (items.length)
    parts.push(`${SOURCES_HEADING}\n\n${items.map((item) => `- ${item}`).join("\n")}`);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/** A story as the Biography tab reads it, from its text; none for no text. */
export function biographyFrom(text: string | null): Biography {
  if (!text) return NO_STORY;
  return { ...splitSources(text), version: versionOf(text) };
}
