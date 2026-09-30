/**
 * The family as a copy to edit carries it (backend/src/ancestree/exchange/records.py, M20):
 * everyone's stored properties under the database's own names, those not set left out, and
 * every link. Everything else a copy to edit answers is worked out from these.
 */
import type { Gender, PartialDate, Place, SpouseStatus } from "@/api/types";

/** Someone's stored properties. Missing ones aren't set (null in the database's terms). */
export type PersonRecord = {
  id: string;
  full_name: string;
  gender: Gender;
  placeholder: boolean;
  has_photo: boolean;
  nickname?: string | null;
  title?: string | null;
  name_jawi?: string | null;
  birth_year?: number | null;
  birth_month?: number | null;
  birth_day?: number | null;
  birth_qualifier?: PartialDate["qualifier"] | null;
  birth_year_to?: number | null;
  birth_original_text?: string | null;
  death_year?: number | null;
  death_month?: number | null;
  death_day?: number | null;
  death_qualifier?: PartialDate["qualifier"] | null;
  death_year_to?: number | null;
  death_original_text?: string | null;
  birth_town?: string | null;
  birth_state?: string | null;
  birth_country?: string | null;
  death_town?: string | null;
  death_state?: string | null;
  death_country?: string | null;
  residence_town?: string | null;
  residence_state?: string | null;
  residence_country?: string | null;
  burial_place?: string | null;
  living?: boolean | null;
  occupation?: string | null;
  notes?: string | null;
  birth_order?: number | null;
  photo_version?: number | null;
  layout_x?: number | null;
  layout_y?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** A link: for "parent" links `source` is the parent and `target` the child. */
export type LinkRecord = {
  id: string;
  type: "parent" | "spouse";
  source: string;
  target: string;
  kind: string | null;
  status: SpouseStatus | null;
  order: number | null;
};

export type CopyFamily = { people: PersonRecord[]; links: LinkRecord[] };

/** A date with every part there, as the API writes a PartialDate. */
export type DateParts = {
  year: number | null;
  month: number | null;
  day: number | null;
  qualifier: PartialDate["qualifier"];
  year_to: number | null;
  original_text: string | null;
};

export const BIOLOGICAL = "biological";
/** With no death recorded, someone born within this many years is taken to be alive. */
export const LIVING_WITHIN_YEARS = 110;

type DatePrefix = "birth" | "death";
type PlacePrefix = "birth" | "death" | "residence";

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysIn(month: number, year: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const inRange = (value: number | null, low: number, high: number) =>
  value === null || (Number.isInteger(value) && value >= low && value <= high);

/** Whether a date's parts make a date, as the PartialDate model checks them (domain/person.py). */
export function validDate(date: DateParts): boolean {
  const { year, month, day, qualifier, year_to } = date;
  if (!inRange(year, 1, 9999) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) return false;
  if (!inRange(year_to, 1, 9999)) return false;
  if (day !== null && month === null) return false;
  if (month !== null && year === null) return false;
  if (year !== null && month !== null && day !== null && day > daysIn(month, year)) return false;
  if (qualifier === "between") {
    if (year === null || year_to === null || year_to < year) return false;
  } else if (year_to !== null) {
    return false;
  }
  return !(year === null && qualifier !== "exact");
}

function datePart(record: PersonRecord, prefix: DatePrefix) {
  const get = <K extends keyof PersonRecord>(name: K) => record[name] ?? null;
  return prefix === "birth"
    ? {
        year: get("birth_year"),
        month: get("birth_month"),
        day: get("birth_day"),
        qualifier: get("birth_qualifier"),
        year_to: get("birth_year_to"),
        original_text: get("birth_original_text"),
      }
    : {
        year: get("death_year"),
        month: get("death_month"),
        day: get("death_day"),
        qualifier: get("death_qualifier"),
        year_to: get("death_year_to"),
        original_text: get("death_original_text"),
      };
}

/** A date as the tree reads it (services/graph.py date_from_row): whatever doesn't fit is
 *  dropped rather than failing, a day, then the month, then the qualifier. No year, no date. */
export function dateFromRow(record: PersonRecord, prefix: DatePrefix): DateParts | null {
  const parts = datePart(record, prefix);
  if (parts.year === null) return null;
  const full: DateParts = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    qualifier: parts.qualifier || "exact",
    year_to: parts.year_to,
    original_text: null,
  };
  for (const attempt of [
    full,
    { ...full, day: null },
    { ...full, day: null, month: null },
    { ...full, day: null, month: null, qualifier: "exact" as const, year_to: null },
  ]) {
    if (validDate(attempt)) return attempt;
  }
  return null;
}

/** A date as the person view reads it (repo/mapping.py date_from_props): as stored, or null
 *  when nothing of it is. */
export function dateFromProps(record: PersonRecord, prefix: DatePrefix): DateParts | null {
  const parts = datePart(record, prefix);
  if (Object.values(parts).every((value) => value === null)) return null;
  return { ...parts, qualifier: parts.qualifier ?? "exact" };
}

/** A place as stored (repo/mapping.py place_from): null when none of it is. */
export function placeFrom(record: PersonRecord, prefix: PlacePrefix): Place | null {
  const town = record[`${prefix}_town`] ?? null;
  const state = record[`${prefix}_state`] ?? null;
  const country = record[`${prefix}_country`] ?? null;
  if (town === null && state === null && country === null) return null;
  return { town, state, country: country ?? "Malaysia" };
}

/** Alive or not (services/detail.py living_from): as set by hand; else no death recorded and
 *  born within 110 years. Null when there's nothing to go on. */
export function livingFrom(
  living: boolean | null | undefined,
  born: DateParts | null,
  died: DateParts | null,
  thisYear: number,
): boolean | null {
  if (living != null) return living;
  if (died !== null) return false;
  if (born === null || born.year === null) return null;
  return born.year > thisYear - LIVING_WITHIN_YEARS;
}
