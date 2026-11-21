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

  // Short years keep a date's qualifier, by the user's answer of 19–20 Nov 2026:
  // "before 1950" showed as "b. 1950", and "about 1920" as "b. 1920", as if each were certain.
  it("says how sure each year is, as the guide writes such dates", () => {
    const years = (born: object | null, died: object | null = null) =>
      lifeYears({
        birth_year: (born as { year?: number } | null)?.year ?? null,
        death_year: (died as { year?: number } | null)?.year ?? null,
        born: born as never,
        died: died as never,
      });
    expect(years({ year: 1950, qualifier: "before" })).toBe("b. before 1950");
    expect(years({ year: 1920, qualifier: "about" })).toBe("b. c. 1920");
    expect(years({ year: 1945, qualifier: "after" })).toBe("b. after 1945");
    expect(years({ year: 1976, qualifier: "between", year_to: 1978 })).toBe("b. 1976–1978");
    expect(years(null, { year: 2010, qualifier: "about" })).toBe("d. c. 2010");
    expect(years({ year: 1950, month: 3, day: 12, qualifier: "exact" })).toBe("b. 1950");
    // Both: an en dash between, as ever; spaced where either is itself two years.
    expect(years({ year: 1872, qualifier: "about" }, { year: 1938 })).toBe("c. 1872–1938");
    expect(years({ year: 1950, qualifier: "before" }, { year: 2011, qualifier: "after" })).toBe(
      "before 1950–after 2011",
    );
    expect(years({ year: 1976, qualifier: "between", year_to: 1978 }, { year: 2011 })).toBe(
      "1976–1978 – 2011",
    );
    expect(years({ year: 1938 }, { year: 2011 })).toBe("1938–2011");
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

  it("says the district where the gazetteer knows the town, not twice", () => {
    const laut = { town: "Kampung Laut", state: "Kelantan", country: "Malaysia" };
    expect(formatPlace(laut, "Tumpat")).toBe("Kampung Laut, Tumpat, Kelantan");
    const bharu = { town: "Kota Bharu", state: "Kelantan", country: "Malaysia" };
    expect(formatPlace(bharu, "Kota Bharu")).toBe("Kota Bharu, Kelantan");
    const ubud = { town: "Ubud", state: "Bali", country: "Indonesia" };
    expect(formatPlace(ubud, "Kabupaten Gianyar")).toBe("Ubud, Kabupaten Gianyar, Bali, Indonesia");
    expect(formatPlace(laut, null)).toBe("Kampung Laut, Kelantan");
  });
});
