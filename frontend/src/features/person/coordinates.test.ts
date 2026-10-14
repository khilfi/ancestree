/**
 * Where a place is, typed or pasted in any common form. The points are near Kajang's,
 * Kota Bharu's and elsewhere's, with links as each map's app writes them.
 */
import { describe, expect, it } from "vitest";
import { readCoordinates } from "./coordinates";

const KAJANG = { lat: 3.0006, lon: 101.7869 };

describe("coordinates typed or pasted", () => {
  it.each([
    "3.0006, 101.7869",
    "3.0006,101.7869",
    "  3.0006 101.7869 ",
    "3.0006 N, 101.7869 E",
    "N 3.0006, E 101.7869",
    "3.0006°N 101.7869°E",
    "101.7869 E, 3.0006 N", // the longitude first, said by its letter
  ])("reads %j", (written) => {
    expect(readCoordinates(written)).toEqual(KAJANG);
  });

  it("reads degrees and minutes, with seconds or without", () => {
    expect(readCoordinates(`3°0'2.16"N 101°47'12.84"E`)).toEqual(KAJANG);
    expect(readCoordinates("3°0.036'N, 101°47.214'E")).toEqual(KAJANG);
    expect(readCoordinates("33°51'54\"S 151°12'34\"E")).toEqual({ lat: -33.865, lon: 151.209444 });
    expect(readCoordinates("-6.2, 106.816")).toEqual({ lat: -6.2, lon: 106.816 });
    expect(readCoordinates("51°30'N 0°7'W")).toEqual({ lat: 51.5, lon: -0.116667 });
  });

  it.each([
    "https://www.google.com/maps/@3.0006,101.7869,17z",
    "https://www.google.com/maps/place/Kajang/@2.99,101.78,15z/data=!4m6!3m5!1s0x0:0x0!8m2!3d3.0006!4d101.7869",
    "https://maps.google.com/?q=3.0006,101.7869",
    "https://www.google.com/maps/search/?api=1&query=3.0006%2C101.7869",
    "https://maps.apple.com/?ll=3.0006,101.7869&q=Home",
    "https://maps.apple.com/?q=3.0006,101.7869",
    "https://www.openstreetmap.org/?mlat=3.0006&mlon=101.7869#map=17/3.00/101.78",
    "https://www.openstreetmap.org/#map=17/3.0006/101.7869",
    "geo:3.0006,101.7869?z=17",
    "geo:0,0?q=3.0006,101.7869(Home)",
  ])("reads a map's link: %s", (link) => {
    expect(readCoordinates(link)).toEqual(KAJANG);
  });

  it("says why it can't read a short link, nonsense, or a point off the Earth", () => {
    expect(readCoordinates("https://maps.app.goo.gl/AbCdEf123")).toEqual({
      problem: expect.stringContaining("short link"),
    });
    for (const nonsense of ["Kajang", "91, 101", "3.0, 181", "https://example.com/", ""]) {
      expect(readCoordinates(nonsense)).toHaveProperty("problem");
    }
  });

  it("reads nothing longer than a map's link, so nothing pasted keeps it busy (0.8.0)", () => {
    const began = performance.now();
    expect(readCoordinates(`geo:0,0?q=${"1".repeat(200_000)}`)).toEqual({
      problem: "That's longer than a map's link is.",
    });
    expect(readCoordinates(`geo:0,0?q=${"1".repeat(3_900)}`)).toHaveProperty("problem");
    expect(performance.now() - began).toBeLessThan(1000);
  });
});
