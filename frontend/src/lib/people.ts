import type { Gender, PartialDate, Place, Relation } from "@/api/types";

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

/** How sure a date is, where it's sent with its year. */
type Sureness = { qualifier?: PartialDate["qualifier"]; year_to?: number | null };

/** A year, said as sure as its date is, in the guide's short forms: "1950", "c. 1950",
 *  "before 1950", "after 1950", "1976–1978". */
function sayYear(year: number, date: Sureness | null | undefined): string {
  switch (date?.qualifier) {
    case "about":
      return `c. ${year}`;
    case "before":
      return `before ${year}`;
    case "after":
      return `after ${year}`;
    case "between":
      return date.year_to != null ? `${year}–${date.year_to}` : String(year);
    default:
      return String(year);
  }
}

/**
 * Someone's years, short: "1938–2011", "b. 1998", "d. 1975". The one place they're written:
 * the tree, the panel, the relatives, the timeline, search and the lists of people. Where their
 * dates are sent whole (`born`, `died`), each year says how sure it is, by the user's answer
 * of 19–20 Nov 2026: "b. before 1950", "b. c. 1920", "c. 1872–1938"; a spaced dash
 * between two where either is itself two years, "1976–1978 – 2011".
 */
export function lifeYears(person: {
  birth_year: number | null;
  death_year: number | null;
  born?: Sureness | null;
  died?: Sureness | null;
}): string {
  const born = person.birth_year ? sayYear(person.birth_year, person.born) : null;
  const died = person.death_year ? sayYear(person.death_year, person.died) : null;
  if (born && died) {
    const between = person.born?.qualifier === "between" || person.died?.qualifier === "between";
    return between ? `${born} – ${died}` : `${born}–${died}`;
  }
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

export function formatPlace(place: Place | null | undefined, district?: string | null): string {
  if (!place) return "";
  const country = place.country && place.country !== "Malaysia" ? place.country : null;
  // Its district, where the gazetteer knows the town, unless the town is named for it.
  const said = district && district.toLowerCase() !== place.town?.toLowerCase() ? district : null;
  return [place.town, said, place.state, country].filter(Boolean).join(", ");
}
