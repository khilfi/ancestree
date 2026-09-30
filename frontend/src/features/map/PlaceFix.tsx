import { useState } from "react";
import { toast } from "sonner";
import { usePatchPerson } from "@/api/queries";
import type { GraphPerson, Place } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Which place a quick fix gives: where they live, or where they were born. */
export type PlaceField = "residence" | "birth_place";

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
  const what = field === "residence" ? "lives in" : "was born in";
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
  const label = `${person.full_name}: ${field === "residence" ? "lives in" : "born in"}`;
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) save();
      }}
    >
      <Input
        className="h-7 w-32 text-xs"
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
        <Input
          className="h-7 w-32 text-xs"
          placeholder="State or region"
          aria-label={`${label}: state or region`}
          value={state}
          onChange={(event) => setState(event.target.value)}
        />
      )}
      <Input
        className="h-7 w-28 text-xs"
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
