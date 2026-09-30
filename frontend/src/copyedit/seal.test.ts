/**
 * Saving a copy to edit packs it as the backend does (exchange/copies.py seal, M20): the page
 * opens what it saved, and a locked copy saves locked, with the same password and a new IV.
 */
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import cases from "@/viewer/sealed-cases.json";
import { openSealed, WrongPasswordError } from "@/viewer/snapshot";
import { payload, Sealer, seal } from "./seal";

const snapshot = {
  about: { title: "Keluarga Contoh", people: 2 },
  family: { people: [{ id: "a", full_name: "Siti binti Rahman" }], links: [] },
  note: "</script> & \u2028 <!-- ok",
};

function base64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

describe("saving a copy to edit", () => {
  it("opens what it saved", async () => {
    const sealed = await seal(snapshot, null);
    expect(sealed.locked).toBeUndefined();
    expect((await openSealed(sealed)).snapshot).toEqual(snapshot);
  });

  it("saves a locked copy locked, with its password, and a new IV each time", async () => {
    const password = "kunci rahsia keluarga";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = pbkdf2(sha256, password, salt, { c: 1000, dkLen: 32 });
    const first = await seal(snapshot, new Sealer(key, base64(salt), 1000));

    // Opened with the password, as the lock screen does, and saved again with its key.
    const opened = await openSealed(first, password);
    expect(opened.snapshot).toEqual(snapshot);
    const changed = { ...snapshot, about: { ...snapshot.about, people: 3 } };
    const again = await seal(changed, opened.sealer);

    expect(again.gzip).toBeUndefined();
    expect(again.locked?.salt).toBe(first.locked?.salt);
    expect(again.locked?.iterations).toBe(1000);
    expect(again.locked?.iv).not.toBe(first.locked?.iv);
    expect((await openSealed(again, password)).snapshot).toEqual(changed);
    await expect(openSealed(again, "kunci")).rejects.toThrow(WrongPasswordError);
    expect(JSON.stringify(again)).not.toContain("Siti");
  });

  it("locks again what the backend locked", async () => {
    const opened = await openSealed(cases.locked, cases.password);
    const again = await seal(opened.snapshot, opened.sealer);

    expect(again.locked?.salt).toBe(cases.locked.locked.salt);
    expect((await openSealed(again, cases.password)).snapshot).toEqual(cases.snapshot);
  });

  it("writes the family so nothing in it can end the script it sits in", async () => {
    const sealed = { format: 1, gzip: "</script><!--\u2028&" };
    const text = payload(sealed);

    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual(sealed);
  });
});
