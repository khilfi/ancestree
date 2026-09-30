// @vitest-environment jsdom
/**
 * Settings → Import → Changes from a copy, with the app's answers made up here: a
 * locked copy asks for its password, says when it's wrong, then shows each change to tick; what
 * takes something out waits for its own tick, and only what's ticked is brought in.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CopyPreview, ImportChange } from "@/api/types";
import { until } from "@/viewer/looking";
import { CopyImport } from "./CopyImport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASSWORD = "kunci rahsia keluarga";

const change = (id: string, more: Partial<ImportChange>): ImportChange => ({
  id,
  kind: "set",
  row: null,
  name: "Ali bin Rosli",
  clash: false,
  unsure: false,
  removes: false,
  ticked: true,
  ...more,
});

const PREVIEW: CopyPreview = {
  file_name: "keluarga-contoh-edited-2026-10-02.html",
  about: {
    copy_id: "0199aaaa-0000-7000-8000-000000000001",
    for_name: "Mak Long",
    title: "Keluarga Contoh",
    made_at: "2026-09-29T08:00:00+08:00",
    saved_at: "2026-10-02T09:00:00+08:00",
    brought_at: null,
    locked: true,
  },
  questions: [],
  changes: [
    change("set:ali:occupation", {
      column: "Occupation",
      before: "Akauntan",
      after: "Jurutera",
      clash: true,
      ticked: false,
    }), // prettier-ignore
    change("story:hassan", {
      kind: "story",
      name: "Hassan bin Ismail",
      column: "Life story",
      detail: "changed",
      before: "He worked on the railway.",
      after: "He worked on the railway for thirty years.",
    }),
    change("photo:aminah", {
      kind: "photo",
      name: "Aminah binti Hassan",
      column: "Photo",
      detail: "added",
      picture: "data:image/webp;base64,UklGRg==",
    }),
    change("unlink:1", {
      kind: "remove_link",
      name: "Ali bin Rosli",
      detail: "no longer married to Nadia binti Hashim",
      removes: true,
      ticked: false,
    }),
  ],
  left_out: [
    {
      row: null,
      column: "Hassan bin Ismail",
      written: "",
      why: "This copy didn't let Mak Long remove people or links, so it's left out.",
    },
  ],
  second_look: [],
};

const asked: { url: string; form: Record<string, string> }[] = [];

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  const form = Object.fromEntries(
    [...(init.body as FormData).entries()].filter(([, value]) => typeof value === "string"),
  ) as Record<string, string>;
  asked.push({ url, form });
  if (url.endsWith("/copy/preview")) {
    if (!form.password) return reply(422, { detail: { code: "locked", message: "Locked." } });
    if (form.password !== PASSWORD)
      return reply(422, { detail: { code: "wrong_password", message: "Wrong." } });
    return reply(200, PREVIEW);
  }
  return reply(201, {
    id: "2026-10-02T09-30-00",
    label: "Changes from Mak Long's copy",
    people: 0,
    links: 0,
    changed: 0,
    removed: 0,
    stories: 1,
    photos: 1,
    left_out: 1,
    backup: "ancestree-backup.zip",
  });
});

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No "${name}" button`);
  return found;
}

function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("changes from a copy", () => {
  let root: Root;

  beforeAll(async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <CopyImport />
        </QueryClientProvider>,
      ),
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["<html></html>"], "keluarga-contoh-edited-2026-10-02.html");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until("This copy is locked");
  });

  afterAll(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("asks for a locked copy's password, and says when it's wrong", async () => {
    const field = document.querySelector<HTMLInputElement>("#copy-password") as HTMLInputElement;
    type(field, "kunci");
    act(() => button("Open").click());
    await until("That isn't the password of this copy.");

    type(field, PASSWORD);
    act(() => button("Open").click());
    await until("What they changed");
    expect(asked.map((ask) => ask.form.password ?? "")).toEqual(["", "kunci", PASSWORD]);
  });

  it("shows each change to tick, from the copy made for them", () => {
    const text = document.body.textContent ?? "";
    expect(text).toContain("made for Mak Long");
    expect(text).toContain("4 changes to review, 2 ticked.");
    for (const group of ["Details changed", "Life stories", "Photos", "To remove", "Left out"]) {
      expect(text, group).toContain(group);
    }
    expect(text).toContain("Changed in the app too since the copy was made.");
    expect(document.querySelector('img[src^="data:image/webp"]')).not.toBeNull();
  });

  it("brings in only what's ticked", async () => {
    act(() => button("Tick all").click());
    await until("2 ticked"); // the clash and the link taken out keep their own ticks
    act(() => button("Bring in 2 changes").click());
    await until("Changes from a copy"); // back to choosing a file
    const sent = asked.at(-1);
    expect(sent?.url).toBe("/api/imports/copy");
    expect(sent?.form.password).toBe(PASSWORD);
    expect(JSON.parse(sent?.form.chosen ?? "[]")).toEqual(["story:hassan", "photo:aminah"]);
  });
});
