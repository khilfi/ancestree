import { useState } from "react";
import { toast } from "sonner";
import { usePatchPerson } from "@/api/queries";
import type { GraphPerson, Place } from "@/api/types";
import { Button } from "@/components/ui/button";
import { GrowingText } from "@/components/ui/growing-text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shortName } from "@/features/tree/words";
import { showError } from "@/lib/notify";
import { formatPlace, MALAYSIAN_STATES } from "@/lib/people";

const NO_STATE = "__none__"; // Select items can't have an empty value

/** Which place a quick fix gives: where they live, were born, or died. */
export type PlaceField = "residence" | "birth_place" | "death_place";

/** Each place, as words after someone's name, and as a quick fix's label says it. */
export const PLACE_WORDS: Record<
  PlaceField,
  { did: string; label: string; add: string; all: string }
> = {
  residence: {
    did: "lives in",
    label: "lives in",
    add: "Add where they live",
    all: "Where they live",
  },
  birth_place: {
    did: "was born in",
    label: "born in",
    add: "Add where they were born",
    all: "Where they were born",
  },
  death_place: {
    did: "died in",
    label: "died in",
    add: "Add where they died",
    all: "Where they died",
  },
};

/**
 * A quick fix: town, state and country, as in the person form, saved at once
 * as one Undo step. In Malaysia the state is picked from the list.
 */
export function PlaceFix({
  person,
  field,
  onDone,
}: {
  person: GraphPerson;
  field: PlaceField;
  onDone?: () => void;
}) {
  const patch = usePatchPerson();
  const [town, setTown] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("Malaysia");
  const inMalaysia = ["", "malaysia"].includes(country.trim().toLowerCase());
  const place: Place = { town, state, country: country.trim() || "Malaysia" };
  const ready = !!(town.trim() || state.trim() || !inMalaysia);
  const what = PLACE_WORDS[field].did;
  const save = () =>
    patch.mutate(
      { id: person.id, body: { [field]: place } },
      {
        onSuccess: () => {
          toast.success(`${shortName(person)} ${what} ${formatPlace(place) || place.country}.`);
          onDone?.();
        },
        onError: showError,
      },
    );
  const label = `${person.full_name}: ${PLACE_WORDS[field].label}`;
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) save();
      }}
    >
      <GrowingText
        className="min-h-7 w-32 py-0.5 text-xs md:text-xs"
        placeholder="Town"
        aria-label={`${label}: town`}
        value={town}
        onChange={(event) => setTown(event.target.value)}
      />
      {inMalaysia ? (
        <Select
          value={state || NO_STATE}
          onValueChange={(value) => setState(value === NO_STATE ? "" : value)}
        >
          <SelectTrigger size="sm" className="h-7 w-36 text-xs" aria-label={`${label}: state`}>
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_STATE}>No state</SelectItem>
            {MALAYSIAN_STATES.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <GrowingText
          className="min-h-7 w-32 py-0.5 text-xs md:text-xs"
          placeholder="State or region"
          aria-label={`${label}: state or region`}
          value={state}
          onChange={(event) => setState(event.target.value)}
        />
      )}
      <GrowingText
        className="min-h-7 w-28 py-0.5 text-xs md:text-xs"
        placeholder="Country"
        aria-label={`${label}: country`}
        value={country}
        onChange={(event) => setCountry(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={!ready || patch.isPending}>
        Save
      </Button>
    </form>
  );
}
