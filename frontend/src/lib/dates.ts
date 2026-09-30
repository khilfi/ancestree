import type { PartialDate } from "@/api/types";

/*
 * Partial dates in the browser: how one reads, and how old someone is.
 * The reading matches the server's describe_partial_date; both are tested on the examples in
 * date-readings.json. Ages come from here wherever they're shown.
 */

export type Qualifier = PartialDate["qualifier"];

/** A date as sent or received: the picker's parts, or what the API returns. */
export type DateLike = {
  year?: number | null;
  month?: number | null;
  day?: number | null;
  qualifier?: Qualifier;
  year_to?: number | null;
  original_text?: string | null;
};

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month. February has 29 while the year isn't known. */
export function daysInMonth(month: number, year: number | null | undefined): number {
  if (month === 2) return year == null || isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** "14 March 1938", "about 1920", "between 1910 and 1915": as the server says it. */
export function describeDate(date: DateLike): string {
  const qualifier = date.qualifier ?? "exact";
  if (qualifier === "between") return `between ${date.year} and ${date.year_to}`;
  if (date.year == null) return date.original_text ?? "";
  const month = date.month != null ? MONTH_NAMES[date.month - 1] : null;
  let core = String(date.year);
  if (month && date.day != null) core = `${date.day} ${month} ${date.year}`;
  else if (month) core = `${month} ${date.year}`;
  const prefix = { exact: "", about: "about ", before: "before ", after: "after ", between: "" };
  return prefix[qualifier] + core;
}

/** "12/3/1950", "c. 1950", "1910-1915": the editable form, as the server writes it
 *  (format_partial_date), and as it reads it back. */
export function formatDate(date: DateLike): string {
  const qualifier = date.qualifier ?? "exact";
  if (qualifier === "between") return `${date.year}-${date.year_to}`;
  if (date.year == null) return date.original_text ?? "";
  let core = String(date.year);
  if (date.day != null) core = `${date.day}/${date.month}/${date.year}`;
  else if (date.month != null) core = `${date.month}/${date.year}`;
  const prefix = { exact: "", about: "c. ", before: "before ", after: "after ", between: "" };
  return prefix[qualifier] + core;
}

/** A date as a point in time: the middle of whatever it doesn't say (the month, the day, or
 *  the years of a "between"). */
export function yearOf(date: DateLike): number {
  const year = date.year ?? 0;
  if (date.qualifier === "between" && date.year_to != null) return (year + date.year_to + 1) / 2;
  if (date.month == null) return year + 0.5;
  const day = date.day != null ? (date.day - 0.5) / 31 : 0.5;
  return year + (date.month - 1 + day) / 12;
}

/** Now, as a year with its fraction. */
export function yearNow(now = new Date()): number {
  return now.getFullYear() + (now.getMonth() + (now.getDate() - 0.5) / 31) / 12;
}

/** A day as a date: from the calendar, or back from a year with its fraction (`yearNow`). */
function dayOf(today: Date | number): DateLike {
  if (today instanceof Date) {
    return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
  }
  const year = Math.floor(today);
  const months = (today - year) * 12;
  const month = Math.min(11, Math.floor(months)) + 1;
  const day = Math.round((months - (month - 1)) * 31 + 0.5);
  return { year, month, day: Math.min(Math.max(day, 1), daysInMonth(month, year)) };
}

type Day = { y: number; m: number; d: number };

/** The earliest and latest days a date could be. */
function bounds(date: DateLike): [Day, Day] | null {
  if (date.year == null) return null;
  const last = date.qualifier === "between" && date.year_to != null ? date.year_to : date.year;
  const lastMonth = date.month ?? 12;
  return [
    { y: date.year, m: date.month ?? 1, d: date.day ?? 1 },
    { y: last, m: lastMonth, d: date.day ?? daysInMonth(lastMonth, last) },
  ];
}

function birthdays(from: Day, to: Day): number {
  const years = to.y - from.y;
  return to.m < from.m || (to.m === from.m && to.d < from.d) ? years - 1 : years;
}

type Years = { years: number; about: boolean };

/** Whole years from one date to another: exact when every reading of the two dates agrees,
 *  otherwise "about", from their middles. Null when it can't be said. */
export function yearsBetween(from: DateLike, to: DateLike): Years | null {
  const a = bounds(from);
  const b = bounds(to);
  if (!a || !b) return null;
  const least = birthdays(a[1], b[0]);
  const most = birthdays(a[0], b[1]);
  if (most < 0) return null; // the dates are the wrong way round
  const rough = (from.qualifier ?? "exact") !== "exact" || (to.qualifier ?? "exact") !== "exact";
  if (!rough && least === most) return { years: least, about: false };
  const middle = Math.floor(yearOf(to) - yearOf(from));
  const years = rough ? middle : Math.min(Math.max(middle, least), most);
  return { years: Math.max(0, years), about: true };
}

function yearsOld({ years, about }: Years): string {
  if (years === 0) return "under a year old";
  return `${about ? "about " : ""}${years} year${years === 1 ? "" : "s"} old`;
}

export type Age = {
  /** "40 years old", "about 40 years old", "died aged 73", "died aged about 73". */
  age: string | null;
  /** For someone who has died: "born 88 years ago", as old as they'd be today. */
  bornAgo: string | null;
};

/** How old someone is today, or was when they died. Nothing without a birth year. */
export function ageOf(
  person: {
    born: DateLike | null | undefined;
    died: DateLike | null | undefined;
    living: boolean | null | undefined;
  },
  today: Date | number = new Date(),
): Age {
  const { born, died, living } = person;
  if (born?.year == null) return { age: null, bornAgo: null };
  const sinceBirth = yearsBetween(born, dayOf(today));
  const alive = living !== false && died?.year == null;
  if (alive) return { age: sinceBirth ? yearsOld(sinceBirth) : null, bornAgo: null };
  let bornAgo: string | null = null;
  if (sinceBirth) {
    const { years, about } = sinceBirth;
    bornAgo =
      years === 0
        ? "born less than a year ago"
        : `born ${about ? "about " : ""}${years} year${years === 1 ? "" : "s"} ago`;
  }
  const lived = died?.year != null ? yearsBetween(born, died) : null;
  let age: string | null = null;
  if (lived) {
    age =
      lived.years === 0
        ? "died under a year old"
        : `died aged ${lived.about ? "about " : ""}${lived.years}`;
  }
  return { age, bornAgo };
}
