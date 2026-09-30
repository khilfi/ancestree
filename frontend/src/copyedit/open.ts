/**
 * Opening a copy to edit, and saving it: the family becomes a book
 * (book.ts) that answers the app and keeps its changes in the browser as they're made; "Save a
 * new copy" writes the page again with the changes inside, locked again if it was locked.
 *
 * Spike S4 found that a page opened from the disk can do all of this: download a new
 * copy of itself in Chrome, Edge and Firefox, and save over a chosen file with Chrome's and
 * Edge's Save dialog.
 */
import type { CopyControls, CopyEditing, Saved } from "@/app/copy";
import type { CopySnapshot } from "@/viewer/snapshot";
import { Book, type BookContents } from "./book";
import { forget, Keeper, readKept } from "./keep";
import { payload, type Sealer, seal } from "./seal";

/** The page, cut where the family goes: a saved copy is `before`, the family, then `after`. */
export type PageTemplate = { before: string; after: string };

/**
 * The page as it came, with a place for the family: taken before anything is drawn, so a saved
 * copy is the same page with new data in it, and the app inside it exactly as it was. The mark
 * for the place is made anew each time, so it can't be anywhere else in the page, such as in
 * the app's own code, which comes first.
 */
export function pageTemplate(doc: Document = document): PageTemplate {
  const mark = `ancestree-family-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
  const page = doc.documentElement.cloneNode(true) as HTMLElement;
  const data = page.querySelector("script#ancestree-copy");
  if (data) data.textContent = mark;
  page.querySelector("#root")?.replaceChildren();
  const [before = "", after = ""] = `<!DOCTYPE html>\n${page.outerHTML}`.split(mark);
  return { before, after };
}

/** "keluarga-contoh-edited-2026-10-02.html" */
export function savedName(title: string, when: Date = new Date()): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const day = when.toISOString().slice(0, 10);
  return `${slug || "ancestree"}-edited-${day}.html`;
}

function contentsOf(snapshot: CopySnapshot): BookContents {
  return {
    family: snapshot.family ?? { people: [], links: [] },
    stories: snapshot.stories,
    files: snapshot.files,
    photos: snapshot.photos ?? {},
    trash: snapshot.trash ?? [],
  };
}

type SaveTarget = { write: (html: string) => Promise<void> } | null;

type FilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

/** Where a saved copy goes. In Chrome and Edge, a file chosen in the Save dialog, which can be
 *  the copy itself; anywhere else, a download. Null: the dialog was closed. Asked first, while
 *  the click that asked still counts. */
async function chooseTarget(name: string): Promise<SaveTarget> {
  const picker = (window as unknown as { showSaveFilePicker?: FilePicker }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: "AncesTree copy", accept: { "text/html": [".html"] } }],
      });
      return {
        write: async (html) => {
          const writable = await handle.createWritable();
          await writable.write(new Blob([html], { type: "text/html" }));
          await writable.close();
        },
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      // Not allowed here after all: download it instead.
    }
  }
  return {
    write: async (html) => {
      const address = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const link = document.createElement("a");
      link.href = address;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(address), 60_000);
    },
  };
}

/** A copy to edit, open: its book, and the controls its bar uses. */
export type OpenCopy = { book: Book; controls: CopyControls };

export async function openEditable(
  snapshot: CopySnapshot,
  sealer: Sealer | null,
  template: PageTemplate,
  language: () => "en" | "ms" | "jv",
): Promise<OpenCopy> {
  const editing = snapshot.about.editing as CopyEditing;
  const inFile = contentsOf(snapshot);
  const kept = await readKept(editing.id, sealer);
  const since = Date.parse(editing.saved_at ?? editing.made_at);
  // Kept since the file was made or saved, and not just what it holds: carry on from there.
  let carried =
    kept && Date.parse(kept.kept_at) > since && !Book.same(kept.contents, inFile) ? kept : null;
  const book = new Book(
    carried?.contents ?? inFile,
    {
      kinds: snapshot.kinds,
      kinship: snapshot.kinship,
      map: snapshot.map,
      places: snapshot.places,
      hidden: editing.hidden,
    },
    language,
    inFile,
  );
  let problem = false;
  const listeners = new Set<() => void>();
  const keeper = new Keeper(editing.id, sealer, () => {
    problem = true;
    for (const listener of listeners) listener();
  });
  book.listen(() => keeper.soon(() => book.contents()));
  // Where the browser keeps nothing, say so before unsaved changes are lost.
  window.addEventListener("beforeunload", (event) => {
    if (!keeper.working && book.changes() > 0) event.preventDefault();
  });

  const save = async (): Promise<Saved> => {
    const now = new Date();
    const name = savedName(snapshot.about.title, now);
    const target = await chooseTarget(name);
    if (!target) return { saved: false };
    const contents = book.contents();
    const {
      graph: _graph,
      layouts: _layouts,
      persons: _persons,
      search: _search,
      ...kept
    } = snapshot;
    const next: CopySnapshot = {
      ...kept,
      about: { ...snapshot.about, editing: { ...editing, saved_at: now.toISOString() } },
      family: contents.family,
      stories: contents.stories,
      files: contents.files,
      photos: contents.photos,
      trash: contents.trash,
    };
    const html = template.before + payload(await seal(next, sealer)) + template.after;
    await target.write(html);
    carried = null; // in the file now
    book.saved(contents);
    await keeper.now();
    return { saved: true, name };
  };

  const controls: CopyControls = {
    subscribe: (listener) => {
      const stop = book.listen(listener);
      listeners.add(listener);
      return () => {
        stop();
        listeners.delete(listener);
      };
    },
    changes: () => book.changes(),
    keeping: () => keeper.working && !problem,
    carriedOn: () => carried?.kept_at ?? null,
    save,
    startAgain: async () => {
      await forget(editing.id);
      window.location.reload();
    },
  };
  return { book, controls };
}
