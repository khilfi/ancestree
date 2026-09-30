// @vitest-environment jsdom
/**
 * Saving a copy to edit: the page it saves is the page as it came, with the family and its
 * changes in place of the old; and that page opens with them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSealed, type Sealed } from "@/viewer/snapshot";
import { openEditable, pageTemplate, savedName } from "./open";
import type { PersonFields } from "./rules";
import { payload } from "./seal";
import { editableCopy } from "./testCopy";

const APP = "const family = document.querySelector('script#ancestree-copy');";

/** A copy's page as the backend writes it (exchange/copies.py page), drawn in. */
function copyPage(sealed: Sealed): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.head.innerHTML = `<title>Keluarga Contoh · AncesTree</title><script type="module">${APP}</script>`;
  doc.body.innerHTML = `<div id="root"><p>Drawn by the app</p></div><script type="application/json" id="ancestree-copy">${payload(sealed)}</script>`;
  return doc;
}

function sealedIn(html: string): Sealed {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return JSON.parse(doc.getElementById("ancestree-copy")?.textContent ?? "null") as Sealed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the page a copy to edit saves", () => {
  it("is the page as it came, with the new family in place of the old", () => {
    const doc = copyPage({ format: 1, gzip: "old" });
    const template = pageTemplate(doc);
    const sealed = { format: 1, gzip: "new </script> <!--" };
    const html = template.before + payload(sealed) + template.after;
    const saved = new DOMParser().parseFromString(html, "text/html");

    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(sealedIn(html)).toEqual(sealed);
    expect(saved.getElementById("root")?.children.length).toBe(0); // drawn again when opened
    expect(saved.title).toBe("Keluarga Contoh · AncesTree");
    expect(saved.querySelector("script[type=module]")?.textContent).toBe(APP);
  });

  it("is named for the copy and the day", () => {
    const day = new Date("2026-10-02T10:00:00Z");
    expect(savedName("Keluarga Contoh", day)).toBe("keluarga-contoh-edited-2026-10-02.html");
    expect(savedName("", day)).toBe("ancestree-edited-2026-10-02.html");
  });

  it("opens with the changes saved into it", async () => {
    const snapshot = editableCopy();
    const template = pageTemplate(copyPage({ format: 1, gzip: "as made" }));
    const { book, controls } = await openEditable(snapshot, null, template, () => "en");
    const added = book.createPerson({
      full_name: "Aina binti Osman",
      gender: "female",
    } as PersonFields);
    expect(controls.changes()).toBe(1);

    // No Save dialog here, as in Firefox: the new copy is downloaded.
    let file: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      file = blob as Blob;
      return "blob:saved";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const saved = await controls.save();

    expect(saved).toEqual({ saved: true, name: expect.stringMatching(/^keluarga-contoh-edited-/) });
    expect(controls.changes()).toBe(0);
    const html = await (file as Blob | null)?.text();
    const { snapshot: reopened } = await openSealed(sealedIn(html ?? ""));
    expect(reopened.about.editing?.saved_at).toBeTruthy();
    expect(reopened.family?.people.map((person) => person.full_name)).toContain("Aina binti Osman");
    const again = await openEditable(reopened, null, template, () => "en");
    expect(again.book.detail(added.person.id, "en")?.full_name).toBe("Aina binti Osman");
    expect(again.controls.changes()).toBe(0);
    expect(again.controls.carriedOn()).toBeNull();
  });
});
