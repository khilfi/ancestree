import { describe, expect, it } from "vitest";
import { formatPlace, initials, lifeYears, relationWord } from "./people";

describe("initials", () => {
  it("uses the given names, not the patronymic", () => {
    expect(initials("Hassan bin Ismail")).toBe("H");
    expect(initials("Siti Nur Aisyah binti Rahman")).toBe("SN");
    expect(initials("Unknown parent")).toBe("UP");
  });
});

describe("lifeYears", () => {
  it("shows whichever years are known", () => {
    expect(lifeYears({ birth_year: 1938, death_year: 2011 })).toBe("1938–2011");
    expect(lifeYears({ birth_year: 1998, death_year: null })).toBe("b. 1998");
    expect(lifeYears({ birth_year: null, death_year: 1975 })).toBe("d. 1975");
    expect(lifeYears({ birth_year: null, death_year: null })).toBe("");
  });
});

describe("relationWord", () => {
  it("names a relative by their gender, or neutrally", () => {
    expect(relationWord("parent", "female")).toBe("Mother");
    expect(relationWord("child", "male")).toBe("Son");
    expect(relationWord("sibling", "unknown")).toBe("Sibling");
  });
});

describe("formatPlace", () => {
  it("leaves out Malaysia, the usual country, and anything unknown", () => {
    expect(
      formatPlace({ town: "Kuala Pilah", state: "Negeri Sembilan", country: "Malaysia" }),
    ).toBe("Kuala Pilah, Negeri Sembilan");
    expect(formatPlace({ town: null, state: null, country: "Singapore" })).toBe("Singapore");
    expect(formatPlace(null)).toBe("");
  });
});
