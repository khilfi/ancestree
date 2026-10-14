import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { unwrap } from "./errors";
import type { Lookup, MapCountry, MapPack, MapPacks, MapPlaces, PackKey } from "./types";

export const MAP_PACKS = ["map-packs"] as const;

/** The map's packs of OpenStreetMap's tiles, and how each stands on this computer, with
 *  the countries they're of: asked every second while one is on its way, so its progress
 *  shows. Not asked in a copy, which keeps its own light drawing. */
export function useMapPacks(enabled = true) {
  return useQuery({
    queryKey: MAP_PACKS,
    queryFn: () => unwrap(api.GET("/api/map/packs")),
    refetchInterval: (query) =>
      query.state.data?.packs.some((pack) => pack.fetching) ? 1_000 : false,
    retry: false,
    enabled,
  });
}

/** The countries anyone in the family lives or was born in, by key: listed first. */
export function useFamilyCountries() {
  return useQuery({
    queryKey: ["map-packs", "family"],
    queryFn: () => unwrap(api.GET("/api/map/countries/family")),
    retry: false,
  });
}

function useChange(change: (key: PackKey) => Promise<MapPacks>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (packs: MapPacks) => client.setQueryData(MAP_PACKS, packs),
  });
}

/** Fetch a pack in the background; asking again says how it's going. */
export const useFetchPack = () =>
  useChange((key) => unwrap(api.POST("/api/map/packs/{key}", { params: { path: { key } } })));

/** Take a pack off this computer, stopping it first if it's on its way. */
export const useRemovePack = () =>
  useChange((key) => unwrap(api.DELETE("/api/map/packs/{key}", { params: { path: { key } } })));

/** Fetch every pack of a country, its own or each of its states'. */
export const useFetchCountry = () =>
  useChange((key) => unwrap(api.POST("/api/map/countries/{key}", { params: { path: { key } } })));

/** Take every pack of a country off this computer, stopping any on its way. */
export const useRemoveCountry = () =>
  useChange((key) => unwrap(api.DELETE("/api/map/countries/{key}", { params: { path: { key } } })));

/** Turn the map's online extra on or off: OpenFreeMap's tiles, where the packs end. */
export function useChooseOnline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => unwrap(api.PUT("/api/map/online", { body: { on } })),
    onSuccess: (packs: MapPacks) => client.setQueryData(MAP_PACKS, packs),
  });
}

/** Whether an address may be looked up online on this computer: asked each time, without
 *  asking, or never. */
export function useChooseLookup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (lookup: Lookup) => unwrap(api.PUT("/api/map/lookup", { body: { lookup } })),
    onSuccess: (packs: MapPacks) => client.setQueryData(MAP_PACKS, packs),
  });
}

/** A size in megabytes, as the guide says sizes: "45 MB", "168 MB". */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000).toLocaleString("en-GB")} MB`;
}

/** A size as the guide says it: in megabytes, or past a thousand of them in gigabytes,
 *  "8.2 GB". */
export function sizeOf(bytes: number): string {
  return bytes >= 999_500_000 ? `${(bytes / 1e9).toFixed(1)} GB` : megabytes(bytes);
}

/** How a pack stands, in words: "On this computer", "Fetching: 12 of 45 MB". */
export function packState(pack: MapPack): string {
  if (pack.installed) return "On this computer";
  if (pack.fetching) return `Fetching: ${sizeOf(pack.done)} of ${sizeOf(pack.size)}`;
  return pack.error ?? "Not on this computer";
}

/** How a country stands, from its packs: all of it here, some of its states, on its way,
 *  or why it last failed. */
export function countryState(
  country: Pick<MapCountry, "packs">,
  packs: ReadonlyMap<string, MapPack>,
  places?: MapPlaces,
) {
  const parts = country.packs.flatMap((key) => packs.get(key) ?? []);
  const here = parts.filter((pack) => pack.installed);
  // What comes with it: its places, counted in, as they come with any of its packs.
  const all = [...parts, ...(places ? [places] : [])];
  const size = all.reduce((sum, each) => sum + each.size, 0);
  const done = all.reduce(
    (sum, each) => sum + (each.installed ? each.size : each.fetching ? each.done : 0),
    0,
  );
  const fetching = all.some((each) => each.fetching);
  const error = fetching ? null : (all.find((each) => each.error)?.error ?? null);
  const installed = parts.length > 0 && all.every((each) => each.installed);
  let words = "Not on this computer";
  if (installed) words = "On this computer";
  else if (fetching) words = `Fetching: ${sizeOf(done)} of ${sizeOf(size)}`;
  else if (error) words = error;
  else if (here.length && here.length === parts.length)
    words = "On this computer, without its places";
  else if (here.length) words = `${here.length} of its ${parts.length} states on this computer`;
  return { parts, size, done, fetching, error, installed, some: here.length > 0, words };
}
