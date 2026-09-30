import { afterEach, describe, expect, it, vi } from "vitest";
import cases from "./sealed-cases.json";
import { openCopy, WrongPasswordError } from "./snapshot";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Sealed by the backend (exchange/copies.py), whose tests unseal the same cases.
describe("opening a copy's family", () => {
  it("opens what the backend sealed", async () => {
    expect(await openCopy(cases.open)).toEqual(cases.snapshot);
  });

  it("opens a locked copy with its password", async () => {
    expect(await openCopy(cases.locked, cases.password)).toEqual(cases.snapshot);
  });

  it("says so when the password is wrong or missing", async () => {
    await expect(openCopy(cases.locked, "kunci")).rejects.toThrow(WrongPasswordError);
    await expect(openCopy(cases.locked)).rejects.toThrow(WrongPasswordError);
  });

  it("says a copy without its family is damaged", async () => {
    await expect(openCopy({ format: 1 })).rejects.toThrow("damaged");
  });

  it("opens a locked copy where the browser keeps WebCrypto from the page", async () => {
    vi.stubGlobal("crypto", {}); // as Chrome on Android may, for a file from a chat app

    expect(await openCopy(cases.locked, cases.password)).toEqual(cases.snapshot);
    await expect(openCopy(cases.locked, "kunci")).rejects.toThrow(WrongPasswordError);
  });
});
