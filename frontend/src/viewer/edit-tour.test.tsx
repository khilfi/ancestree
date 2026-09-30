// @vitest-environment jsdom
/**
 * A copy to edit, looked around: its bar, and the ways to change things it allows,
 * and only those. What each change does is proven in src/copyedit/edit-cases.test.ts.
 */
import { act } from "react";
import { createRoot, type Root as Rendered } from "react-dom/client";
import { createMemoryRouter } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppLayout } from "@/app/AppLayout";
import type { CopyPermissions } from "@/app/copy";
import { Root } from "@/app/Root";
import { openEditable, pageTemplate } from "@/copyedit/open";
import { EVERYTHING, editableCopy, SEED_IDS } from "@/copyedit/testCopy";
import { PersonPanel } from "@/features/person/PersonPanel";
import { answer, installCopy } from "./answers";
import { controls, named, until } from "./looking";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// As in a browser, "/api/…" is read against the page. (Before the app's API client is made.)
vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {}; // jsdom's signals aren't Node's
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

const HASSAN = SEED_IDS.get("Hassan bin Ismail") ?? "";
const NOTHING: CopyPermissions = {
  add: false,
  change: false,
  remove: false,
  stories: false,
  photos: false,
};
const nothing = () => {};

/** A copy to edit allowing `may`, opened on Hassan's panel. */
function opened(may: CopyPermissions) {
  let root: Rendered;
  beforeAll(async () => {
    const snapshot = editableCopy(may);
    const { book, controls: bar } = await openEditable(snapshot, null, pageTemplate(), () => "en");
    installCopy(snapshot, book);
    const router = createMemoryRouter([
      {
        path: "/",
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: (
              <PersonPanel
                personId={HASSAN}
                onSelect={nothing}
                onClose={nothing}
                onDelete={nothing}
                onFindRelationship={nothing}
              />
            ),
          },
        ],
      },
    ]);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Root router={router} copy={snapshot.about} controls={bar} />));
    await until("Hassan bin Ismail");
  });
  afterAll(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });
}

describe("a copy to edit that allows everything", () => {
  opened(EVERYTHING);

  it("says whom it's for, and offers what it allows", () => {
    expect(document.body.textContent).toContain("Copy to edit · for Mak Long · No changes yet");
    expect(document.body.textContent).toContain("Keluarga Contoh · to edit");
    const shown = controls();
    for (const control of [
      "Add person",
      "Edit",
      "Move to Trash",
      "Centre the tree here",
      "Add a photo",
      "Trash",
      "Save a new copy",
    ]) {
      expect(shown, control).toContain(control);
    }
    // The app's own: its settings, and making copies.
    expect(shown).not.toContain("Settings");
  });

  it("exports itself with its changes, and nothing out of date", async () => {
    act(() => named("Export").click());
    await until("Picture of the tree");
    const text = document.body.textContent ?? "";
    expect(text).toContain("This copy with your changes inside");
    for (const left of [
      "GEDCOM",
      "Full archive",
      "Spreadsheet",
      "Import template",
      "Make a copy",
    ]) {
      expect(text, left).not.toContain(left);
    }
    act(() => named("Close").click());
  });

  it("counts its changes as they're made", async () => {
    await act(async () => {
      await answer(
        new Request("http://copy/api/persons", {
          method: "POST",
          body: JSON.stringify({ full_name: "Aina binti Osman", gender: "female" }),
          headers: { "content-type": "application/json" },
        }),
      );
    });
    await until("1 change not saved yet");
  });
});

describe("a copy to edit that allows nothing", () => {
  opened(NOTHING);

  it("offers no way to change anything, only to save it", () => {
    const shown = controls();
    for (const control of [
      "Add person",
      "Edit",
      "Move to Trash",
      "Change the photo",
      "Add a photo",
      "Trash",
    ]) {
      expect(shown, control).not.toContain(control);
    }
    expect(shown).toContain("Save a new copy");
  });

  it("refuses a change asked for anyway", async () => {
    const refused = await answer(
      new Request("http://copy/api/persons", {
        method: "POST",
        body: JSON.stringify({ full_name: "Aina binti Osman", gender: "female" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).detail.code).toBe("not_allowed");
  });
});
