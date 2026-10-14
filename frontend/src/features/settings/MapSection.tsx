import { useMemo, useState } from "react";
import {
  countryState,
  packState,
  sizeOf,
  useChooseLookup,
  useChooseOnline,
  useFamilyCountries,
  useFetchCountry,
  useFetchPack,
  useMapPacks,
  useRemoveCountry,
  useRemovePack,
} from "@/api/mapPacks";
import type { Lookup, MapCountry, MapPack, MapPlaces } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { showError } from "@/lib/notify";
import { cn } from "@/lib/utils";

/** A country a search found, and the states it found it by, if not by its own name. */
type Found = { country: MapCountry; matching: MapPack[] | null };

/** A name as it's searched for: small letters, no accents, so "aland" finds Åland. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** How far a download has come, as a bar. */
function Progress({ label, done, size }: { label: string; done: number; size: number }) {
  return (
    <div
      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100"
      role="progressbar"
      aria-label={`${label}, fetched so far`}
      aria-valuemin={0}
      aria-valuemax={size}
      aria-valuenow={done}
    >
      <div
        className="h-full bg-sky-600 transition-[width]"
        style={{ width: `${(100 * done) / Math.max(size, 1)}%` }}
      />
    </div>
  );
}

/** One state's pack, of a country split by state, with Download, Stop, Try again or
 *  Remove as fits. Its country's places come with it. */
function PackRow({ pack }: { pack: MapPack }) {
  const fetchPack = useFetchPack();
  const removePack = useRemovePack();
  const busy = fetchPack.isPending || removePack.isPending;
  const remove = () => removePack.mutate(pack.key, { onError: showError });
  let action: React.ReactNode = null;
  if (pack.fetching) {
    action = (
      <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
        Stop
      </Button>
    );
  } else if (!pack.installed) {
    action = (
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => fetchPack.mutate(pack.key, { onError: showError })}
      >
        {pack.error ? "Try again" : "Download"}
      </Button>
    );
  } else if (!pack.first) {
    action = (
      <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
        Remove
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{pack.title}</div>
        <div
          className={cn(
            "text-xs",
            pack.error && !pack.fetching ? "text-red-600" : "text-stone-500",
          )}
        >
          {sizeOf(pack.size)} · {packState(pack)}
        </div>
        {pack.fetching && <Progress label={pack.title} done={pack.done} size={pack.size} />}
      </div>
      {action}
    </div>
  );
}

/** The world's pack, with its towns and postcodes: fetched on first opening the map, or
 *  here. It stays: the map would only fetch it again. */
function WorldRow({ world, places }: { world: MapPack; places?: MapPlaces }) {
  const fetchPack = useFetchPack();
  const state = countryState({ packs: [world.key] }, new Map([[world.key, world]]), places);
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{world.title}</div>
        <div className={cn("text-xs", state.error ? "text-red-600" : "text-stone-500")}>
          {sizeOf(state.size)} · {state.words}
        </div>
        {state.fetching && <Progress label={world.title} done={state.done} size={state.size} />}
      </div>
      {!state.installed && !state.fetching && (
        <Button
          variant="outline"
          disabled={fetchPack.isPending}
          onClick={() => fetchPack.mutate(world.key, { onError: showError })}
        >
          {state.error ? "Try again" : "Download"}
        </Button>
      )}
    </div>
  );
}

/** A country: its size and how it stands, its places counted in, with one Download for
 *  all of it; and, for one split by state, each of its states beneath, to fetch alone. */
function CountryRow({
  country,
  packs,
  places,
  matching,
}: {
  country: MapCountry;
  packs: ReadonlyMap<string, MapPack>;
  places?: MapPlaces; // they come with any of its packs
  matching: MapPack[] | null; // its states a search found, or null
}) {
  const fetchCountry = useFetchCountry();
  const removeCountry = useRemoveCountry();
  const busy = fetchCountry.isPending || removeCountry.isPending;
  const state = countryState(country, packs, places);
  const split = country.packs.length > 1 || country.packs[0] !== country.key;
  const remove = () => removeCountry.mutate(country.key, { onError: showError });
  return (
    <li>
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{country.title}</div>
          <div className={cn("text-xs", state.error ? "text-red-600" : "text-stone-500")}>
            {sizeOf(state.size)} · {state.words}
          </div>
          {state.fetching && <Progress label={country.title} done={state.done} size={state.size} />}
        </div>
        <div className="flex shrink-0 gap-2">
          {state.fetching ? (
            <Button variant="outline" disabled={busy} onClick={remove}>
              Stop
            </Button>
          ) : (
            <>
              {state.some && (
                <Button variant="outline" disabled={busy} onClick={remove}>
                  Remove
                </Button>
              )}
              {!state.installed && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => fetchCountry.mutate(country.key, { onError: showError })}
                >
                  {state.error ? "Try again" : "Download"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {split && (
        <details open={matching !== null} className="border-t border-stone-100 px-4 pb-2">
          <summary className="cursor-pointer py-2 text-sm text-sky-700">
            Or one of its {state.parts.length} states or provinces
          </summary>
          <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {(matching ?? state.parts).map((pack) => (
              <PackRow key={pack.key} pack={pack} />
            ))}
          </div>
        </details>
      )}
    </li>
  );
}

const LOOKUPS: [Lookup, string][] = [
  ["ask", "Ask each time"],
  ["always", "Without asking"],
  ["never", "Never"],
];

/** Whether an address may be looked up online on this computer: asked each time unless
 *  chosen otherwise, with what goes and to whom. */
function LookupChoice({ lookup }: { lookup: Lookup }) {
  const choose = useChooseLookup();
  return (
    <div className="space-y-2 rounded-lg border border-stone-200 px-4 py-3">
      <div className="space-y-1">
        <p className="font-medium" id="map-lookup">
          Online address lookup
        </p>
        <p className="max-w-2xl text-xs text-stone-500">
          Where an address isn't found without the internet, a person's form offers to look it up
          once, through Photon, komoot's search of OpenStreetMap. It sends the address as typed,
          with its country, and Photon sees this computer's internet address; nothing else of your
          family. Nothing is looked up as you type. Never, and the form doesn't offer it.
        </p>
      </div>
      <RadioGroup
        aria-labelledby="map-lookup"
        value={lookup}
        onValueChange={(value) => choose.mutate(value as Lookup, { onError: showError })}
        className="flex flex-wrap gap-x-5 gap-y-1.5"
      >
        {LOOKUPS.map(([value, words]) => (
          <div key={value} className="flex items-center gap-2">
            <RadioGroupItem value={value} id={`map-lookup-${value}`} disabled={choose.isPending} />
            <Label htmlFor={`map-lookup-${value}`} className="font-normal">
              {words}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

/** Settings → Map: the map's packs of OpenStreetMap's tiles on this computer. The
 *  world comes on first opening the map; every country can be fetched here, with a search, the
 *  family's countries first, or removed to make room. And the online extra, off unless
 *  chosen here, with what it tells OpenFreeMap. */
export function MapSection() {
  const packs = useMapPacks();
  const family = useFamilyCountries();
  const chooseOnline = useChooseOnline();
  const [query, setQuery] = useState("");

  const byKey = useMemo(
    () => new Map((packs.data?.packs ?? []).map((pack) => [pack.key, pack])),
    [packs.data],
  );
  const placesOf = useMemo(
    () => new Map((packs.data?.places ?? []).map((places) => [places.country, places])),
    [packs.data],
  );
  const world = packs.data?.packs.find((pack) => pack.first);
  const wanted = plain(query.trim());
  // Each country the search finds: by its name, or by one of its states', which then show.
  const found = (packs.data?.countries ?? []).flatMap((country): Found[] => {
    if (!wanted || plain(country.title).includes(wanted)) return [{ country, matching: null }];
    const states = country.packs.flatMap((key) => byKey.get(key) ?? []);
    const matching = states.filter((pack) => plain(pack.title).includes(wanted));
    return matching.length ? [{ country, matching }] : [];
  });
  const ours = new Set(family.data?.countries ?? []);
  const byTitle = (a: Found, b: Found) => a.country.title.localeCompare(b.country.title, "en-GB");
  const theirs = found.filter(({ country }) => ours.has(country.key)).sort(byTitle);
  const others = found.filter(({ country }) => !ours.has(country.key)).sort(byTitle);

  const list = (title: string, shown: Found[]) =>
    shown.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {shown.map(({ country, matching }) => (
            <CountryRow
              key={country.key}
              country={country}
              packs={byKey}
              places={placesOf.get(country.key)}
              matching={matching}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Map</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          The map's detail comes from OpenStreetMap, in packs AncesTree keeps on this computer, so
          the map looks nothing up online as you use it, unless you choose online detail below. The
          world comes the first time you open the map; download a country here for its towns, roads
          and kampungs close up. Each pack is checked before it's used.
        </p>
      </div>
      {packs.isPending && <p className="text-sm text-stone-500">Loading…</p>}
      {packs.isError && <p className="text-sm text-red-600">{packs.error.message}</p>}
      {world && (
        <div className="rounded-lg border border-stone-200">
          <WorldRow world={world} places={placesOf.get("world")} />
        </div>
      )}
      {Object.entries(packs.data?.placed ?? {}).map(([key, count]) => (
        <p key={key} className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {count === 1 ? "1 address" : `${count} addresses`}
          {key === "world"
            ? ""
            : ` in ${packs.data?.countries?.find((country) => country.key === key)?.title ?? key}`}{" "}
          placed on the map more exactly, as{" "}
          {key === "world" ? "the world's postcodes" : "its places"} came. Undo takes them back.
        </p>
      ))}
      {packs.data && (
        <>
          <Input
            type="search"
            className="max-w-sm"
            placeholder="Find a country or a state"
            aria-label="Find a country or a state"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {list("Where your family lives or was born", theirs)}
          {list(theirs.length ? "Every other country" : "Every country", others)}
          {found.length === 0 && (
            <p className="text-sm text-stone-500">No country or state is called that.</p>
          )}
        </>
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
              OpenFreeMap fills in what no pack here shows close up: a town in a country you haven't
              downloaded, say, or Germany closer than its pack goes. As you look at those places,
              AncesTree asks OpenFreeMap's server for them, so it learns which parts of the world
              you look at, from this computer's internet address. It learns nothing about your
              family, and nothing where a pack has the detail. Off, the map asks nothing of the
              internet.
            </p>
          </div>
        </div>
      )}
      {packs.data && <LookupChoice lookup={packs.data.lookup} />}
      {packs.data && (
        <p className="text-xs text-stone-500">
          Map data © OpenStreetMap contributors, under the Open Database License, as Protomaps cut
          it on {packs.data.build.slice(6, 8)}/{packs.data.build.slice(4, 6)}/
          {packs.data.build.slice(0, 4)}
          {packs.data.online
            ? ", and as OpenFreeMap cuts it each week, in OpenMapTiles' form."
            : "."}{" "}
          Countries' outlines from Natural Earth; places and postcodes from GeoNames, under the
          Creative Commons Attribution License.
        </p>
      )}
    </section>
  );
}
