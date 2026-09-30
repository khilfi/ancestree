import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MALAYSIAN_STATES } from "@/lib/people";
import type { PersonFormValues } from "./personSchema";

type PlaceKey = "birth_place" | "death_place" | "residence";
const NO_STATE = "__none__"; // Select items can't have an empty value

/** Town, state and country. In Malaysia the state is picked from the list. */
export function PlaceFields({ name, label }: { name: PlaceKey; label: string }) {
  const { register, control, watch } = useFormContext<PersonFormValues>();
  const country = watch(`${name}.country`).trim().toLowerCase();
  const inMalaysia = country === "" || country === "malaysia";

  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">{label}</legend>
      <Input placeholder="Town" aria-label={`${label}: town`} {...register(`${name}.town`)} />
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
        <Input
          placeholder="State or region"
          aria-label={`${label}: state or region`}
          {...register(`${name}.state`)}
        />
      )}
      <Input
        className="col-span-2"
        placeholder="Country"
        aria-label={`${label}: country`}
        {...register(`${name}.country`)}
      />
    </fieldset>
  );
}
