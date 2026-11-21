import { afterEach, describe, expect, it, vi } from "vitest";

// The notes, kept rather than shown.
const shown = vi.hoisted(() => [] as { message: string; options: Record<string, unknown> }[]);
vi.mock("sonner", () => ({
  toast: {
    success: (message: string, options: Record<string, unknown>) =>
      shown.push({ message, options }),
    dismiss: () => {},
  },
}));

import type { NoteLine } from "./notes";
import { showDone } from "./notify";
import { answeredSamePerson, hostSamePerson, samePersonAsked } from "./samePerson";

const twice = {
  code: "possible_duplicate",
  message: "There's already a Ali bin Hassan (born 1975) in the tree.",
  person: "new-ali",
  other: "first-ali",
};

/** The lines of a note under what was done, each with its button. */
function linesOf(index: number): NoteLine[] {
  const description = shown[index]?.options.description as { props: { lines: NoteLine[] } };
  return description.props.lines;
}

afterEach(() => {
  shown.length = 0;
  answeredSamePerson();
});

describe("the warning about someone in the tree already", () => {
  it("offers Same person as…, with both chosen, where the family can be changed", () => {
    const leave = hostSamePerson();
    showDone("Added Ali bin Hassan.", { notices: [twice] });
    const button = linesOf(0)[0]?.button;
    expect(button?.label).toBe("Same person as…");
    expect(samePersonAsked()).toBeNull();

    button?.onClick();
    // What the host opens: the one already there kept, and the one just added made one with them.
    expect(samePersonAsked()).toEqual({ person: "first-ali", other: "new-ali" });
    leave();
  });

  it("offers nothing where no one could open it, as in a view-only copy", () => {
    showDone("Added Ali bin Hassan.", { notices: [twice] });
    expect(linesOf(0)[0]?.button).toBeUndefined();
    showDone("Saved.", { notices: [{ code: "age_gap", message: "A big age gap." }] });
    expect(linesOf(1)[0]?.button).toBeUndefined();
  });
});
