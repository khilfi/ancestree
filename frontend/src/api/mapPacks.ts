import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { unwrap } from "./errors";
import type { MapPack, MapPacks, PackKey } from "./types";

export const MAP_PACKS = ["map-packs"] as const;

/** The map's packs of OpenStreetMap's tiles, and how each stands on this computer: asked
 *  every second while one is on its way, so its progress shows. Not asked in a copy, which
 *  keeps its own light drawing. */
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

/** Fetch a pack in the background; asking again says how it's going. */
export function useFetchPack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: PackKey) =>
      unwrap(api.POST("/api/map/packs/{key}", { params: { path: { key } } })),
    onSuccess: (packs: MapPacks) => client.setQueryData(MAP_PACKS, packs),
  });
}

/** Take a pack off this computer, stopping it first if it's on its way. */
export function useRemovePack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: PackKey) =>
      unwrap(api.DELETE("/api/map/packs/{key}", { params: { path: { key } } })),
    onSuccess: (packs: MapPacks) => client.setQueryData(MAP_PACKS, packs),
  });
}

/** Turn the map's online extra on or off: OpenFreeMap's tiles, where the packs end. */
export function useChooseOnline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => unwrap(api.PUT("/api/map/online", { body: { on } })),
    onSuccess: (packs: MapPacks) => client.setQueryData(MAP_PACKS, packs),
  });
}

/** A size in megabytes, as the guide says sizes: "45 MB", "168 MB". */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000).toLocaleString("en-GB")} MB`;
}

/** How a pack stands, in words: "On this computer", "Fetching: 12 of 45 MB". */
export function packState(pack: MapPack): string {
  if (pack.installed) return "On this computer";
  if (pack.fetching) return `Fetching: ${megabytes(pack.done)} of ${megabytes(pack.size)}`;
  return pack.error ?? "Not on this computer";
}
