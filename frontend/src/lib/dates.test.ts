import { describe, expect, it } from "vitest";
import examples from "./date-readings.json";
import {
  ageOf,
  type DateLike,
  daysInMonth,
  describeDate,
  readDate,
  sayDate,
  yearOf,
  yearsBetween,
} from "./dates";
import typed from "./typed-dates.json";

const TODAY = new Date(2026, 8, 27); // 27 September 2026

describe("describeDate", () => {
  // The same examples as the server's test: the picker's reading matches what's saved.
  it.each(examples)("reads $reading as the server does", ({ date, reading }) => {
    expect(describeDate(date as DateLike)).toBe(reading);
  });
});

describe("readDate", () => {
  // The same examples as the server's test: what the form says it understood is what the server
  // reads, and both refuse the same dates in the same words.
  it.each(typed)("reads $text as the server does", (example) => {
    const read = readDate(example.text);
    if ("problem" in example) {
      expect(read).toEqual({ problem: example.problem });
      return;
    }
    if (!("date" in read)) throw new Error(`refused: ${read.problem}`);
    expect(read.date ? describeDate(read.date) : null).toBe(example.reading);
  });

  it("reads the plan's six forms, the day first", () => {
    const said = (text: string) => {
      const read = readDate(text);
      return "date" in read && read.date ? describeDate(read.date) : read;
    };
    expect(said("12/3/1950")).toBe("12 March 1950");
    expect(said("March 1950")).toBe("March 1950");
    expect(said("about 1950")).toBe("about 1950");
    expect(said("before 1960")).toBe("before 1960");
    expect(said("1950–1955")).toBe("between 1950 and 1955");
    expect(said("kira-kira 1950")).toBe("about 1950");
  });

  it("gives the parts, with nothing it wasn't told", () => {
    expect(readDate("12/3/1950")).toEqual({
      date: {
        qualifier: "exact",
        year: 1950,
        month: 3,
        day: 12,
        year_to: null,
        original_text: null,
      },
    });
    expect(readDate("1950s")).toEqual({
      date: {
        qualifier: "between",
        year: 1950,
        year_to: 1959,
        month: null,
        day: null,
        original_text: null,
      },
    });
  });
});

describe("sayDate", () => {
  it("says a date as it's typed", () => {
    expect(sayDate({ year: 1950, month: 3, day: 12 })).toBe("12/3/1950");
    expect(sayDate({ year: 1950, month: 3 })).toBe("March 1950");
    expect(sayDate({ year: 1950, qualifier: "about" })).toBe("about 1950");
    expect(sayDate({ year: 1960, qualifier: "before" })).toBe("before 1960");
    expect(sayDate({ year: 1950, year_to: 1955, qualifier: "between" })).toBe("1950–1955");
    expect(sayDate({ original_text: "zaman Jepun" })).toBe("");
    expect(sayDate({ year: 650 })).toBe("0650");
  });

  it("is read back as the same date, every precision and qualifier", () => {
    const qualifiers = ["exact", "about", "before", "after"] as const;
    for (const year of [1, 650, 1700, 1900, 1950, 2000, 2026, 9999]) {
      for (const qualifier of qualifiers) {
        const dates: DateLike[] = [{ year, qualifier }];
        for (let month = 1; month <= 12; month += 1) {
          dates.push({ year, month, qualifier });
          for (const day of [1, 15, daysInMonth(month, year)]) {
            dates.push({ year, month, day, qualifier });
          }
        }
        for (const date of dates) {
          const read = readDate(sayDate(date));
          expect("date" in read && read.date).toMatchObject({
            month: null,
            day: null,
            ...date,
          });
        }
      }
      const between = { year, year_to: Math.min(9999, year + 5), qualifier: "between" as const };
      expect("date" in readDate(sayDate(between)) && readDate(sayDate(between))).toMatchObject({
        date: between,
      });
    }
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
