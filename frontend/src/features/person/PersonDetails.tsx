import type { ReactNode } from "react";
import type { PersonDetail } from "@/api/types";
import { ageOf } from "@/lib/dates";
import { formatPlace } from "@/lib/people";

const GENDER = { male: "Male", female: "Female", unknown: "Not recorded" } as const;

function lifeStatus(person: PersonDetail): string {
  if (person.is_living === null) return "Not known";
  const status = person.is_living ? "Living" : "Deceased";
  return person.living === null ? `${status} (from the dates)` : status;
}

/** "12 March 1950 in Kuala Pilah, Negeri Sembilan", or whichever half is known. */
function lifeEvent(date: PersonDetail["birth_date"], place: PersonDetail["birth_place"]): string {
  const where = formatPlace(place);
  if (date && where) return `${date.description} in ${where}`;
  return date?.description ?? where;
}

/** Said after where someone with no place of their own lives: whose place it is. */
export const AT_PARENTS = {
  mother: "(at their mother's)",
  father: "(at their father's)",
  parents: "(at their parents')",
} as const;

/** Where they live: their own place, or with none, their parents', said whose. */
function livesIn(person: PersonDetail): string {
  const at = person.residence_at_parents;
  if (person.residence || !at) return formatPlace(person.residence, person.residence_district);
  return `${formatPlace(at.place, at.district)} ${AT_PARENTS[at.whose]}`;
}

/** The house and street where they live, with its postcode where the line hasn't it. */
function addressOf(place: PersonDetail["residence"]): string {
  if (!place?.address) return place?.postcode ?? "";
  const postcode = place.postcode && !place.address.includes(place.postcode) ? place.postcode : "";
  return [place.address, postcode].filter(Boolean).join(" ");
}

function formatStamp(stamp: string | null): string {
  if (!stamp) return "";
  return new Date(stamp).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/** Everything recorded about someone, read-only. Empty fields are left out. */
export function PersonDetails({ person }: { person: PersonDetail }) {
  // "40 years old", or "died aged 73; born 88 years ago": their age at the time of viewing
  const { age, bornAgo } = ageOf({
    born: person.birth_date?.value,
    died: person.death_date?.value,
    living: person.is_living,
  });
  const rows: [string, ReactNode][] = [
    ["Full name", person.full_name],
    ["Title", person.title],
    ["Nickname", person.nickname],
    [
      "Name in Jawi",
      person.name_jawi && (
        <span dir="rtl" lang="ms-Arab">
          {person.name_jawi}
        </span>
      ),
    ],
    ["Gender", GENDER[person.gender]],
    ["Born", lifeEvent(person.birth_date, person.birth_place)],
    ["Age", [age, bornAgo].filter(Boolean).join("; ")],
    ["Status", lifeStatus(person)],
    ["Died", lifeEvent(person.death_date, person.death_place)],
    ["Buried at", person.burial_place],
    [person.is_living === false ? "Lived in" : "Lives in", livesIn(person)],
    ["Address", addressOf(person.residence)],
    ["Occupation", person.occupation],
    ["Notes", person.notes && <p className="whitespace-pre-wrap">{person.notes}</p>],
  ];
  const added = formatStamp(person.created_at);
  const updated = formatStamp(person.updated_at);

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-stone-100 text-sm">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2">
              <dt className="text-stone-500">{label}</dt>
              <dd className="min-w-0 break-words text-stone-900">{value}</dd>
            </div>
          ))}
      </dl>
      {added && (
        <p className="text-xs text-stone-400">
          Added {added}
          {updated && updated !== added ? ` · last changed ${updated}` : ""}
        </p>
      )}
    </div>
  );
}
