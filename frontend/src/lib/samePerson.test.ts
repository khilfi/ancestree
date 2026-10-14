import { afterEach, describe, expect, it, vi } from "vitest";

// The toasts, kept rather than shown.
const shown = vi.hoisted(() => [] as { message: string; options: Record<string, unknown> }[]);
vi.mock("sonner", () => ({
  toast: {
    warning: (message: string, options: Record<string, unknown>) =>
      shown.push({ message, options }),
  },
}));

import { showNotices } from "./notify";
import { answeredSamePerson, hostSamePerson, samePersonAsked } from "./samePerson";

const twice = {
  code: "possible_duplicate",
  message: "There's already a Ali bin Hassan (born 1975) in the tree.",
  person: "new-ali",
  other: "first-ali",
};

afterEach(() => {
  shown.length = 0;
  answeredSamePerson();
});

describe("the warning about someone in the tree already", () => {
  it("offers Same person as…, with both chosen, where the family can be changed", () => {
    const leave = hostSamePerson();
    showNotices([twice]);
    const action = shown[0]?.options.action as { label: string; onClick: () => void };
    expect(action.label).toBe("Same person as…");
    expect(samePersonAsked()).toBeNull();

    action.onClick();
    // What the host opens: the one already there kept, and the one just added made one with them.
    expect(samePersonAsked()).toEqual({ person: "first-ali", other: "new-ali" });
    leave();
  });

  it("offers nothing where no one could open it, as in a view-only copy", () => {
    showNotices([twice]);
    expect(shown[0]?.options.action).toBeUndefined();
    showNotices([{ code: "age_gap", message: "A big age gap." }]);
    expect(shown[1]?.options.action).toBeUndefined();
  });
});
