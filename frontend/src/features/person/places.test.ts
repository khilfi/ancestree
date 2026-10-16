/**
 * Each place where it's meant: a place in one line, and a mix-up of places found and
 * put right, as the form and What's missing both do it. Addresses are made up.
 */
import { describe, expect, it } from "vitest";
import { hasPlace, mixup, movedHome, type PlaceLike, placeLine, toTown } from "./places";

const blank: PlaceLike = {
  address: "",
  town: "",
  district: "",
  state: "",
  postcode: "",
  country: "Malaysia",
  lat: null,
  lon: null,
  exact: null,
};
const klang: PlaceLike = { ...blank, town: "Klang", state: "Selangor" };
const house: PlaceLike = {
  ...klang,
  address: "No. 8, Jalan Kenari 2, Taman Sentosa",
  postcode: "41200",
  lat: 3.0312,
  lon: 101.4631,
  exact: "hand" as const,
};

describe("a place in one line", () => {
  it("says where, and how exactly it's on the map", () => {
    expect(placeLine(house)).toBe("No. 8, Jalan Kenari 2, Taman … Klang, Selangor · confirmed");
    expect(placeLine({ ...klang, lat: 3.04, lon: 101.45, exact: "town" })).toBe(
      "Klang, Selangor · at its town",
    );
    expect(placeLine({ ...blank, town: "Singapore", country: "Singapore" })).toBe(
      "Singapore, Singapore",
    );
    expect(placeLine(blank)).toBe("");
    expect(hasPlace(blank)).toBe(false);
  });
});

describe("a mix-up of places", () => {
  it("is found: living with a place of death, or an address where born and none where living", () => {
    const places = { residence: klang, birth_place: house, death_place: house };
    expect(mixup(places, true)).toEqual({ death: true, birth: true, home: "death_place" });
    expect(mixup(places, false)).toEqual({ death: false, birth: true, home: "birth_place" });
    expect(mixup({ residence: house, birth_place: klang, death_place: blank }, true)).toBeNull();
    // Where they live has its address already: the place of death goes, nothing moves.
    expect(mixup({ residence: house, birth_place: klang, death_place: klang }, true)).toEqual({
      death: true,
      birth: false,
      home: null,
    });
  });

  it("is put right: the address home, the birthplace kept to its town, a place of death gone", () => {
    const places = { residence: klang, birth_place: house, death_place: house };
    const wrong = mixup(places, true);
    if (!wrong) throw new Error("a mix-up");
    expect(movedHome(places, wrong, blank)).toEqual({
      residence: house,
      birth_place: toTown(house, blank),
      death_place: blank,
    });
    expect(toTown(house, blank)).toMatchObject({ town: "Klang", address: "", lat: null });
  });
});
