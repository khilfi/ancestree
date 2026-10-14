import { describe, expect, it } from "vitest";
import type { GraphPerson } from "@/api/types";
import { enteredTwice } from "./twice";

function person(id: string, full_name: string, fields: Partial<GraphPerson> = {}): GraphPerson {
  return {
    id,
    full_name,
    nickname: null,
    gender: "unknown",
    birth_year: null,
    death_year: null,
    birth_order: null,
    placeholder: false,
    photo_version: null,
    has_story: false,
    ...fields,
  };
}

const pairs = (people: GraphPerson[]) =>
  enteredTwice(people).map(([keep, other]) => `${keep.id}+${other.id}`);

describe("people possibly entered twice", () => {
  it("finds two records with the same name and close birth years", () => {
    expect(
      pairs([
        person("a", "Ali bin Hassan", { birth_year: 1975 }),
        person("b", "ali  bin hassan", { birth_year: 1976 }),
        person("c", "Siti binti Ahmad", { birth_year: 1950 }),
      ]),
    ).toEqual(["a+b"]);
  });

  it("counts a birth year not known as close, and years far apart as two people", () => {
    expect(
      pairs([
        person("a", "Hassan bin Ismail", { birth_year: 1938 }),
        person("b", "Hassan bin Ismail"),
        person("c", "Hassan bin Ismail", { birth_year: 1990 }),
      ]),
    ).toEqual(["a+b", "c+b"]);
  });

  it("keeps the fuller record first, and never counts an unknown parent", () => {
    expect(
      pairs([
        person("a", "Nor binti Hassan"),
        person("b", "Nor binti Hassan", { photo_version: 2 }),
        person("x", "Unknown parent", { placeholder: true }),
        person("y", "Unknown parent", { placeholder: true }),
      ]),
    ).toEqual(["b+a"]);
  });
});
