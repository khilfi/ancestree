import { useEffect, useRef, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { useFetchCountry, useMapPacks } from "@/api/mapPacks";
import { lookupQuery, useLookUp, usePlaceSuggestions } from "@/api/places";
import type { PlaceSuggestion } from "@/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GrowingText } from "@/components/ui/growing-text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showError } from "@/lib/notify";
import { MALAYSIAN_STATES } from "@/lib/people";
import { PlaceLocation } from "./PlaceLocation";
import type { PersonFormValues } from "./personSchema";

type PlaceKey = "birth_place" | "death_place" | "residence";
const NO_STATE = "__none__"; // Select items can't have an empty value

/** A suggestion as a line: "Kajang · Hulu Langat · Selangor · 43000 · Malaysia"; one found
 *  online with its address first. */
export function suggestionWords(suggestion: PlaceSuggestion): string {
  const { address, town, district, state, postcode, country } = suggestion;
  return [address, town, district !== town ? district : "", state, postcode, country]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A place, as one block: the address in one line, which suggests the rest as it's
 * typed, from the country's places and postcodes; then the town, district, state, postcode and
 * country, each still for typing in; and where it is on the map, placed from the
 * suggestion chosen, or by hand. A country whose places aren't on this computer offers them,
 * with its map. Where nothing is found here, it can be looked up online, once, as this
 * computer allows. In Malaysia the state is picked from the list.
 */
export function PlaceFields({ name, label }: { name: PlaceKey; label: string }) {
  const { register, control, watch, setValue, getValues } = useFormContext<PersonFormValues>();
  const country = watch(`${name}.country`);
  const address = watch(`${name}.address`);
  const inMalaysia = ["", "malaysia"].includes(country.trim().toLowerCase());
  // What's typed in the address line since the last suggestion chosen, to suggest for.
  const [line, setLine] = useState("");
  const found = usePlaceSuggestions(line, country);
  const packs = useMapPacks();
  const fetchCountry = useFetchCountry();
  const lookUp = useLookUp();
  const [asked, setAsked] = useState(false);
  const [question, setQuestion] = useState(false); // moving house, from a pin put by hand
  const [asking, setAsking] = useState(false); // what goes online, said first
  const [online, setOnline] = useState<PlaceSuggestion[] | null>(null);

  const set = (field: keyof PersonFormValues[PlaceKey], value: string | number | null) =>
    setValue(`${name}.${field}`, value as never, { shouldDirty: true });
  const unplace = () => {
    if (getValues(`${name}.lat`) === null) return;
    set("lat", null);
    set("lon", null);
    set("exact", null);
  };
  // A changed address places its pin again, on saving or from a suggestion; one put there by
  // hand stays until asked.
  const moved = () => {
    if (getValues(`${name}.exact`) === "hand") setQuestion(true);
    else unplace();
  };
  const choose = (suggestion: PlaceSuggestion) => {
    set("town", suggestion.town);
    set("district", suggestion.district);
    set("state", suggestion.state);
    if (suggestion.postcode) set("postcode", suggestion.postcode);
    set("country", suggestion.country);
    set("lat", suggestion.lat);
    set("lon", suggestion.lon);
    set("exact", suggestion.exact);
    setQuestion(false);
    setLine("");
    setOnline(null);
  };

  const suggestions = line.trim().length >= 2 ? (found.data?.suggestions ?? []) : [];
  // The suggestions brought into view as they come, below a field low in the panel.
  const listed = useRef<HTMLUListElement>(null);
  const showing = suggestions.length > 0 || Boolean(online?.length);
  useEffect(() => {
    if (showing) listed.current?.scrollIntoView?.({ block: "nearest" });
  }, [showing]);
  const key = found.data && !found.data.downloaded ? found.data.country : null;
  const offered = key ? packs.data?.countries?.find((each) => each.key === key) : undefined;
  const byHand = (field: "town" | "postcode" | "country") =>
    register(`${name}.${field}`, { onChange: moved });

  // Looking it up online, once: never as it's typed, and never where this computer says.
  const lookup = packs.data?.lookup ?? "ask";
  const typed = (address ?? "").trim();
  const nothingHere = line.trim().length >= 2 && found.data !== undefined && !suggestions.length;
  const sent = lookupQuery(typed, country);
  const lookItUp = () => {
    setAsking(false);
    lookUp.mutate(
      { line: typed, country },
      { onError: showError, onSuccess: (answer) => setOnline(answer.suggestions) },
    );
  };

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">{label}</legend>
      <GrowingText
        placeholder="Address: house and street, or just a postcode"
        aria-label={`${label}: address`}
        {...register(`${name}.address`, {
          onChange: (event) => {
            setLine(event.target.value);
            setOnline(null);
            moved();
          },
        })}
      />
      {(suggestions.length > 0 || online !== null) && (
        <ul
          ref={listed}
          aria-label={`${label}: suggested`}
          className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 text-sm"
        >
          {(online ?? suggestions).map((suggestion) => (
            <li
              key={`${suggestion.address}|${suggestion.town}|${suggestion.postcode}|${suggestion.lat}`}
            >
              <button
                type="button"
                className="w-full px-2.5 py-1.5 text-left hover:bg-stone-50"
                onClick={() => choose(suggestion)}
              >
                {suggestionWords(suggestion)}
              </button>
            </li>
          ))}
          {online?.length === 0 && (
            <li className="px-2.5 py-1.5 text-stone-500">Nothing found online either.</li>
          )}
        </ul>
      )}
      {online !== null && online.length > 0 && (
        <p className="text-xs text-stone-500">
          Found online: check it on the small map once chosen.
        </p>
      )}
      {offered && line.trim().length >= 2 && (
        <p className="text-xs text-stone-600">
          {asked ? (
            `${offered.title}'s map and places are on their way: Settings → Map shows how it goes.`
          ) : (
            <>
              {offered.title}'s towns, villages and postcodes aren't on this computer yet.{" "}
              <button
                type="button"
                className="text-sky-700 hover:underline"
                disabled={fetchCountry.isPending}
                onClick={() =>
                  fetchCountry.mutate(offered.key, {
                    onError: showError,
                    onSuccess: () => setAsked(true),
                  })
                }
              >
                Download {offered.title}'s map and places
              </button>
            </>
          )}
        </p>
      )}
      {lookup !== "never" && online === null && typed.length >= 3 && line.trim().length >= 2 && (
        <p className="text-xs text-stone-600">
          {nothingHere ? "Not found without the internet. " : "Not the right place? "}
          <button
            type="button"
            className="text-sky-700 hover:underline"
            disabled={lookUp.isPending}
            onClick={() => (lookup === "always" ? lookItUp() : setAsking(true))}
          >
            {lookUp.isPending ? "Looking it up online…" : "Look it up online once"}
          </button>
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <GrowingText placeholder="Town" aria-label={`${label}: town`} {...byHand("town")} />
        <GrowingText
          placeholder="District"
          aria-label={`${label}: district`}
          {...register(`${name}.district`)}
        />
        {inMalaysia ? (
          <Controller
            control={control}
            name={`${name}.state`}
            render={({ field }) => (
              <Select
                value={field.value || NO_STATE}
                onValueChange={(value) => field.onChange(value === NO_STATE ? "" : value)}
              >
                <SelectTrigger aria-label={`${label}: state`} className="w-full">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STATE}>No state</SelectItem>
                  {MALAYSIAN_STATES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        ) : (
          <GrowingText
            placeholder="State or region"
            aria-label={`${label}: state or region`}
            {...register(`${name}.state`)}
          />
        )}
        <GrowingText
          placeholder="Postcode"
          aria-label={`${label}: postcode`}
          {...byHand("postcode")}
        />
        <GrowingText
          className="col-span-2"
          placeholder="Country"
          aria-label={`${label}: country`}
          {...byHand("country")}
        />
      </div>
      <PlaceLocation
        name={name}
        label={label}
        question={question}
        onAnswered={() => setQuestion(false)}
        onForget={unplace}
      />
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Look this address up online?</AlertDialogTitle>
            <AlertDialogDescription>
              AncesTree will send “{sent}” to Photon, komoot's search of OpenStreetMap, which also
              sees this computer's internet address. Nothing else of the family goes. What it finds
              is a place for you to check.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={lookItUp}>Look it up</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fieldset>
  );
}
