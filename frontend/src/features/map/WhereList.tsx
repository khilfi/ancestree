import { ChevronRightIcon, MapPinIcon, XIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { GraphPerson, Pin, Place } from "@/api/types";
import { Button } from "@/components/ui/button";
import { shortName } from "@/features/tree/words";
import { formatPlace } from "@/lib/people";
import type { Spot } from "./levels";
import { type PlaceField, PlaceFix } from "./PlaceFix";

type Placed = { person: GraphPerson; place: Place };

const FIRST = 8; // a long list shows this many, then "Show all"

function Heading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h3 className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
      {children}
      <span className="font-normal text-stone-400 normal-case">{count}</span>
    </h3>
  );
}

function Many<T>({ items, row }: { items: T[]; row: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul>{(all ? items : items.slice(0, FIRST)).map(row)}</ul>
      {items.length > FIRST && (
        <button
          type="button"
          className="px-3 py-1 text-xs text-sky-700 hover:underline"
          onClick={() => setAll((now) => !now)}
        >
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

/**
 * Beside the map: everything the map says, in words, so it's never the only way to
 * read it: countries, their states, each state's towns and who is there. A click brings
 * them into view. Then who is placed roughly, who has no place yet, and the places put on the
 * map by hand, each with its quick fix.
 */
export function WhereList({
  field,
  spots,
  people,
  rough,
  missing,
  unfound,
  pins,
  editable,
  onShow,
  onSelect,
  onPlace,
  onRemovePin,
}: {
  field: PlaceField;
  spots: Spot[];
  people: Map<string, GraphPerson>;
  rough: Placed[]; // their town wasn't found: at the middle of their state or country
  missing: GraphPerson[];
  unfound: Placed[]; // a country the map doesn't know
  pins: Pin[];
  editable: boolean; // the app, not a view-only copy
  onShow: (ids: string[]) => void;
  onSelect: (id: string) => void;
  onPlace: (place: Place) => void;
  onRemovePin: (pin: Pin) => void;
}) {
  const [fixing, setFixing] = useState<string | null>(null);
  const countries = useMemo(() => {
    const tree = new Map<string, Map<string, Map<string, string[]>>>();
    for (const spot of spots) {
      const states = tree.get(spot.country) ?? new Map<string, Map<string, string[]>>();
      tree.set(spot.country, states);
      const state = spot.state ?? "";
      const towns = states.get(state) ?? new Map<string, string[]>();
      states.set(state, towns);
      const town = spot.rough ? "" : spot.place;
      towns.set(town, [...(towns.get(town) ?? []), spot.id]);
    }
    return [...tree]
      .map(([country, states]) => ({
        country,
        ids: [...states.values()].flatMap((towns) => [...towns.values()].flat()),
        states: [...states]
          .map(([state, towns]) => ({
            state,
            ids: [...towns.values()].flat(),
            towns: [...towns]
              .map(([town, ids]) => ({ town, ids }))
              .sort((a, b) => b.ids.length - a.ids.length || a.town.localeCompare(b.town)),
          }))
          .sort((a, b) => b.ids.length - a.ids.length || a.state.localeCompare(b.state)),
      }))
      .sort((a, b) => b.ids.length - a.ids.length || a.country.localeCompare(b.country));
  }, [spots]);
  const name = (id: string) => {
    const person = people.get(id);
    return person ? shortName(person) : "?";
  };
  const everyone = spots.length + missing.length + unfound.length;

  return (
    <div className="text-sm">
      <div className="border-b border-stone-200 px-3 py-2">
        <h2 className="font-semibold">
          {field === "residence" ? "Where they live" : "Where they were born"}
        </h2>
        <p className="text-xs text-stone-500">
          {spots.length} of {everyone} on the map
        </p>
      </div>

      {countries.map(({ country, ids, states }) => (
        <section key={country} className="border-b border-stone-100 py-1">
          <button
            type="button"
            onClick={() => onShow(ids)}
            className="flex w-full items-center gap-2 px-3 py-1 font-medium hover:bg-stone-50"
          >
            <span className="flex-1 truncate text-left">{country}</span>
            <span className="text-xs text-stone-500 tabular-nums">{ids.length}</span>
          </button>
          {states.map(({ state, ids: inState, towns }) => (
            <details key={state || "?"} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 pr-3 pl-4 hover:bg-stone-50">
                <ChevronRightIcon className="size-3.5 text-stone-400 transition-transform group-open:rotate-90" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onShow(inState);
                  }}
                  className="flex-1 truncate text-left text-stone-700 hover:underline"
                >
                  {state || "State not known"}
                </button>
                <span className="text-xs text-stone-500 tabular-nums">{inState.length}</span>
              </summary>
              <ul className="pb-1 pl-9">
                {towns.map(({ town, ids: inTown }) => (
                  <li key={town || "?"} className="py-0.5 pr-3">
                    <button
                      type="button"
                      onClick={() => onShow(inTown)}
                      className={
                        town
                          ? "text-stone-700 hover:underline"
                          : "text-stone-500 italic hover:underline"
                      }
                    >
                      {town || "Town not found"}
                    </button>{" "}
                    <span className="text-xs text-stone-500">
                      {inTown.map((id, index) => (
                        <span key={id}>
                          {index > 0 && ", "}
                          <button
                            type="button"
                            className="hover:text-sky-700 hover:underline"
                            onClick={() => onSelect(id)}
                          >
                            {name(id)}
                          </button>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ))}

      {rough.length > 0 && (
        <section>
          <Heading count={rough.length}>Placed roughly</Heading>
          <p className="px-3 pb-1 text-xs text-stone-500">
            Their town isn't in the map's list, so they're at the middle of their state or country.
          </p>
          <Many
            items={rough}
            row={({ person, place }) => (
              <li key={person.id} className="flex flex-wrap items-center gap-x-2 px-3 py-1">
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => onSelect(person.id)}
                >
                  {shortName(person)}
                </button>
                <span className="text-xs text-stone-500">{formatPlace(place)}</span>
                {editable && place.town && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="ml-auto"
                    onClick={() => onPlace(place)}
                  >
                    <MapPinIcon />
                    Put it on the map
                  </Button>
                )}
              </li>
            )}
          />
        </section>
      )}

      {missing.length > 0 && (
        <section>
          <Heading count={missing.length}>Not on the map yet</Heading>
          <Many
            items={missing}
            row={(person) => (
              <li key={person.id} className="px-3 py-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex-1 truncate text-left hover:underline"
                    onClick={() => onSelect(person.id)}
                  >
                    {person.full_name}
                  </button>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setFixing((now) => (now === person.id ? null : person.id))}
                    >
                      {field === "residence" ? "Add where they live" : "Add where they were born"}
                    </Button>
                  )}
                </div>
                {fixing === person.id && (
                  <div className="pt-1">
                    <PlaceFix person={person} field={field} onDone={() => setFixing(null)} />
                  </div>
                )}
              </li>
            )}
          />
        </section>
      )}

      {unfound.length > 0 && (
        <section>
          <Heading count={unfound.length}>Country not known</Heading>
          <Many
            items={unfound}
            row={({ person, place }) => (
              <li key={person.id} className="flex items-center gap-2 px-3 py-1">
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => onSelect(person.id)}
                >
                  {shortName(person)}
                </button>
                <span className="text-xs text-stone-500">
                  {formatPlace(place) || place.country}
                </span>
              </li>
            )}
          />
        </section>
      )}

      {editable && pins.length > 0 && (
        <section className="pb-2">
          <Heading count={pins.length}>Put on the map by hand</Heading>
          <ul>
            {pins.map((pin) => (
              <li
                key={`${pin.town}|${pin.state}|${pin.country}`}
                className="flex items-center gap-2 px-3 py-0.5"
              >
                <MapPinIcon className="size-3.5 text-stone-400" />
                <span className="flex-1 truncate">{formatPlace(pin) || pin.country}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Take ${pin.town ?? pin.state} off the map`}
                  onClick={() => onRemovePin(pin)}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
