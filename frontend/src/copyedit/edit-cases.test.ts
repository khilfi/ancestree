/**
 * A copy to edit answers each change as the app does: the cases written down once, in
 * edit-cases.json, which the app answers in backend/tests/integration/test_edit_cases.py. Each
 * runs on the fictional family, fresh, through the copy's own answers (src/viewer/answers.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { answer, installCopy } from "@/viewer/answers";
import type { CopySnapshot } from "@/viewer/snapshot";
import { Book } from "./book";
import type { CopyFamily } from "./family";
import { editableCopy, SEED_IDS } from "./testCopy";

const stored = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  },
});

type Step = {
  call: string;
  body?: unknown;
  status: number;
  code?: string;
  notices?: string[];
  expect?: Record<string, unknown>;
  keep?: Record<string, string>;
};
type Case = { name: string; steps: Step[] };

const { cases } = JSON.parse(
  readFileSync(resolve("src", "copyedit", "edit-cases.json"), "utf8"),
) as { cases: Case[] };
const ids = SEED_IDS;

function copyOfTheFamily(): { snapshot: CopySnapshot; book: Book } {
  const snapshot = editableCopy();
  const book = new Book(
    { family: snapshot.family as CopyFamily, stories: {}, files: {}, photos: {}, trash: [] },
    { kinds: snapshot.kinds, kinship: snapshot.kinship, map: snapshot.map, places: {}, hidden: [] },
    () => "en",
  );
  return { snapshot, book };
}

function fill(value: unknown, kept: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => fill(item, kept));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, kept)]));
  }
  if (typeof value !== "string") return value;
  if (value.startsWith("@")) return ids.get(value.slice(1));
  if (/^\$[a-z]+$/.test(value)) return kept.get(value.slice(1));
  return value;
}

function fillPath(path: string, kept: Map<string, string>): string {
  return path
    .replace(/@([^/?"]+?)(?=$|\/|\?)/g, (_, name: string) => ids.get(name) ?? name)
    .replace(/\$([a-z]+)/g, (_, name: string) => kept.get(name) ?? name);
}

/** A field by its path in the answer: "person.parents.0.full_name", "links.length". */
function pick(found: unknown, path: string): unknown {
  let here = found;
  for (const part of path.split(".")) {
    if (part === "length") here = (here as unknown[]).length;
    else here = (here as Record<string, unknown>)[part];
  }
  return here;
}

describe.each(cases)("$name", ({ steps }) => {
  it("is answered as the app answers it", async () => {
    const { snapshot, book } = copyOfTheFamily();
    installCopy(snapshot, book);
    const kept = new Map<string, string>();
    for (const [index, step] of steps.entries()) {
      const space = step.call.indexOf(" ");
      const [method, path] = [step.call.slice(0, space), step.call.slice(space + 1)];
      const where = `step ${index + 1}, ${step.call}`;
      const init: RequestInit = { method };
      if (step.body !== undefined) {
        init.body = JSON.stringify(fill(step.body, kept));
        init.headers = { "content-type": "application/json" };
      }
      const response = await answer(new Request(`http://copy${fillPath(path, kept)}`, init));
      const text = await response.text();
      expect(response.status, `${where}: ${text}`).toBe(step.status);
      const found = text ? JSON.parse(text) : null;
      if (step.code) expect(found.detail.code, where).toBe(step.code);
      if (step.notices) {
        expect(
          found.notices.map((notice: { code: string }) => notice.code),
          where,
        ).toEqual(step.notices);
      }
      for (const [name, field] of Object.entries(step.keep ?? {})) {
        kept.set(name, String(pick(found, field)));
      }
      for (const [field, value] of Object.entries(step.expect ?? {})) {
        expect(pick(found, field), `${where}: ${field}`).toEqual(fill(value, kept));
      }
    }
  });
});
