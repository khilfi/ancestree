import type { Gender, Place, Relation } from "@/api/types";

/** Initials from the given name(s), skipping the patronymic ("bin"/"binti" and after). */
export function initials(fullName: string): string {
  const words = fullName.split(/\s+/).filter(Boolean);
  const end = words.findIndex((word) => /^(bin|binti)$/i.test(word));
  const given = end === -1 ? words : words.slice(0, end);
  return given
    .filter((word) => /^\p{L}/u.test(word)) // not "(Tok" or "2nd"
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function lifeYears(person: {
  birth_year: number | null;
  death_year: number | null;
}): string {
  const { birth_year: born, death_year: died } = person;
  if (born && died) return `${born}–${died}`;
  if (born) return `b. ${born}`;
  if (died) return `d. ${died}`;
  return "";
}

const WORDS: Record<Relation, Record<Gender, string>> = {
  parent: { male: "Father", female: "Mother", unknown: "Parent" },
  child: { male: "Son", female: "Daughter", unknown: "Child" },
  spouse: { male: "Husband", female: "Wife", unknown: "Spouse" },
  sibling: { male: "Brother", female: "Sister", unknown: "Sibling" },
};

/** "Mother", "Son"...: the word for someone in a relation, by their gender. */
export function relationWord(relation: Relation, gender: Gender): string {
  return WORDS[relation][gender];
}

export const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
];

export function formatPlace(place: Place | null | undefined): string {
  if (!place) return "";
  const country = place.country && place.country !== "Malaysia" ? place.country : null;
  return [place.town, place.state, country].filter(Boolean).join(", ");
}
