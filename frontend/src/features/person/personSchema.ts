import type { PersonDetail, PersonInput, Place } from "@/api/types";
import { z } from "@/lib/schema";
import { dateInput, datePartsSchema, partsOf } from "./DatePicker";

// A place as the form holds it: the address in one line, and the rest it's filled in
// with, every part optional; where it is and how exactly, from a suggestion chosen.
const place = z.object({
  address: z.string(),
  town: z.string(),
  district: z.string(),
  state: z.string(),
  postcode: z.string(),
  country: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  exact: z.enum(["spot", "street", "postcode", "town", "hand"]).nullable(),
});

/** The form mirrors the backend's PersonInput; the backend has the final say (dates, blanks). */
export const personSchema = z.object({
  full_name: z.string().trim().min(1, "A name is needed."),
  nickname: z.string(),
  title: z.string(),
  name_jawi: z.string(),
  gender: z.enum(["male", "female", "unknown"]),
  birth_date: datePartsSchema,
  birth_place: place,
  death_date: datePartsSchema,
  death_place: place,
  burial_place: z.string(),
  residence: place,
  // With no place of their own: their parents' (""), their mother's, their father's, or
  // elsewhere.
  lives_with: z.enum(["", "mother", "father", "elsewhere"]),
  living: z.enum(["auto", "living", "deceased"]),
  occupation: z.string(),
  notes: z
    .string()
    .max(5000, "Keep notes under 5,000 characters; the biography is for longer text."),
});

export type PersonFormValues = z.infer<typeof personSchema>;

export function placeValues(value: Place | null | undefined): PersonFormValues["residence"] {
  return {
    address: value?.address ?? "",
    town: value?.town ?? "",
    district: value?.district ?? "",
    state: value?.state ?? "",
    postcode: value?.postcode ?? "",
    country: value?.country ?? "Malaysia",
    lat: value?.lat ?? null,
    lon: value?.lon ?? null,
    exact: value?.exact ?? null,
  };
}

export function formValues(person?: PersonDetail): PersonFormValues {
  return {
    full_name: person?.full_name ?? "",
    nickname: person?.nickname ?? "",
    title: person?.title ?? "",
    name_jawi: person?.name_jawi ?? "",
    gender: person?.gender ?? "unknown",
    birth_date: partsOf(person?.birth_date?.value),
    birth_place: placeValues(person?.birth_place),
    death_date: partsOf(person?.death_date?.value),
    death_place: placeValues(person?.death_place),
    burial_place: person?.burial_place ?? "",
    residence: placeValues(person?.residence),
    lives_with: person?.lives_with ?? "",
    living: person?.living == null ? "auto" : person.living ? "living" : "deceased",
    occupation: person?.occupation ?? "",
    notes: person?.notes ?? "",
  };
}

/** Blank fields go as "" and places as typed: the backend turns both into "unknown". Dates go
 *  as their parts. */
export function toInput(values: PersonFormValues): PersonInput {
  return {
    ...values,
    birth_date: dateInput(values.birth_date),
    death_date: dateInput(values.death_date),
    living: values.living === "auto" ? null : values.living === "living",
    lives_with: values.lives_with || null,
  };
}
