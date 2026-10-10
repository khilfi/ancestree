import {
  megabytes,
  packState,
  useChooseOnline,
  useFetchPack,
  useMapPacks,
  useRemovePack,
} from "@/api/mapPacks";
import type { MapPack } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { showError } from "@/lib/notify";
import { cn } from "@/lib/utils";

/** Settings → Map: the map's packs of OpenStreetMap's tiles on this computer. The world
 *  comes on first opening the map; each region is fetched here, or removed to make room. And
 *  the online extra, off unless chosen here, with what it tells OpenFreeMap. */
export function MapSection() {
  const packs = useMapPacks();
  const fetchPack = useFetchPack();
  const removePack = useRemovePack();
  const chooseOnline = useChooseOnline();
  const busy = fetchPack.isPending || removePack.isPending;

  const action = (pack: MapPack) => {
    if (pack.fetching) {
      return (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => removePack.mutate(pack.key, { onError: showError })}
        >
          Stop
        </Button>
      );
    }
    if (!pack.installed) {
      return (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => fetchPack.mutate(pack.key, { onError: showError })}
        >
          {pack.error ? "Try again" : "Fetch"}
        </Button>
      );
    }
    // The world stays: the map would only fetch it again.
    return pack.first ? null : (
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => removePack.mutate(pack.key, { onError: showError })}
      >
        Remove
      </Button>
    );
  };

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Map</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          The map's detail comes from OpenStreetMap, in packs AncesTree keeps on this computer, so
          the map looks nothing up online as you use it, unless you choose online detail below. The
          world comes the first time you open the map; fetch a region here for its towns, roads and
          kampungs close up. Each pack is checked before it's used.
        </p>
      </div>
      {packs.isPending && <p className="text-sm text-stone-500">Loading…</p>}
      {packs.isError && <p className="text-sm text-red-600">{packs.error.message}</p>}
      {packs.data && (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {packs.data.packs.map((pack) => (
            <li key={pack.key} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{pack.title}</div>
                <div
                  className={cn(
                    "text-xs",
                    pack.error && !pack.fetching ? "text-red-600" : "text-stone-500",
                  )}
                >
                  {megabytes(pack.size)} · {packState(pack)}
                </div>
                {pack.fetching && (
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100"
                    role="progressbar"
                    aria-label={`${pack.title}, fetched so far`}
                    aria-valuemin={0}
                    aria-valuemax={pack.size}
                    aria-valuenow={pack.done}
                  >
                    <div
                      className="h-full bg-sky-600 transition-[width]"
                      style={{ width: `${(100 * pack.done) / Math.max(pack.size, 1)}%` }}
                    />
                  </div>
                )}
              </div>
              {action(pack)}
            </li>
          ))}
        </ul>
      )}
      {packs.data && (
        <div className="flex items-start gap-3 rounded-lg border border-stone-200 px-4 py-3">
          <Switch
            id="map-online"
            className="mt-0.5"
            checked={packs.data.online}
            disabled={chooseOnline.isPending}
            onCheckedChange={(on) => chooseOnline.mutate(on, { onError: showError })}
          />
          <div className="min-w-0 space-y-1">
            <label htmlFor="map-online" className="font-medium">
              Online detail where the packs end
            </label>
            <p className="max-w-2xl text-xs text-stone-500">
              OpenFreeMap fills in what no pack here shows close up: a town abroad, say, or
              Indonesia closer than its pack goes. As you look at those places, AncesTree asks
              OpenFreeMap's server for them, so it learns which parts of the world you look at, from
              this computer's internet address. It learns nothing about your family, and nothing
              where a pack has the detail. Off, the map asks nothing of the internet.
            </p>
          </div>
        </div>
      )}
      {packs.data && (
        <p className="text-xs text-stone-500">
          Map data © OpenStreetMap contributors, under the Open Database License, as Protomaps cut
          it on {packs.data.build.slice(6, 8)}/{packs.data.build.slice(4, 6)}/
          {packs.data.build.slice(0, 4)}
          {packs.data.online
            ? ", and as OpenFreeMap cuts it each week, in OpenMapTiles' form."
            : "."}
        </p>
      )}
    </section>
  );
}
