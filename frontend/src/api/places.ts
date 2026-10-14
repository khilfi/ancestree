import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./client";
import { unwrap } from "./errors";

/** What an address line may be, in a country, as it's typed: its postcodes and towns,
 *  from the country's places, and whether those are on this computer. Asked a quarter of a
 *  second after the typing stops, for two letters or more; in a copy, nothing comes. */
export function usePlaceSuggestions(line: string, country: string) {
  const [asked, setAsked] = useState(line);
  useEffect(() => {
    const later = setTimeout(() => setAsked(line), 250);
    return () => clearTimeout(later);
  }, [line]);
  const wanted = asked.trim();
  return useQuery({
    queryKey: ["place-suggestions", wanted, country],
    queryFn: () =>
      unwrap(
        api.GET("/api/places/suggest", {
          params: { query: { line: wanted, country: country.trim() || "Malaysia" } },
        }),
      ),
    enabled: wanted.length >= 2,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/** What's nearest a pin put on the map before its address: its town, district, state and
 *  postcode, to fill in; null where nothing is near. */
export const useNearestPlace = () =>
  useMutation({
    mutationFn: (point: { lat: number; lon: number; country: string }) =>
      unwrap(
        api.GET("/api/places/near", {
          params: { query: { ...point, country: point.country.trim() || "Malaysia" } },
        }),
      ),
  });

/** An address looked up online, once: the engine asks Photon, and says what it found, to
 *  check. Refused where this computer looks nothing up online. */
export const useLookUp = () =>
  useMutation({
    mutationFn: (asked: { line: string; country: string }) =>
      unwrap(
        api.POST("/api/places/lookup", {
          body: { line: asked.line, country: lookupCountry(asked.country) },
        }),
      ),
  });

/** The country an address is looked up in: as written, or Malaysia where none is. */
const lookupCountry = (country: string) => country.trim() || "Malaysia";

/** What goes to Photon: the line as typed, with its country unless the line names it, as the
 *  engine sends it (maps/photon.py): Malaysia where no country is written, as it's asked. */
export function lookupQuery(line: string, country: string): string {
  const where = lookupCountry(country);
  const named = !line.toLowerCase().includes(where.toLowerCase());
  return named ? `${line.trim()}, ${where}` : line.trim();
}
