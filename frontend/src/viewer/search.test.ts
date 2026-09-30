import { describe, expect, it } from "vitest";
import { findPeople, words } from "./search";
import cases from "./search-cases.json";

// The same searches the app's own search is tested on (backend/tests/unit/test_search.py).
describe("finding people in a copy", () => {
  it.each(cases.searches)("finds what the app finds for $text", ({ text, limit, found }) => {
    expect(findPeople(cases.people, text, limit).map((person) => person.id)).toEqual(found);
  });

  it("reads letters and digits as words", () => {
    expect(words("Dato' Hamid  bin_Kassim 2nd")).toEqual(["dato", "hamid", "bin", "kassim", "2nd"]);
  });
});
