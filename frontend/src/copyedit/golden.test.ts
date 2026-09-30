/**
 * A copy to edit works out the tree, its seats and people's views as Python does: the
 * twins against the golden files Python wrote (backend/tests/copy_golden.py).
 */
import { describe, expect, it } from "vitest";
import type { GraphLayout } from "@/api/types";
import { type Book, TermBook } from "@/kinship/terms";
import { type DetailKind, FamilyRows } from "./detail";
import { type CopyGoldenName, copyGolden } from "./golden";
import { buildGraph, buildLayout } from "./graph";

const FAMILIES: CopyGoldenName[] = ["seed", "tables", "notes", "generated"];

/** Seats as Python gives them: units, the tray and the centre in order; the seats as a map. */
function expectLayout(actual: GraphLayout, expected: GraphLayout, centre: string) {
  expect(
    actual.units.map((unit) => unit.id),
    centre,
  ).toEqual(expected.units.map((u) => u.id));
  expect(actual.units, centre).toEqual(expected.units);
  expect(actual.unlinked, centre).toEqual(expected.unlinked);
  expect(actual.centre_chosen, centre).toBe(expected.centre_chosen);
  const wrong = Object.keys(expected.seats).filter(
    (person) => JSON.stringify(actual.seats[person]) !== JSON.stringify(expected.seats[person]),
  );
  expect(wrong, centre).toEqual([]);
  expect(Object.keys(actual.seats).length, centre).toBe(Object.keys(expected.seats).length);
}

describe.each(FAMILIES)("the %s family", (name) => {
  const golden = copyGolden(name);
  const inLayout = new Map(golden.kinds.map((kind) => [kind.key, kind.in_layout]));

  it("makes the graph Python makes", () => {
    const graph = buildGraph(golden.family, inLayout, null, golden.year);
    if (golden.graph.people) expect(graph.people).toEqual(golden.graph.people);
    if (golden.graph.links) expect(graph.links).toEqual(golden.graph.links);
    expectLayout(graph.layout, golden.graph.layout, "the oldest ancestor");
  });

  it("seats everyone around other centres as Python does", () => {
    const centres = Object.entries(golden.layouts);
    expect(centres.length).toBeGreaterThan(0);
    for (const [centre, expected] of centres) {
      expectLayout(buildLayout(golden.family, inLayout, centre), expected, centre);
    }
  });

  it("gives each person's view, in each language, as Python does", () => {
    const rows = new FamilyRows(golden.family.people, golden.family.links);
    const kinds = new Map(golden.kinds.map((kind) => [kind.key, kind as DetailKind]));
    const books = new Map(
      Object.entries(golden.kinship.books).map(([code, book]) => [
        code,
        new TermBook(book as Book),
      ]),
    );
    const english = books.get("en") as TermBook;
    let compared = 0;
    for (const [person, views] of Object.entries(golden.details)) {
      for (const [language, expected] of Object.entries(views)) {
        const book = books.get(language) as TermBook;
        expect(
          rows.detail(person, kinds, book, english, golden.year),
          `${person} ${language}`,
        ).toEqual(expected);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
