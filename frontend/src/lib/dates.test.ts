import { describe, expect, it } from "vitest";
import examples from "./date-readings.json";
import { ageOf, type DateLike, daysInMonth, describeDate, yearOf, yearsBetween } from "./dates";

const TODAY = new Date(2026, 8, 27); // 27 September 2026

describe("describeDate", () => {
  // The same examples as the server's test: the picker's reading matches what's saved.
  it.each(examples)("reads $reading as the server does", ({ date, reading }) => {
    expect(describeDate(date as DateLike)).toBe(reading);
  });
});

describe("daysInMonth", () => {
  it("follows the month and the year, and allows 29 February until the year is known", () => {
    expect(daysInMonth(4, 1950)).toBe(30);
    expect(daysInMonth(2, 1950)).toBe(28);
    expect(daysInMonth(2, 2000)).toBe(29);
    expect(daysInMonth(2, 1900)).toBe(28);
    expect(daysInMonth(2, null)).toBe(29);
  });
});

describe("yearOf", () => {
  it("puts a date in the middle of what it doesn't say", () => {
    expect(yearOf({ year: 1950 })).toBe(1950.5);
    expect(yearOf({ year: 1950, month: 7 })).toBeCloseTo(1950.54, 2);
    expect(yearOf({ year: 1910, year_to: 1915, qualifier: "between" })).toBe(1913);
  });
});

describe("yearsBetween", () => {
  it("is exact when the dates leave no doubt", () => {
    expect(
      yearsBetween({ year: 1938, month: 3, day: 14 }, { year: 2011, month: 3, day: 13 }),
    ).toEqual({ years: 72, about: false });
    expect(
      yearsBetween({ year: 1938, month: 3, day: 14 }, { year: 2011, month: 3, day: 14 }),
    ).toEqual({ years: 73, about: false });
    // Born in March, and it's September: the birthday has passed whatever the day was.
    expect(yearsBetween({ year: 1986, month: 3 }, { year: 2026, month: 9, day: 27 })).toEqual({
      years: 40,
      about: false,
    });
  });

  it("says about when the birthday may or may not have come", () => {
    expect(yearsBetween({ year: 1986 }, { year: 2026, month: 9, day: 27 })).toEqual({
      years: 40,
      about: true,
    });
    expect(
      yearsBetween({ year: 1962, qualifier: "about" }, { year: 2026, month: 9, day: 27 }),
    ).toEqual({ years: 64, about: true });
  });

  it("can't say when a year is missing or the dates are the wrong way round", () => {
    expect(yearsBetween({}, { year: 2026 })).toBeNull();
    expect(yearsBetween({ year: 2000, month: 5, day: 2 }, { year: 1999 })).toBeNull();
  });
});

describe("ageOf", () => {
  it("gives the living their age today", () => {
    const born = { year: 1986, month: 3, day: 14 };
    expect(ageOf({ born, died: null, living: true }, TODAY)).toEqual({
      age: "40 years old",
      bornAgo: null,
    });
    expect(ageOf({ born: { year: 1986 }, died: null, living: true }, TODAY).age).toBe(
      "about 40 years old",
    );
    expect(ageOf({ born: { year: 2026, month: 5 }, died: null, living: true }, TODAY).age).toBe(
      "under a year old",
    );
    expect(ageOf({ born: { year: 2025, month: 1 }, died: null, living: true }, TODAY).age).toBe(
      "1 year old",
    );
  });

  it("gives those who have died their age at death, and how long ago they were born", () => {
    const hassan = {
      born: { year: 1938, month: 3, day: 14 },
      died: { year: 2011, month: 10, day: 3 },
      living: false,
    };
    expect(ageOf(hassan, TODAY)).toEqual({ age: "died aged 73", bornAgo: "born 88 years ago" });
    expect(ageOf({ ...hassan, died: { year: 2011 } }, TODAY).age).toBe("died aged about 73");
  });

  it("says only how long ago someone was born when their death isn't dated", () => {
    expect(ageOf({ born: { year: 1901 }, died: null, living: false }, TODAY)).toEqual({
      age: null,
      bornAgo: "born about 125 years ago",
    });
  });

  it("says nothing without a birth year", () => {
    expect(ageOf({ born: null, died: { year: 1990 }, living: false }, TODAY)).toEqual({
      age: null,
      bornAgo: null,
    });
  });

  it("takes today as a year with its fraction, as the timeline keeps it", () => {
    expect(
      ageOf({ born: { year: 1986, month: 3, day: 14 }, died: null, living: true }, 2026.7).age,
    ).toBe("40 years old");
  });
});
