import type { PartialDate } from "@/api/types";

/*
 * Partial dates in the browser: how one reads, how one is typed, and
 * how old someone is. The reading matches the server's describe_partial_date; both are tested
 * on the examples in date-readings.json. A typed date is read as the server's
 * parse_partial_date reads it: both are tested on typed-dates.json, its refusals word for
 * word. Ages come from here wherever they're shown.
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

/** A date as it's typed: "12/3/1950", day first as in Malaysia, "March
 *  1950", "about 1950", "before 1960", "1950–1955". `readDate` reads each back as the same
 *  date. Nothing for no date, or one the parts can't say yet. */
export function sayDate(date: DateLike): string {
  const qualifier = date.qualifier ?? "exact";
  const year = (value: number) => String(value).padStart(4, "0"); // 4 digits, as it's read
  if (qualifier === "between") {
    return date.year != null && date.year_to != null
      ? `${year(date.year)}–${year(date.year_to)}`
      : "";
  }
  if (date.year == null) return "";
  let core = year(date.year);
  if (date.month != null && date.day != null) core = `${date.day}/${date.month}/${core}`;
  else if (date.month != null) core = `${MONTH_NAMES[date.month - 1]} ${core}`;
  const prefix = { exact: "", about: "about ", before: "before ", after: "after ", between: "" };
  return prefix[qualifier] + core;
}

/** What typing a date gives: the date, nothing for a blank, or why it can't be read. */
export type Reading = { date: DateLike | null } | { problem: string };

const MONTHS: Record<string, number> = Object.fromEntries(
  [
    ["january", "jan", "januari"],
    ["february", "feb", "februari"],
    ["march", "mar", "mac"],
    ["april", "apr"],
    ["may", "mei"],
    ["june", "jun"],
    ["july", "jul", "julai"],
    ["august", "aug", "ogos"],
    ["september", "sep", "sept"],
    ["october", "oct", "oktober", "okt"],
    ["november", "nov"],
    ["december", "dec", "disember", "dis"],
  ].flatMap((names, index) => names.map((name) => [name, index + 1])),
);

// The server's patterns (domain/dates.py), in its order: read the same, they read alike.
const QUALIFIERS: [Qualifier, RegExp][] = [
  [
    "about",
    /^(?:circa|ca\.?|c\.?|about|abt\.?|approx\.?|around|~|sekitar|lebih kurang|kira-kira)\s*(?<rest>.+)$/,
  ],
  ["before", /^(?:before|bef\.?|<|sebelum)\s*(?<rest>.+)$/],
  ["after", /^(?:after|aft\.?|>|selepas)\s*(?<rest>.+)$/],
];
const RANGES = [
  /^(?:between|bet\.?|antara)\s+(?<a>\d{4})\s+(?:and|&|dan)\s+(?<b>\d{4})$/,
  // Hyphen, en dash or em dash: people type all three.
  /^(?<a>\d{4})\s*(?:-|–|—|to|hingga|sehingga)\s*(?<b>\d{4})$/,
];
const DECADE = /^(?:the\s+|tahun\s+)?(?<decade>\d{3}0)(?:'?s|\s*-?\s*an)$/;
const DATES = [
  /^(?<year>\d{4})$/,
  /^(?<month>\d{1,2})\s*[/.-]\s*(?<year>\d{4})$/,
  /^(?<day>\d{1,2})\s*[/.-]\s*(?<month>\d{1,2})\s*[/.-]\s*(?<year>\d{4})$/,
  /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/,
  /^(?<name>[a-z]+)\.?\s+(?<year>\d{4})$/,
  /^(?<day>\d{1,2})\s+(?<name>[a-z]+)\.?,?\s+(?<year>\d{4})$/,
  /^(?<name>[a-z]+)\.?\s+(?<day>\d{1,2}),?\s+(?<year>\d{4})$/,
];
const TWO_DIGIT_YEAR = /(?:^|[/.\s-])\d{2}$/;

/** A digit of any script as 0–9, as the server's `\d` and `int()` take it ("١٩٥٠" is 1950):
 *  each script's digits run from its 0 to 9, one after another. */
function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    let first = code;
    while (/\p{Nd}/u.test(String.fromCodePoint(first - 1))) first -= 1;
    return String((code - first) % 10);
  });
}

class Unreadable extends Error {}

/** A date read whole, or why not: the server's model checks the same (PartialDate). */
function built(date: Required<Omit<DateLike, "original_text">>): DateLike {
  if (date.year != null && date.year < 1) {
    throw new Unreadable("Input should be greater than or equal to 1.");
  }
  if (date.year != null && date.month != null && date.day != null) {
    if (date.day > daysInMonth(date.month, date.year)) {
      throw new Unreadable(`${MONTH_NAMES[date.month - 1]} ${date.year} has no day ${date.day}.`);
    }
  }
  return { ...date, original_text: null };
}

function monthOf(groups: Record<string, string | undefined>): number | null {
  let month: number;
  if (groups.month !== undefined) month = Number(groups.month);
  else if (groups.name !== undefined) {
    const found = MONTHS[groups.name];
    if (found === undefined) throw new Unreadable(`'${groups.name}' isn't a month name.`);
    month = found;
  } else return null;
  if (month < 1 || month > 12) throw new Unreadable(`There's no month ${month}.`);
  return month;
}

function read(text: string): DateLike | null {
  let cleaned = asciiDigits(text.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" "));
  if (!cleaned) return null;

  for (const pattern of RANGES) {
    const groups = pattern.exec(cleaned)?.groups;
    if (!groups) continue;
    const [first, last] = [Number(groups.a), Number(groups.b)];
    if (last < first) throw new Unreadable("The second year can't be before the first.");
    return built({ qualifier: "between", year: first, year_to: last, month: null, day: null });
  }
  const decade = DECADE.exec(cleaned)?.groups?.decade;
  if (decade !== undefined) {
    const start = Number(decade);
    return built({ qualifier: "between", year: start, year_to: start + 9, month: null, day: null });
  }

  let qualifier: Qualifier = "exact";
  for (const [candidate, pattern] of QUALIFIERS) {
    const rest = pattern.exec(cleaned)?.groups?.rest;
    if (rest === undefined) continue;
    qualifier = candidate;
    cleaned = rest;
    break;
  }
  for (const pattern of DATES) {
    const groups = pattern.exec(cleaned)?.groups;
    if (!groups) continue;
    const month = monthOf(groups);
    const day = groups.day !== undefined ? Number(groups.day) : null;
    if (day !== null && (day < 1 || day > 31)) throw new Unreadable(`There's no day ${day}.`);
    return built({ qualifier, year: Number(groups.year), month, day, year_to: null });
  }

  if (TWO_DIGIT_YEAR.test(cleaned)) {
    throw new Unreadable(`Use a 4-digit year in '${text.trim()}', e.g. 12/3/1950.`);
  }
  throw new Unreadable(
    `Couldn't read '${text.trim()}' as a date. Try 12/3/1950, March 1950, 1950 or about 1950.`,
  );
}

/** A date as it's typed, read as the server reads it (parse_partial_date): "12/3/1950" is 12
 *  March, the day first; "Mac 1950", "kira-kira 1950", "before 1960", "1950–1955", "1950s".
 *  A blank is no date. */
export function readDate(text: string): Reading {
  try {
    return { date: read(text) };
  } catch (error) {
    if (error instanceof Unreadable) return { problem: error.message };
    throw error;
  }
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
