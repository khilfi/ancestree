import { afterEach, describe, expect, it, vi } from "vitest";

// The notes, kept rather than shown.
const shown = vi.hoisted(
  () => [] as { kind: string; message: string; options: Record<string, unknown> }[],
);
vi.mock("sonner", () => {
  const keep =
    (kind: string) =>
    (message: string, options: Record<string, unknown> = {}) =>
      shown.push({ kind, message, options });
  return {
    toast: Object.assign(keep("note"), {
      success: keep("success"),
      warning: keep("warning"),
      error: keep("error"),
      dismiss: () => {},
    }),
  };
});

import { ApiError, NOT_ANSWERING } from "@/api/errors";
import type { RestoreResult } from "@/api/types";
import type { NoteLine } from "./notes";
import { offerTryAgain, showDone, showError, showRestored } from "./notify";

afterEach(() => {
  shown.length = 0;
});

function linesOf(index = 0): NoteLine[] {
  const description = shown[index]?.options.description as
    | { props: { lines: NoteLine[] } }
    | undefined;
  return description?.props.lines ?? [];
}

const gap = { code: "age_gap", message: "Ali is 70 years older than his son: is that right?" };
const married = {
  type: "marry" as const,
  message: "Are Hassan and Mariam married?",
  person_a: "hassan",
  person_b: "mariam",
};

describe("one action, one note", () => {
  it("says what was done, with what's worth a second look and what's asked inside it", () => {
    const marry = vi.fn();
    showDone("Linked Hassan bin Ismail.", {
      notices: [gap],
      suggestions: [married],
      marry,
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.message).toBe("Linked Hassan bin Ismail.");
    const [notice, question] = linesOf();
    expect(notice).toMatchObject({ words: gap.message, warning: true });
    expect(question?.words).toBe(married.message);
    expect(question?.button?.label).toBe("Yes, married");
    question?.button?.onClick();
    expect(marry).toHaveBeenCalledWith(married);
    // As long as the longest of them would have stayed, the question's 15 seconds.
    expect(shown[0]?.options.duration).toBe(15_000);
  });

  it("keeps its own button beside it, Undo or Open", () => {
    const open = vi.fn();
    showDone("Added Aina binti Hassan.", {
      notices: [gap],
      action: { label: "Open", onClick: open },
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.options.action).toMatchObject({ label: "Open" });
  });

  it("says nothing more where nothing more is said", () => {
    showDone("Saved.");
    expect(shown).toHaveLength(1);
    expect(shown[0]?.options.description).toBeUndefined();
  });

  it("brings back someone from the Trash in one note, with what couldn't come back", () => {
    const result = {
      person: { id: "hassan", full_name: "Hassan bin Ismail" },
      restored_links: 2,
      skipped_links: 1,
      left_out: ["Hassan bin Ismail's link to Ali bin Hassan can't come back: a loop."],
    } as unknown as RestoreResult;
    showRestored(result);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.message).toBe("Hassan bin Ismail is back, with 2 links.");
    expect(linesOf().map((line) => line.words)).toEqual([
      "1 link couldn't come back: the other person, or the relationship kind, is gone.",
      "Hassan bin Ismail's link to Ali bin Hassan can't come back: a loop.",
    ]);
  });
});

describe("what went wrong, in words", () => {
  it("never the browser's words", () => {
    showError(new TypeError("Failed to fetch"));
    expect(shown[0]).toMatchObject({ kind: "error", message: NOT_ANSWERING });
  });

  it("with Try again where the engine didn't answer", () => {
    const again = vi.fn();
    offerTryAgain(new ApiError(NOT_ANSWERING, 0, "not_answering"), again);
    const action = shown[0]?.options.action as { label: string; onClick: () => void };
    expect(shown[0]?.message).toBe("AncesTree's engine isn't answering.");
    expect(action.label).toBe("Try again");
    action.onClick();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("without it where a rule refused, which trying again won't change", () => {
    offerTryAgain(
      new ApiError("Ali already has two biological parents.", 409, "third_parent"),
      () => {},
    );
    expect(shown[0]?.options.action).toBeUndefined();
  });
});
