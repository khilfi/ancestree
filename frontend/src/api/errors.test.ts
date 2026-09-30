import { describe, expect, it } from "vitest";
import { toApiError } from "./errors";

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

  it("explains a server that didn't answer", () => {
    expect(toApiError(502, null).message).toBe("The AncesTree server didn't answer.");
    expect(toApiError(404, { detail: "Not Found" }).message).toBe("Not Found");
  });
});
