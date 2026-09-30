/**
 * Packing a copy's family into its page, and locking it: the
 * browser's twin of exchange/copies.py seal. The family is compressed, then, in a locked copy,
 * encrypted with AES-GCM under a key made from the password (PBKDF2-SHA-256). A copy saved
 * again keeps its password: the key the password opened is kept for the visit, never the
 * password itself, and every sealing takes a new random IV.
 */
import { gcm } from "@noble/ciphers/aes.js";
import type { Sealed } from "@/viewer/snapshot";

export const FORMAT = 1;

function base64(data: Uint8Array): string {
  let text = "";
  for (let index = 0; index < data.length; index += 0x8000) {
    text += String.fromCharCode(...data.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

function bytes(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) out[index] = raw.charCodeAt(index);
  return out;
}

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const plain = new Response(text).body as ReadableStream<Uint8Array<ArrayBuffer>>;
  const stream = plain.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A locked copy's key, as its password opened it: to lock what it saves and keeps. */
export class Sealer {
  constructor(
    private readonly key: CryptoKey | Uint8Array,
    readonly salt: string,
    readonly iterations: number,
  ) {}

  private async encrypt(data: Uint8Array<ArrayBuffer>): Promise<{ iv: string; data: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    if (this.key instanceof Uint8Array) {
      return { iv: base64(iv), data: base64(gcm(this.key, iv).encrypt(data)) };
    }
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, data);
    return { iv: base64(iv), data: base64(new Uint8Array(sealed)) };
  }

  private async decrypt(locked: { iv: string; data: string }): Promise<Uint8Array> {
    if (this.key instanceof Uint8Array)
      return gcm(this.key, bytes(locked.iv)).decrypt(bytes(locked.data));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(locked.iv) },
      this.key,
      bytes(locked.data),
    );
    return new Uint8Array(plain);
  }

  sealText(text: string): Promise<{ iv: string; data: string }> {
    return this.encrypt(new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>);
  }

  async openText(locked: { iv: string; data: string }): Promise<string> {
    return new TextDecoder().decode(await this.decrypt(locked));
  }

  async lock(compressed: Uint8Array<ArrayBuffer>): Promise<Sealed> {
    const { iv, data } = await this.encrypt(compressed);
    return { format: FORMAT, locked: { salt: this.salt, iv, iterations: this.iterations, data } };
  }
}

/** A snapshot packed for its page: compressed, and locked when the copy is. */
export async function seal(snapshot: unknown, sealer: Sealer | null): Promise<Sealed> {
  const compressed = await gzip(JSON.stringify(snapshot));
  return sealer ? sealer.lock(compressed) : { format: FORMAT, gzip: base64(compressed) };
}

/** What could end the script the family sits in, or a line in older JavaScript. */
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");
const BACKSLASH = String.fromCharCode(92);

/** The sealed family as its page carries it: JSON with <, >, &, U+2028 and U+2029 written as
 *  \u escapes, so nothing in it can end the script it sits in (exchange/copies.py page). */
export function payload(sealed: Sealed): string {
  return JSON.stringify(sealed).replace(
    UNSAFE,
    (char) => `${BACKSLASH}u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
