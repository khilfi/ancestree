/**
 * Changes kept in the browser as they're made, so closing the tab
 * loses nothing on that computer: one record per copy to edit, by its id, in IndexedDB. A locked
 * copy's changes are kept locked, with its own key: nothing it holds lies open in the browser.
 *
 * Opening the copy again carries on from what was kept, when that's newer than the file.
 */
import type { BookContents } from "./book";
import type { Sealer } from "./seal";

const DATABASE = "ancestree-copies";
const STORE = "kept";

/** What's kept for a copy: its family as it was last changed, and when. */
export type Kept = { kept_at: string; contents: BookContents };

type Stored = {
  id: string;
  kept_at: string;
  plain?: string;
  locked?: { iv: string; data: string };
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await open();
  try {
    return await done(work(database.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    database.close();
  }
}

/** What's kept for this copy, if anything; null too when the browser keeps nothing. */
export async function readKept(id: string, sealer: Sealer | null): Promise<Kept | null> {
  try {
    const stored = (await withStore("readonly", (store) => store.get(id))) as Stored | undefined;
    if (!stored) return null;
    let text: string | null = stored.plain ?? null;
    if (stored.locked) {
      if (!sealer) return null; // kept locked, and this copy isn't: not this copy's to open
      text = await sealer.openText(stored.locked);
    }
    return text ? { kept_at: stored.kept_at, contents: JSON.parse(text) as BookContents } : null;
  } catch {
    return null;
  }
}

export async function forget(id: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch {
    // nothing kept, or nowhere to keep it
  }
}

/** Keeps a copy's changes a moment after each one, and says whether the browser could. */
export class Keeper {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latest: (() => BookContents) | null = null;
  working = true;

  constructor(
    private readonly id: string,
    private readonly sealer: Sealer | null,
    private readonly onProblem: () => void = () => {},
  ) {}

  soon(contents: () => BookContents): void {
    this.latest = contents;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.now(), 400);
  }

  async now(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const contents = this.latest?.();
    if (!contents) return;
    const text = JSON.stringify(contents);
    const stored: Stored = { id: this.id, kept_at: new Date().toISOString() };
    try {
      if (this.sealer) stored.locked = await this.sealer.sealText(text);
      else stored.plain = text;
      await withStore("readwrite", (store) => store.put(stored));
      this.working = true;
    } catch {
      this.working = false;
      this.onProblem();
    }
  }
}
