/**
 * Where the browser keeps nothing, such as some Android browsers for a file, a copy to
 * edit says so, so its bar can warn before the changes are lost.
 */
import { describe, expect, it, vi } from "vitest";
import type { BookContents } from "./book";
import { Keeper, readKept } from "./keep";

const contents: BookContents = {
  family: { people: [], links: [] },
  stories: {},
  files: {},
  photos: {},
  trash: [],
};

describe("keeping a copy's changes in the browser", () => {
  it("says so when the browser keeps nothing", async () => {
    const problem = vi.fn();
    const keeper = new Keeper("0199aaaa-0000-7000-8000-000000000001", null, problem);
    keeper.soon(() => contents);
    await keeper.now();

    expect(keeper.working).toBe(false);
    expect(problem).toHaveBeenCalledOnce();
    expect(await readKept("0199aaaa-0000-7000-8000-000000000001", null)).toBeNull();
  });
});
