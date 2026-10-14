import type { Exactness } from "@/api/types";

/*
 * Each place where it's meant: what a place block says
 * folded, and the mix-up the form once made easy, an address saved as someone's place of birth
 * or death while where they live had none, put right in one click. For the form's places and
 * the engine's alike, which have the same parts, blank or null.
 */

/** A place's parts, as the form holds them ("" for blank) or the engine sends them (null). */
export type PlaceLike = {
  address?: string | null;
  town?: string | null;
  district?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  exact?: Exactness | null;
};

const filled = (text: string | null | undefined) => Boolean(text?.trim());

/** An address line: a house and street, not just a town or a postcode. */
export function hasAddress(place: PlaceLike | null | undefined): boolean {
  return filled(place?.address);
}

/** Anything of a place given: its address, town, district, state, postcode or a pin. */
export function hasPlace(place: PlaceLike | null | undefined): boolean {
  if (!place) return false;
  const { address, town, district, state, postcode, lat } = place;
  return [address, town, district, state, postcode].some(filled) || lat != null;
}

/** How exactly a place is on the map, as a folded block says it. */
const HOW: Record<Exactness, string> = {
  spot: "exactly",
  hand: "pinned by hand",
  street: "at its street",
  postcode: "at its postcode's area",
  town: "at its town",
};

/** A place in one line, as its block shows it folded: "Lot 6259-C Jalan … Klang, Selangor ·
 *  pinned by hand"; "" for none. */
export function placeLine(place: PlaceLike | null | undefined): string {
  if (!place || !hasPlace(place)) return "";
  const address = (place.address ?? "").trim();
  const country = (place.country ?? "").trim();
  const state = (place.state ?? "").trim();
  const town = (place.town ?? "").trim();
  const rest = [
    town,
    state !== town ? state : "",
    country.toLowerCase() !== "malaysia" ? country : "",
  ].filter(Boolean);
  // A long address cut at a word: "Lot 6259-C Jalan … Klang, Selangor".
  const cut = address.length > 32 ? address.slice(0, 30).replace(/[\s,]+\S*$/, "") : "";
  const where = cut
    ? `${cut} … ${rest.join(", ")}`.trim()
    : [address, ...rest].filter(Boolean).join(", ") || (place.postcode ?? "").trim();
  const how = place.lat != null ? HOW[place.exact ?? "hand"] : "";
  return [where, how].filter(Boolean).join(" · ");
}

/** The same household: the same address line, town and country, capitals and spaces aside. */
function sameAddress(a: PlaceLike | null | undefined, b: PlaceLike | null | undefined): boolean {
  const key = (place: PlaceLike | null | undefined) =>
    [place?.address, place?.town, place?.country]
      .map((part) => (part ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))
      .join("|");
  return hasAddress(a) && hasAddress(b) && key(a) === key(b);
}

type Places<P> = { residence: P; birth_place: P; death_place: P };

/** What saving these places would ask about first, if anything: a living person with a
 *  place of death, or an address where they were born and none where they live. */
export type Mixup = {
  death: boolean; // living, with a place of death
  birth: boolean; // an address where they were born, none where they live
  home: "birth_place" | "death_place" | null; // the place moved to where they live, if any
};

export function mixup(places: Places<PlaceLike | null>, living: boolean): Mixup | null {
  const death = living && hasPlace(places.death_place);
  const birth = hasAddress(places.birth_place) && !hasAddress(places.residence);
  if (!death && !birth) return null;
  const from =
    death && (hasAddress(places.death_place) || !hasPlace(places.residence))
      ? "death_place"
      : birth
        ? "birth_place"
        : null;
  return { death, birth, home: hasAddress(places.residence) ? null : from };
}

/** These places put right (your answer of 14 Oct 2026): the address and its pin moved to where
 *  they live, the birthplace keeping its town, state and country, and a living person's place
 *  of death cleared. `blank` is an empty place as the caller holds one. */
export function movedHome<P extends PlaceLike>(
  places: Places<P>,
  wrong: Mixup,
  blank: P,
): Places<P> {
  const home = wrong.home ? places[wrong.home] : places.residence;
  const birthMoved = wrong.home === "birth_place" || sameAddress(places.birth_place, home);
  return {
    residence: home,
    birth_place: birthMoved ? toTown(places.birth_place, blank) : places.birth_place,
    death_place: wrong.death ? blank : places.death_place,
  };
}

/** A place no closer than its town: its address, postcode and pin gone. */
export function toTown<P extends PlaceLike>(place: P, blank: P): P {
  return {
    ...place,
    address: blank.address,
    postcode: blank.postcode,
    lat: null,
    lon: null,
    exact: null,
  };
}
