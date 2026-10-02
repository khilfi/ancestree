import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  Biography,
  FamilyFacts,
  FamilyMap,
  Graph,
  GraphLayout,
  Health,
  KindView,
  KinshipDictionary,
  KinshipLanguage,
  KinshipSettings,
  PersonDetail,
  PersonSummary,
  TreeSettings,
} from "@/api/types";
import type { CopyAbout } from "@/app/copy";
import type { TwinInputs } from "@/kinship/twin";

/** A file the copy carries, such as its GEDCOM export: base64. */
export type CopyFile = { name: string; size: number; data: string };

/**
 * Everything a copy shows (backend/src/ancestree/exchange/copies.py): the answers the
 * app gave when it was made.
 */
export type CopySnapshot = {
  format: number;
  about: CopyAbout;
  health: Health;
  graph: Graph;
  // The seats around each other centre a viewer can choose: by that person's id, and
  // "" for the oldest ancestor when the copy was made with another centre.
  layouts: Record<string, GraphLayout>;
  map: FamilyMap; // where everyone lives and was born, found when the copy was made
  tree_settings: TreeSettings;
  kinds: KindView[];
  dictionary: KinshipDictionary;
  kinship_settings: KinshipSettings;
  kinship: TwinInputs; // for the copy's own relationship finder
  facts: FamilyFacts;
  persons: Record<string, Partial<Record<KinshipLanguage, PersonDetail>>>;
  stories: Record<string, Biography>;
  search: PersonSummary[];
  files: Record<string, string>; // data: addresses, by the address the app asks for
  // The files made with it.
  exports: {
    gedcom: CopyFile | null;
    csv: CopyFile | null;
    template: CopyFile;
    archive: CopyFile | null;
  };
};

type Lock = { salt: string; iv: string; iterations: number; data: string };

/** The family as the page holds it: compressed, and locked when there's a password. */
export type Sealed = { format: number; gzip?: string; locked?: Lock };

export class WrongPasswordError extends Error {}

/** The family in the page (`<script id="ancestree-copy">`), or null when it's missing. */
export function readSealed(): Sealed | null {
  const text = document.getElementById("ancestree-copy")?.textContent;
  return text ? (JSON.parse(text) as Sealed) : null;
}

export function bytes(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index);
  return out;
}

async function gunzip(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const packed = new Response(data).body as ReadableStream<Uint8Array<ArrayBuffer>>;
  return new Response(packed.pipeThrough(new DecompressionStream("gzip"))).text();
}

/** The same as below, in plain JavaScript: some browsers keep WebCrypto from a page opened from a
 *  file, such as Chrome on Android for a copy from a chat app. A few seconds slower. */
async function unlockByHand(lock: Lock, password: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await pbkdf2Async(sha256, new TextEncoder().encode(password), bytes(lock.salt), {
    c: lock.iterations,
    dkLen: 32,
  });
  try {
    return new Uint8Array(gcm(key, bytes(lock.iv)).decrypt(bytes(lock.data)));
  } catch {
    throw new WrongPasswordError("That isn't the password.");
  }
}

async function unlock(lock: Lock, password: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!globalThis.crypto?.subtle) return unlockByHand(lock, password);
  const secret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(lock.salt), iterations: lock.iterations, hash: "SHA-256" },
    secret,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(lock.iv) },
      key,
      bytes(lock.data),
    );
    return new Uint8Array(plain);
  } catch {
    throw new WrongPasswordError("That isn't the password.");
  }
}

/** The family, unlocked with the password when it's locked. */
export async function openCopy(sealed: Sealed, password?: string): Promise<CopySnapshot> {
  let data: Uint8Array<ArrayBuffer>;
  if (sealed.locked) {
    if (password === undefined) throw new WrongPasswordError("This copy is locked.");
    data = await unlock(sealed.locked, password);
  } else if (sealed.gzip) {
    data = bytes(sealed.gzip);
  } else {
    throw new Error("This copy is damaged: the family isn't in it.");
  }
  return JSON.parse(await gunzip(data)) as CopySnapshot;
}
