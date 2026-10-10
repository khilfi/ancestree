import { describe, expect, it } from "vitest";
import { z } from "@/lib/schema";

describe("Zod, for the pages' policy", () => {
  it("never compiles code, which the policy forbids", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("still checks a form as before", () => {
    const form = z.object({ name: z.string().min(1) });
    expect(form.safeParse({ name: "Siti" }).success).toBe(true);
    expect(form.safeParse({ name: "" }).success).toBe(false);
  });
});
