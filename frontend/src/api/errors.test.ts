// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { ApiError, canTryAgain, inWords, NOT_ANSWERING, reach, toApiError, unwrap } from "./errors";

vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {};
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("toApiError", () => {
  it("keeps the rule's code and message from a 409", () => {
    const error = toApiError(409, {
      detail: { code: "third_parent", message: "Ali already has two biological parents." },
    });

    expect(error.status).toBe(409);
    expect(error.code).toBe("third_parent");
    expect(error.message).toBe("Ali already has two biological parents.");
  });

  it("maps a 422 onto the form's fields", () => {
    const error = toApiError(422, {
      detail: [
        {
          loc: ["body", "birth_date"],
          msg: "Value error, There's no month 13.",
          type: "value_error",
        },
        { loc: ["body", "person", "full_name"], msg: "Field required", type: "missing" },
      ],
    });

    expect(error.message).toBe("There's no month 13.");
    expect(error.fieldErrors).toEqual({
      birth_date: "There's no month 13.",
      "person.full_name": "Field required",
    });
  });

  it("says the engine isn't answering, in words, never a code", () => {
    for (const status of [0, 502, 503, 504]) {
      const error = toApiError(status, null);
      expect(error.message).toBe("AncesTree's engine isn't answering.");
      expect(error.code).toBe("not_answering");
    }
    expect(toApiError(500, "Internal Server Error").message).toBe(
      "Something went wrong in AncesTree's engine.",
    );
    expect(toApiError(418, null).message).toBe("That didn't work.");
    expect(toApiError(404, { detail: "Not Found" }).message).toBe("Not Found");
  });
});

describe("a fetch that never reaches the engine", () => {
  it("says so in words, never the browser's", async () => {
    for (const said of ["Failed to fetch", "Load failed"]) {
      vi.stubGlobal("fetch", async () => {
        throw new TypeError(said);
      });
      const error = await reach("/api/graph").catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toBe(NOT_ANSWERING);
      expect((error as ApiError).code).toBe("not_answering");
    }
  });

  it("through the typed client too", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await unwrap(api.GET("/api/graph")).catch((thrown: unknown) => thrown);
    expect(inWords(error)).toBe("AncesTree's engine isn't answering.");
    expect(canTryAgain(error)).toBe(true);
  });

  it("leaves a fetch stopped on purpose as it is", async () => {
    const stopped = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", async () => {
      throw stopped;
    });
    await expect(reach("/api/graph")).rejects.toBe(stopped);
  });

  it("puts the browser's words into ours wherever they come from", () => {
    expect(inWords(new TypeError("Failed to fetch"))).toBe(NOT_ANSWERING);
    expect(inWords(new TypeError("Load failed"))).toBe(NOT_ANSWERING);
    expect(inWords(new Error("Ali is already linked."))).toBe("Ali is already linked.");
    expect(inWords("something")).toBe("Something went wrong.");
  });

  it("offers Try again only where trying again may work", () => {
    expect(canTryAgain(toApiError(0, null))).toBe(true);
    expect(canTryAgain(toApiError(500, null))).toBe(true);
    expect(canTryAgain(toApiError(409, { detail: { code: "cycle", message: "A loop." } }))).toBe(
      false,
    );
    expect(canTryAgain(toApiError(404, { detail: { code: "not_found", message: "Gone." } }))).toBe(
      false,
    );
  });
});
