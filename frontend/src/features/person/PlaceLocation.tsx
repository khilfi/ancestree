import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { useFetchPack, useMapPacks } from "@/api/mapPacks";
import { useNearestPlace, usePlaceSuggestions } from "@/api/places";
import type { Exactness } from "@/api/types";
import { Button } from "@/components/ui/button";
import { GrowingText } from "@/components/ui/growing-text";
import { drawsWebGL2 } from "@/features/map/webgl";
import { showError } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { readCoordinates } from "./coordinates";
import type { PersonFormValues } from "./personSchema";

// The small map is MapLibre, a chunk of its own, loaded when first shown; never in a copy.
const SmallMap = import.meta.env.MODE === "viewer" ? null : lazy(() => import("./SmallMap"));

type PlaceKey = "birth_place" | "death_place" | "residence";

/** How exactly a pin is placed, as the form marks it; placed by hand, or confirmed
 *  with Looks right, is confirmed. */
export const MARK: Record<Exactness, string> = {
  spot: "At its house",
  hand: "Confirmed",
  street: "Street",
  postcode: "Postcode area",
  town: "Town",
};

// Where the small map opens with no pin and no town known: Malaysia whole, or the world.
const MALAYSIA = { lat: 4.2, lon: 109.4, zoom: 4.2 };
const WORLD = { lat: 15, lon: 100, zoom: 1.2 };

const round = (value: number) => Number(value.toFixed(6));

/**
 * Where a place is: its pin, placed from the address by
 * itself, about there; a small map that shows where it went, with **Looks right**, which
 * confirms it, where it's dragged or clicked only if it's wrong, which confirms it too;
 * and its coordinates, typed or pasted in any common form. Confirmed, it's a pin on the map;
 * else a round node, about there, with **Confirm**. A pin put first fills in the address from
 * the nearest place known. Where the small map can't be drawn, the numbers and what would help.
 */
export function PlaceLocation({
  name,
  label,
  question,
  onAnswered,
  onForget,
}: {
  name: PlaceKey;
  label: string;
  question: boolean; // its pin was put by hand, and its address changed: keep it there?
  onAnswered: () => void;
  onForget: () => void;
}) {
  const { watch, setValue, getValues } = useFormContext<PersonFormValues>();
  const lat = watch(`${name}.lat`);
  const lon = watch(`${name}.lon`);
  const exact = watch(`${name}.exact`);
  const town = watch(`${name}.town`);
  const country = watch(`${name}.country`);
  const placed = lat !== null && lon !== null;
  const packs = useMapPacks();
  const fetchPack = useFetchPack();
  const near = useNearestPlace();
  const webgl2 = useMemo(() => SmallMap !== null && drawsWebGL2(), []);
  const world = packs.data?.packs.find((pack) => pack.first);
  const drawn = webgl2 && Boolean(world?.installed);
  const regions = useMemo(
    () => (packs.data?.packs ?? []).filter((pack) => !pack.first && pack.installed),
    [packs.data],
  );
  const [shown, setShown] = useState(false); // the small map open
  // A pin placed as the form is filled in, from a suggestion or online, shows where it went;
  // one the form opened with stays folded until asked for.
  const opened = useRef<[number | null, number | null]>([lat, lon]);
  useEffect(() => {
    const [was, wasLon] = opened.current;
    if (lat !== null && lon !== null && (lat !== was || lon !== wasLon)) setShown(true);
  }, [lat, lon]);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  // With no pin, the small map opens around the town, as the suggestions find it.
  const townFound = usePlaceSuggestions(shown && !placed ? (town ?? "") : "", country);
  const first = townFound.data?.suggestions[0];
  const inMalaysia = ["", "malaysia"].includes(country.trim().toLowerCase());
  const around = first
    ? { lat: first.lat, lon: first.lon, zoom: 12 }
    : inMalaysia
      ? MALAYSIA
      : WORLD;

  const set = (field: keyof PersonFormValues[PlaceKey], value: string | number | null) =>
    setValue(`${name}.${field}`, value as never, { shouldDirty: true });
  // Confirmed where it is: kept as one placed by hand, which nothing moves by itself.
  const confirmed = exact === "hand";
  const confirm = () => set("exact", "hand");

  /** Put the pin here, by hand: on the small map, or from coordinates. A pin put first fills in
   *  the address from the nearest place known, each part still to change. */
  const putHere = (point: { lat: number; lon: number }) => {
    set("lat", round(point.lat));
    set("lon", round(point.lon));
    set("exact", "hand");
    setShown(true);
    onAnswered();
    const now = getValues(name);
    if (now.address || now.town || now.postcode) return;
    near.mutate(
      { ...point, country: now.country },
      {
        onError: showError,
        onSuccess: (found) => {
          if (!found) return;
          set("town", found.town);
          set("district", found.district);
          set("state", found.state);
          if (found.postcode) set("postcode", found.postcode);
          setFilled(found.town);
        },
      },
    );
  };

  const read = () => {
    const found = readCoordinates(typed);
    if ("problem" in found) {
      setProblem(found.problem);
      return;
    }
    setProblem(null);
    setTyped("");
    putHere(found);
  };

  return (
    <div className="space-y-2 rounded-lg border border-stone-200 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-stone-700">On the map</span>
        {placed ? (
          <>
            <span
              className={cn(
                "rounded px-1.5 py-0.5",
                confirmed ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-900",
              )}
            >
              {confirmed ? "Confirmed" : "About here"}
            </span>
            <span className="text-stone-600">
              {confirmed
                ? "on the map as a pin"
                : `on the map at ${town || MARK[exact ?? "town"].toLowerCase()}`}
            </span>
            <span className="text-stone-400 tabular-nums">
              {lat.toFixed(4)}, {lon.toFixed(4)}
            </span>
            {!confirmed && (
              <Button type="button" variant="outline" size="xs" onClick={confirm}>
                Confirm
              </Button>
            )}
          </>
        ) : (
          <span className="text-stone-500">
            {town ? "at its town, as the map finds it" : "not yet"}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          {shown && placed ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                if (!confirmed) confirm();
                setShown(false);
              }}
            >
              Looks right
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="xs" onClick={() => setShown(true)}>
              {placed ? "Show on the map" : "Place on the map"}
            </Button>
          )}
          {placed && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                onForget();
                setFilled(null);
              }}
            >
              Forget where it is
            </Button>
          )}
        </span>
      </div>
      {question && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 p-2 text-amber-900">
          <span className="flex-1">
            Its place on the map was confirmed. Keep it there, or place it from the new address?
          </span>
          <Button type="button" variant="outline" size="xs" onClick={onAnswered}>
            Keep it there
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              onForget();
              onAnswered();
            }}
          >
            Place it from the address
          </Button>
        </div>
      )}
      {filled && (
        <p className="text-stone-600">
          Filled in from the nearest place known: {filled}. Change anything that isn't right.
        </p>
      )}
      {shown &&
        (drawn && SmallMap ? (
          <Suspense fallback={<div className="h-56 animate-pulse rounded-lg bg-stone-100" />}>
            <SmallMap
              pin={placed ? { lat, lon } : null}
              around={around}
              exact={exact}
              regions={regions}
              online={packs.data?.online ?? false}
              label={label}
              onMove={putHere}
            />
            <p className="text-stone-500">
              {placed
                ? "If it's wrong, drag the pin, or click the right spot."
                : "Click where it is."}
            </p>
          </Suspense>
        ) : webgl2 && world ? (
          <p className="text-stone-600">
            The small map needs the world's map, downloaded once.{" "}
            <button
              type="button"
              className="text-sky-700 hover:underline"
              disabled={world.fetching || fetchPack.isPending}
              onClick={() => fetchPack.mutate(world.key, { onError: showError })}
            >
              {world.fetching ? "Downloading the world's map…" : "Download the world's map"}
            </button>{" "}
            Or type where it is, below.
          </p>
        ) : (
          <p className="text-stone-600">
            This computer can't draw the small map. Type or paste where it is, below.
          </p>
        ))}
      <GrowingText
        placeholder="Where it is: 3.0006, 101.7869, or a link from a phone's map"
        aria-label={`${label}: where it is`}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault(); // read it here: Enter saves the form elsewhere
          read();
        }}
        onBlur={() => {
          if (typed.trim()) read();
        }}
      />
      {problem && <p className="text-red-700">{problem}</p>}
    </div>
  );
}
