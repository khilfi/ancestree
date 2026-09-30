import { z } from "zod";
import type { PersonDetail, PersonInput, Place } from "@/api/types";
import { dateInput, datePartsSchema, partsOf } from "./DatePicker";

const place = z.object({ town: z.string(), state: z.string(), country: z.string() });

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
  living: z.enum(["auto", "living", "deceased"]),
  occupation: z.string(),
  notes: z
    .string()
    .max(5000, "Keep notes under 5,000 characters; the biography is for longer text."),
});

export type PersonFormValues = z.infer<typeof personSchema>;

function placeValues(value: Place | null | undefined): PersonFormValues["residence"] {
  return {
    town: value?.town ?? "",
    state: value?.state ?? "",
    country: value?.country ?? "Malaysia",
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
  };
}
