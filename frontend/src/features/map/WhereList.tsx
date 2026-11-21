import { ChevronRightIcon, MapPinIcon, XIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { AtParents, GraphPerson, Pin, Place } from "@/api/types";
import { Button } from "@/components/ui/button";
import { AT_PARENTS } from "@/features/person/PersonDetails";
import { shortName } from "@/features/tree/words";
import { formatPlace } from "@/lib/people";
import type { Spot } from "./levels";
import { PLACE_WORDS, type PlaceField, PlaceFix } from "./PlaceFix";

type Placed = { person: GraphPerson; place: Place };

const FIRST = 8; // a long list shows this many, then "Show all"

// The list's width beside the map (`w-72`), and the least the map is left beside it.
const LIST_WIDTH = 288;
const LEAST_MAP = 480;

/** Whether the list sits beside the map, in an area this wide, map and list together; else it
 *  opens over the map, at its side. A 1024 px window with someone's panel open left the
 *  map about 300 px beside it. */
export function listBeside(width: number): boolean {
  return width >= LIST_WIDTH + LEAST_MAP;
}

function Heading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h3 className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">
      {children}
      <span className="font-normal text-faint normal-case">{count}</span>
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
          className="px-3 py-1 text-xs text-link hover:underline"
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
 * read it: countries, their states, each state's towns and who is there; a country
 * without states, its towns. A click brings them into view. Then who is placed roughly,
 * who has no place yet, and the places put on the map by hand, each with its quick fix.
 */
export function WhereList({
  field,
  spots,
  people,
  rough,
  missing,
  unfound,
  atParents,
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
  atParents: Map<string, AtParents["whose"]>; // with no place of their own, at whose
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
      // A town with its district: two of one name in a state are two towns.
      const said = spot.district && spot.district !== spot.place ? `, ${spot.district}` : "";
      const town = spot.rough ? "" : `${spot.place}${said}`;
      towns.set(town, [...(towns.get(town) ?? []), spot.id]);
    }
    return [...tree]
      .map(([country, states]) => ({
        country,
        // A country without states, such as Singapore or Brunei, lists its towns.
        stateless: states.size === 1 && states.has(""),
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
  // A state's towns, or those of a country without states, each with who is there.
  const townList = (towns: { town: string; ids: string[] }[], className: string) => (
    <ul className={className}>
      {towns.map(({ town, ids: inTown }) => (
        <li key={town || "?"} className="py-0.5 pr-3">
          <button
            type="button"
            onClick={() => onShow(inTown)}
            className={
              town ? "text-foreground hover:underline" : "text-faint italic hover:underline"
            }
          >
            {town || "Town not found"}
          </button>{" "}
          <span className="text-xs text-faint">
            {inTown.map((id, index) => (
              <span key={id}>
                {index > 0 && ", "}
                <button
                  type="button"
                  className="hover:text-link hover:underline"
                  onClick={() => onSelect(id)}
                >
                  {name(id)}
                </button>
                {atParents.has(id) && ` ${AT_PARENTS[atParents.get(id) ?? "parents"]}`}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="text-sm">
      <div className="border-b border-border px-3 py-2">
        <h2 className="font-semibold">{PLACE_WORDS[field].all}</h2>
        <p className="text-xs text-faint">
          {spots.length} of {everyone} on the map
        </p>
      </div>

      {countries.map(({ country, stateless, ids, states }) => (
        <section key={country} className="border-b border-border py-1">
          <button
            type="button"
            onClick={() => onShow(ids)}
            className="flex w-full items-center gap-2 px-3 py-1 font-medium hover:bg-muted/50"
          >
            <span className="flex-1 truncate text-left">{country}</span>
            <span className="text-xs text-faint tabular-nums">{ids.length}</span>
          </button>
          {stateless
            ? townList(states[0]?.towns ?? [], "pb-1 pl-4")
            : states.map(({ state, ids: inState, towns }) => (
                <details key={state || "?"} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 pr-3 pl-4 hover:bg-muted/50">
                    <ChevronRightIcon className="size-3.5 text-faint transition-transform group-open:rotate-90" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        onShow(inState);
                      }}
                      className="flex-1 truncate text-left text-foreground hover:underline"
                    >
                      {state || "State not known"}
                    </button>
                    <span className="text-xs text-faint tabular-nums">{inState.length}</span>
                  </summary>
                  {townList(towns, "pb-1 pl-9")}
                </details>
              ))}
        </section>
      ))}

      {rough.length > 0 && (
        <section>
          <Heading count={rough.length}>Placed roughly</Heading>
          <p className="px-3 pb-1 text-xs text-faint">
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
                <span className="text-xs text-faint">{formatPlace(place)}</span>
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
                      {PLACE_WORDS[field].add}
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
                <span className="text-xs text-faint">{formatPlace(place) || place.country}</span>
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
                <MapPinIcon className="size-3.5 text-faint" />
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
