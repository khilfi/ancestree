import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { type Golden, type GoldenName, golden } from "./golden";
import { KinshipTwin } from "./twin";

function twinOf(data: Golden): KinshipTwin {
  return new KinshipTwin(data.people, data.links, data.kinds, data.kinship);
}

const FAMILIES: GoldenName[] = ["seed", "tables", "notes", "generated"];

describe.each(FAMILIES)("the %s family", (name) => {
  it("gets the Python engine's answers word for word", () => {
    const data = golden(name);
    const twin = twinOf(data);
    const wrong = data.answers.filter(
      (expected) => !isDeepStrictEqual(twin.answer(expected.a, expected.b), expected),
    );
    const first = wrong[0];
    if (first) {
      const said = `${wrong.length} of ${data.answers.length} answers differ; the first, ${first.a} > ${first.b}`;
      expect(twin.answer(first.a, first.b), said).toEqual(first);
    }
    expect(data.answers.length).toBeGreaterThan(0);
  });
});

describe("in a family of 2,000", () => {
  it("answers as fast as the app (under 300 ms)", () => {
    const data = golden("generated");
    const started = performance.now();
    const twin = twinOf(data);
    const built = performance.now() - started;
    const times = data.answers.map(({ a, b }) => {
      const start = performance.now();
      twin.answer(a, b);
      return performance.now() - start;
    });
    const each = times.reduce((sum, time) => sum + time, 0) / times.length;

    expect(built, "building the family").toBeLessThan(300);
    expect(each, "an answer, on average").toBeLessThan(100);
    expect(Math.max(...times), "the slowest answer").toBeLessThan(300);
  });
});
